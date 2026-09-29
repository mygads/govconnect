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
import { isOcrConfigured } from './ocr-ktp';

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
  /**
   * R14: raw bytes for the on-prem OCR sidecar, set ONLY when OCR is
   * configured. Never forwarded to any cloud service; used in-process
   * for KTP pre-fill, then dropped with the turn.
   */
  bytesForOcr?: Buffer;
  /**
   * A4 — fraud signals (BASIC heuristics, NOT forensics). Values:
   * 'duplicate_image' | 'exif_datetime_suspicious' | 'low_resolution'.
   * For admin review; never auto-rejects evidence.
   */
  fraudSignals: string[];
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

/**
 * A4 — minimal EXIF DateTimeOriginal (tag 0x9003) reader, pure TS.
 * Walks JPEG markers → APP1 "Exif\0\0" → TIFF IFD0 → EXIF sub-IFD.
 * Returns the raw "YYYY:MM:DD HH:MM:SS" string or null when absent/unparseable.
 */
export function extractExifDateTimeOriginal(buf: Buffer): string | null {
  try {
    let i = 2;
    while (i + 4 <= buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1]!;
      if (marker === 0xda) break; // SOS — no more metadata
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2 || i + 2 + len > buf.length) break;
      if (marker === 0xe1 && len > 8) {
        const seg = buf.subarray(i + 4, i + 2 + len);
        const dt = parseExifSegment(seg);
        if (dt) return dt;
      }
      i += 2 + len;
    }
  } catch {
    // best-effort only
  }
  return null;
}

function parseExifSegment(seg: Buffer): string | null {
  if (seg.length < 14 || seg.toString('ascii', 0, 4) !== 'Exif') return null;
  const tiff = 6;
  const bo = seg.toString('ascii', tiff, tiff + 2);
  const le = bo === 'II';
  if (!le && bo !== 'MM') return null;
  const readU16 = (o: number) => le ? seg.readUInt16LE(o) : seg.readUInt16BE(o);
  const readU32 = (o: number) => le ? seg.readUInt32LE(o) : seg.readUInt32BE(o);
  const ifd0 = tiff + readU32(tiff + 4);
  const readAscii = (entryOff: number): string | null => {
    const type = readU16(entryOff + 2);
    const count = readU32(entryOff + 4);
    if (type !== 2 || count === 0 || count > 64) return null;
    let off: number;
    if (count <= 4) {
      off = entryOff + 8;
    } else {
      off = tiff + readU32(entryOff + 8);
    }
    if (off + count > seg.length) return null;
    return seg.toString('ascii', off, off + count).replace(/\0+$/, '');
  };
  const scanIfd = (ifdOff: number, wantSubIfd: boolean): string | null => {
    if (ifdOff + 2 > seg.length) return null;
    const n = readU16(ifdOff);
    let subIfd = -1;
    for (let e = 0; e < n; e++) {
      const entryOff = ifdOff + 2 + e * 12;
      if (entryOff + 12 > seg.length) break;
      const tag = readU16(entryOff);
      if (tag === 0x9003) {
        const v = readAscii(entryOff);
        if (v) return v;
      }
      if (wantSubIfd && tag === 0x8769) {
        subIfd = tiff + readU32(entryOff + 8);
      }
    }
    if (wantSubIfd && subIfd > 0) return scanIfd(subIfd, false);
    return null;
  };
  return scanIfd(ifd0, true);
}

/** Parse "YYYY:MM:DD HH:MM:SS" → Date, or null. */
function parseExifDate(s: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ ](\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A4 — minimal JPEG dimension reader (SOF0/SOF1/SOF2), pure TS.
 * Returns {width, height} or null.
 */
export function extractJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  try {
    let i = 2;
    while (i + 9 <= buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1]!;
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2 || i + 2 + len > buf.length) break;
      if ((marker === 0xc0 || marker === 0xc1 || marker === 0xc2) && len >= 7) {
        const height = buf.readUInt16BE(i + 5);
        const width = buf.readUInt16BE(i + 7);
        if (width > 0 && height > 0) return { width, height };
      }
      i += 2 + len;
    }
  } catch {
    // best-effort only
  }
  return null;
}

const LOW_RES_MIN_PX = 400;

/**
 * A4 — compute basic fraud signals for evidence photos. Heuristics only,
 * NOT forensics: a signal means "flag for admin review", never auto-reject.
 */
export function computeFraudSignals(input: {
  bytes: Buffer;
  sha256: string;
  duplicate: boolean;
  now?: Date;
}): string[] {
  const signals: string[] = [];
  const now = input.now ?? new Date();
  if (input.duplicate) signals.push('duplicate_image');
  if (looksLikeJpeg(input.bytes)) {
    const dtRaw = extractExifDateTimeOriginal(input.bytes);
    if (dtRaw) {
      const dt = parseExifDate(dtRaw);
      if (dt && (dt.getUTCFullYear() < 2000 || dt.getTime() > now.getTime() + 24 * 3600 * 1000)) {
        signals.push('exif_datetime_suspicious');
      }
    }
    const dims = extractJpegDimensions(input.bytes);
    if (dims && (dims.width < LOW_RES_MIN_PX || dims.height < LOW_RES_MIN_PX)) {
      signals.push('low_resolution');
    }
  }
  return signals;
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
    fraudSignals: [],
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
      fraudSignals: ['duplicate_image'],
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

  // A4 — basic fraud signals (heuristics, for admin review only).
  const fraudSignals = computeFraudSignals({ bytes, sha256: hash, duplicate: false });

  await appendAudit({
    tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'media_intake',
    payload: {
      sha256: hash.slice(0, 16) + '…', bytes: bytes.length,
      exifStripped, redaction, forwardToLlm: false, fraudSignals,
    },
  }).catch(() => undefined);

  const kind: MediaSignal['estimatedKind'] =
    /document|pdf/i.test(input.mediaType ?? '') ? 'document'
    : /image|photo|jpeg|png/i.test(input.mediaType ?? '') ? 'photo'
    : 'unknown';

  const fraudNote = fraudSignals.length > 0
    ? ` Sinyal pemeriksaan bukti (heuristik, perlu review petugas): ${fraudSignals.join(', ')}.`
    : '';

  return {
    hasImage: true, sha256: hash, duplicate: false,
    exifStripped, redaction, forwardToLlm: false,
    estimatedKind: kind, bytes: bytes.length,
    fraudSignals,
    bytesForOcr: isOcrConfigured() ? bytes : undefined,
    promptFact:
      '[SINYAL MEDIA] Warga melampirkan 1 gambar ' +
      `(${kind === 'unknown' ? 'jenis tidak diketahui' : kind}, hash ${hash.slice(0, 12)}…). ` +
      'Redaksi wajah/plat nomor BELUM tersedia di environment ini, sehingga gambar tidak diteruskan ' +
      'ke AI. Perlakukan sebagai bukti visual yang belum terverifikasi; ' +
      'jika isi gambar penting untuk laporan, minta warga mendeskripsikannya dengan kata-kata. ' +
      'JANGAN meminta warga mengirim ulang gambar yang sama.' +
      fraudNote,
  };
}
