/**
 * Media pipeline — image intake with privacy-first handling.
 *
 * Design (arsitektur-final §5.7, v5 multimodal):
 * - Vision is an ASSISTANT SIGNAL only: raw pixels are never forwarded to
 *   the LLM until faces/license-plates are destructively redacted.
 * - Mandatory steps per image: (1) SHA-256 for dedup, (2) EXIF strip,
 *   (3) face/plate redaction.
 * - Graceful degradation (honest): this environment has no image library
 *   (sharp) and no detection model, so redaction CANNOT be performed.
 *   In that case redaction='degraded' and the image is NEVER forwarded —
 *   only signal metadata reaches the agent. No capability is fabricated.
 *
 * EXIF: best-effort pure-TS JPEG APPn-segment stripper (covers EXIF/XMP in
 * JPEG). Non-JPEG input is marked exifStripped:false (degraded).
 */

import { createHash } from 'crypto';
import { appendAudit } from './pipeline-store';
import logger from '../utils/logger';

export interface MediaSignal {
  hasImage: boolean;
  sha256?: string;
  duplicate: boolean;
  duplicateOfMessageId?: string;
  exifStripped: boolean;
  redaction: 'done' | 'degraded' | 'not_applicable';
  /** Never raw pixels — only an assistant-level signal. */
  forwardToLlm: boolean;
  estimatedKind: 'photo' | 'document' | 'unknown';
  bytes?: number;
  /** System fact injected into the agent prompt. */
  promptFact?: string;
}

// Per-process dedup registry: sha256 → messageId.
// NOTE: not shared across replicas; a DB-backed media registry is a known gap.
const seenHashes = new Map<string, string>();

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

async function fetchBytes(url: string): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > MAX_IMAGE_BYTES ? null : buf;
  } catch {
    return null;
  }
}

/**
 * Best-effort EXIF strip for JPEG: removes all APPn segments (APP1=EXIF,
 * APP13=Photoshop, APP14, …). Returns the stripped buffer, or null when the
 * input is not a JPEG or parsing fails (→ degraded).
 */
export function stripJpegAppSegments(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out: Buffer[] = [buf.subarray(0, 2)]; // SOI
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break; // not a marker — stop, keep rest as-is
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      // SOI (dup) / EOI
      out.push(buf.subarray(i, i + 2));
      i += 2;
      if (marker === 0xd9) break;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2)); // standalone markers
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) break;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) break;
    const isAppSegment = marker >= 0xe0 && marker <= 0xef;
    if (!isAppSegment) out.push(buf.subarray(i, i + 2 + len));
    // else: dropped (EXIF/XMP/ICC live here)
    i += 2 + len;
    // SOS (start of scan): copy the rest verbatim
    if (marker === 0xda) {
      out.push(buf.subarray(i));
      break;
    }
  }
  return Buffer.concat(out);
}

function looksLikeJpeg(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export async function processImageMedia(input: {
  tenantId: string;
  userId: string;
  channel: string;
  traceId: string;
  mediaUrl?: string;
  mediaType?: string;
  messageId?: string;
}): Promise<MediaSignal> {
  const { tenantId, userId, channel, traceId, mediaUrl } = input;
  const empty: MediaSignal = {
    hasImage: false, duplicate: false, exifStripped: false,
    redaction: 'not_applicable', forwardToLlm: false, estimatedKind: 'unknown',
  };
  if (!mediaUrl) return empty;

  const bytes = await fetchBytes(mediaUrl);
  if (!bytes) {
    logger.warn('[media-pipeline] could not fetch image bytes', { traceId });
    return {
      ...empty, hasImage: true,
      promptFact: '[SINYAL MEDIA] Warga melampirkan gambar, tetapi berkasnya tidak dapat diunduh. ' +
        'Minta warga mendeskripsikan isi gambar dengan kata-kata.',
    };
  }

  const hash = sha256Hex(bytes);
  const dupOf = seenHashes.get(hash);
  if (dupOf && dupOf !== input.messageId) {
    await appendAudit({
      tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'media_duplicate',
      payload: { sha256: hash.slice(0, 16) + '…', duplicateOf: dupOf },
    }).catch(() => undefined);
    return {
      hasImage: true, sha256: hash, duplicate: true, duplicateOfMessageId: dupOf,
      exifStripped: false, redaction: 'degraded', forwardToLlm: false,
      estimatedKind: 'unknown', bytes: bytes.length,
      promptFact: '[SINYAL MEDIA] Gambar yang dilampirkan identik dengan gambar yang sudah dikirim sebelumnya. ' +
        'Jangan meminta ulang; perlakukan sebagai bukti yang sama.',
    };
  }
  seenHashes.set(hash, input.messageId ?? `${Date.now()}`);

  // EXIF strip (best-effort, JPEG only).
  let exifStripped = false;
  if (looksLikeJpeg(bytes)) {
    const stripped = stripJpegAppSegments(bytes);
    exifStripped = stripped !== null && stripped.length < bytes.length;
    if (stripped === null) {
      logger.debug('[media-pipeline] JPEG APP strip failed → degraded', { traceId });
    }
  }

  // Face/plate redaction: NO image library and NO detection model in this
  // environment → cannot redact → degraded. The image NEVER reaches the LLM.
  const redaction: MediaSignal['redaction'] = 'degraded';

  await appendAudit({
    tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'media_intake',
    payload: {
      sha256: hash.slice(0, 16) + '…', bytes: bytes.length,
      exifStripped, redaction, forwardToLlm: false,
    },
  }).catch(() => undefined);

  const kind: MediaSignal['estimatedKind'] =
    /document|pdf/i.test(input.mediaType ?? '') ? 'document'
    : /image|photo|jpeg|png/i.test(input.mediaType ?? '') ? 'photo'
    : 'unknown';

  return {
    hasImage: true, sha256: hash, duplicate: false,
    exifStripped, redaction, forwardToLlm: false,
    estimatedKind: kind, bytes: bytes.length,
    promptFact:
      '[SINYAL MEDIA] Warga melampirkan 1 gambar ' +
      `(${kind === 'unknown' ? 'jenis tidak diketahui' : kind}, hash ${hash.slice(0, 12)}…). ` +
      'Redaksi wajah/plat nomor BELUM tersedia di environment ini, sehingga gambar tidak diteruskan ' +
      'ke AI. Perlakukan sebagai bukti visual yang belum terverifikasi; ' +
      'jika isi gambar penting untuk laporan, minta warga mendeskripsikannya dengan kata-kata. ' +
      'JANGAN meminta warga mengirim ulang gambar yang sama.',
  };
}
