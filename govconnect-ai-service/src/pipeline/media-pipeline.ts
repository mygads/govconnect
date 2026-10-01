/**
 * Media pipeline — image intake with privacy-first handling.
 *
 * Design (arsitektur-final §5.7, v5 multimodal):
 * - Vision is an ASSISTANT SIGNAL only: raw pixels are never forwarded to
 *   the LLM until faces/license-plates are destructively redacted.
 * - Mandatory steps per image: (1) SHA-256 for dedup (+ pHash near-dup),
 *   (2) EXIF strip, (3) face/plate redaction.
 * - W15 (2026-10-01): dedup is DB-backed (ai.media_registry) — same
 *   (village_id, user_id, sha256) within 24h => duplicate; survives restarts
 *   and works across replicas. In-process Maps are L1 only.
 * - W15: EXIF strip uses sharp re-encode when available (drops ALL metadata
 *   for every decodable format), falling back to the pure-TS JPEG APPn
 *   segment stripper. Non-JPEG without sharp is marked exifStripped:false.
 * - W15: KTP/identity documents are NEVER blurred (admin manual verification
 *   needs them intact) and are flagged adminOnly — never forwarded to any LLM.
 * - W15 targeted face blur: face-api tiny_face_detector on the tfjs WASM
 *   backend (pipeline/face-detection.ts) blurs ONLY face regions when the
 *   model is present (FACE_MODEL_DIR; fetched via
 *   scripts/download-face-models.sh, never committed). Detection failure or
 *   missing model degrades honestly to whole-image blur — see redactDetail
 *   in the INGRESS audit payload ('targeted_faces:N' vs 'whole_image').
 *   License-plate detection is still an open TODO (no plate model vetted).
 *
 * EXIF: best-effort pure-TS JPEG APPn-segment stripper (covers EXIF/XMP in
 * JPEG). Non-JPEG input without sharp is marked exifStripped:false (degraded).
 */

import { createHash, randomUUID } from 'crypto';
import { appendAudit, getDb } from './pipeline-store';
import logger from '../utils/logger';
import { isOcrConfigured } from './ocr-ktp';
import {
  dHash,
  hammingDistance,
  moderateImage,
  blurImage,
  blurImageRegions,
  stripExifMetadata,
  isSharpAvailable,
  PHASH_NEAR_DUP_THRESHOLD,
} from './media-perceptual';
import { detectFaces } from './face-detection';

/**
 * W15 — DB-backed media registry (ai.media_registry).
 * Dedup rule: same (village_id, user_id, sha256) within the last 24h
 * => duplicate. Survives process restarts; works across replicas.
 * In-process Maps remain as an L1 fast path; the DB is authoritative.
 */
const DEDUP_WINDOW_HOURS = Number(process.env.MEDIA_DEDUP_WINDOW_HOURS ?? 24);

interface DbDuplicateHit {
  message_id: string | null;
  created_at: Date;
}

async function findRecentDbDuplicate(
  villageId: string,
  userId: string,
  sha256: string,
): Promise<DbDuplicateHit | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = (await db.$queryRawUnsafe(
      `SELECT message_id, created_at FROM ai.media_registry
       WHERE village_id = $1 AND user_id = $2 AND sha256 = $3
         AND created_at > NOW() - ($4 || ' hours')::interval
       ORDER BY created_at DESC LIMIT 1`,
      villageId,
      userId,
      sha256,
      String(DEDUP_WINDOW_HOURS),
    )) as Array<{ message_id: string | null; created_at: Date }>;
    return rows[0] ?? null;
  } catch (err) {
    logger.debug('[media-pipeline] db dedup lookup failed (degraded to L1)', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    return null;
  }
}

async function recordMediaIntake(input: {
  villageId: string;
  userId: string;
  sha256: string;
  phash?: string;
  messageId?: string;
  mediaKind: string;
  bytes: number;
  exifStripped: boolean;
  redaction: string;
  adminOnly: boolean;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.$executeRawUnsafe(
      `INSERT INTO ai.media_registry
         (id, village_id, user_id, sha256, phash, message_id, media_kind, bytes,
          exif_stripped, redaction, admin_only)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      randomUUID(),
      input.villageId,
      input.userId,
      input.sha256,
      input.phash ?? null,
      input.messageId ?? null,
      input.mediaKind,
      String(input.bytes),
      input.exifStripped,
      input.redaction,
      input.adminOnly,
    );
  } catch (err) {
    // Best-effort: intake must never fail because the registry write failed.
    logger.debug('[media-pipeline] media registry insert failed', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
  }
}

export interface MediaSignal {
  hasImage: boolean;
  sha256?: string;
  /** W15: 64-bit dHash (perceptual) — catches near-duplicates SHA-256 misses. */
  phash?: string;
  duplicate: boolean;
  /** 'exact' (SHA-256) or 'near' (pHash Hamming distance). */
  duplicateKind?: 'exact' | 'near';
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
  /**
   * Raw bytes, present ONLY when the caller explicitly asked for them
   * (retainBytes: true) — e.g. KTP verification intake. Privacy default:
   * bytes are dropped after hashing. NEVER forwarded to any LLM.
   */
  retainedBytes?: Buffer;
  /**
   * W15: KTP / identity documents must NEVER be blurred (needed for manual
   * admin verification) and are admin-eyes-only: never forwarded to any LLM,
   * never shown to other users. Set when retainBytes is requested (KTP
   * verification intake) or the media kind is 'document'.
   */
  adminOnly?: boolean;
  /** System fact injected into the agent prompt. */
  promptFact?: string;
}

// Per-process dedup registries: sha256 → messageId (exact), phash → messageId (near).
// NOTE: not shared across replicas; a DB-backed media registry is a known gap.
const seenHashes = new Map<string, string>();
const seenPhashes = new Map<string, string>();

/**
 * W15: redaction mode is env-driven, not hardcoded.
 * - 'degraded' (default): no redaction possible — image never reaches the LLM.
 * - 'blur': whole-image blur via sharp before any downstream use. This is a
 *   privacy fallback, NOT targeted face/plate detection (no detection model
 *   in this environment). Honest about its limits.
 */
const REDACT_MODE = (process.env.MEDIA_REDACT_MODE ?? 'degraded').toLowerCase();
function redactMode(): 'degraded' | 'blur' {
  return REDACT_MODE === 'blur' && isSharpAvailable() ? 'blur' : 'degraded';
}

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
  while (i + 2 <= buf.length) {
    if (buf[i] !== 0xff) break; // not a marker — stop, keep rest as-is
    const marker = buf[i + 1]!;
    if (marker === 0xd9) {
      // EOI — always preserved (may be the final 2 bytes)
      out.push(buf.subarray(i, i + 2));
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
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

/** Test hook: clear in-process dedup registries. */
export function __clearMediaDedupRegistries(): void {
  seenHashes.clear();
  seenPhashes.clear();
}

export async function processImageMedia(input: {
  tenantId: string;
  userId: string;
  channel: string;
  traceId: string;
  mediaUrl?: string;
  mediaType?: string;
  messageId?: string;
  /**
   * When true, the downloaded bytes are returned in `retainedBytes` for a
   * specific downstream need (e.g. KTP verification intake). Default false:
   * bytes are hashed then dropped.
   */
  retainBytes?: boolean;
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

  // W15: DB-backed dedup (authoritative) — same user + same SHA-256 within
  // the last DEDUP_WINDOW_HOURS (default 24h) => duplicate. This survives
  // restarts and works across replicas; the in-process Maps below are L1.
  const dbDup = await findRecentDbDuplicate(tenantId, userId, hash);
  if (dbDup && dbDup.message_id !== input.messageId) {
    await appendAudit({
      tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'media_duplicate',
      payload: {
        sha256: hash.slice(0, 16) + '…', duplicateOf: dbDup.message_id,
        duplicateKind: 'exact', source: 'db_registry',
      },
    }).catch(() => undefined);
    return {
      hasImage: true, sha256: hash, duplicate: true, duplicateKind: 'exact',
      duplicateOfMessageId: dbDup.message_id ?? undefined,
      exifStripped: false, redaction: 'degraded', forwardToLlm: false,
      estimatedKind: 'unknown', bytes: bytes.length,
      fraudSignals: ['duplicate_image'],
      promptFact: '[SINYAL MEDIA] Foto ini sudah pernah dikirim sebelumnya (duplikat). ' +
        'Jangan meminta ulang; perlakukan sebagai bukti yang sama.',
    };
  }

  const dupOf = seenHashes.get(hash);
  if (dupOf && dupOf !== input.messageId) {
    await appendAudit({
      tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'media_duplicate',
      payload: { sha256: hash.slice(0, 16) + '…', duplicateOf: dupOf, duplicateKind: 'exact' },
    }).catch(() => undefined);
    return {
      hasImage: true, sha256: hash, duplicate: true, duplicateKind: 'exact', duplicateOfMessageId: dupOf,
      exifStripped: false, redaction: 'degraded', forwardToLlm: false,
      estimatedKind: 'unknown', bytes: bytes.length,
      fraudSignals: ['duplicate_image'],
      promptFact: '[SINYAL MEDIA] Foto ini sudah pernah dikirim sebelumnya (duplikat). ' +
        'Jangan meminta ulang; perlakukan sebagai bukti yang sama.',
    };
  }
  seenHashes.set(hash, input.messageId ?? `${Date.now()}`);

  // W15: perceptual near-duplicate check (dHash). Catches resized /
  // recompressed / re-encoded copies that exact SHA-256 misses.
  const phash = await dHash(bytes);
  if (phash) {
    let nearDupOf: string | undefined;
    for (const [seen, msgId] of seenPhashes) {
      if (msgId !== input.messageId && hammingDistance(phash, seen) <= PHASH_NEAR_DUP_THRESHOLD) {
        nearDupOf = msgId;
        break;
      }
    }
    if (nearDupOf) {
      await appendAudit({
        tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'media_duplicate',
        payload: { phash, duplicateOf: nearDupOf, duplicateKind: 'near' },
      }).catch(() => undefined);
      return {
        hasImage: true, sha256: hash, phash, duplicate: true, duplicateKind: 'near',
        duplicateOfMessageId: nearDupOf,
        exifStripped: false, redaction: 'degraded', forwardToLlm: false,
        estimatedKind: 'unknown', bytes: bytes.length,
        fraudSignals: ['duplicate_image', 'near_duplicate_image'],
        promptFact: '[SINYAL MEDIA] Gambar yang dilampirkan sangat mirip dengan gambar yang sudah dikirim ' +
          'sebelumnya (duplikat visual). Jangan meminta ulang; perlakukan sebagai bukti yang sama.',
      };
    }
    seenPhashes.set(phash, input.messageId ?? `${Date.now()}`);
  }

  // W15: moderation (heuristic, review-oriented — never auto-rejects).
  const moderation = await moderateImage(bytes);

  // W15: EXIF strip — strip ALL metadata (EXIF, XMP, ICC, GPS, device info)
  // before any storage/forwarding.
  // 1. Preferred: sharp re-encode (drops every metadata chunk on output for
  //    all decodable formats — JPEG, PNG, WebP, …) via stripExifMetadata().
  // 2. Fallback: pure-TS JPEG APPn segment stripper (JPEG only).
  let exifStripped = false;
  const sharpStripped = await stripExifMetadata(bytes);
  if (sharpStripped) {
    exifStripped = sharpStripped.length <= bytes.length; // re-encode always drops metadata
  } else if (looksLikeJpeg(bytes)) {
    const stripped = stripJpegAppSegments(bytes);
    exifStripped = stripped !== null && stripped.length < bytes.length;
    if (stripped === null) {
      logger.debug('[media-pipeline] JPEG APP strip failed → degraded', { traceId });
    }
  } else {
    logger.debug('[media-pipeline] EXIF strip unavailable for non-JPEG without sharp → degraded', { traceId });
  }

  // Face/plate redaction: env-driven (MEDIA_REDACT_MODE).
  // - 'blur': targeted face-region blur when face detection is available
  //   (face-api tiny_face_detector, tfjs WASM backend); any detection
  //   failure or missing model degrades to whole-image blur via sharp.
  //   License-plate detection is not yet implemented.
  // - 'degraded' (default): redaction unavailable — image NEVER reaches LLM.
  const mode = redactMode();
  const redaction: MediaSignal['redaction'] = mode === 'blur' ? 'done' : 'degraded';
  let redactedBytes: Buffer | undefined;
  let redactDetail: 'targeted_faces' | 'whole_image' | 'none' = 'none';
  let faceCount = 0;
  if (mode === 'blur') {
    const faceBoxes = await detectFaces(bytes);
    let blurred: Buffer | null = null;
    if (faceBoxes && faceBoxes.length > 0) {
      blurred = await blurImageRegions(bytes, faceBoxes);
      if (blurred) {
        redactDetail = 'targeted_faces';
        faceCount = faceBoxes.length;
      } else {
        logger.warn('[media-pipeline] targeted face blur failed → whole-image fallback', { traceId });
      }
    }
    if (!blurred) {
      blurred = await blurImage(bytes);
      if (blurred) redactDetail = 'whole_image';
    }
    if (blurred) {
      redactedBytes = blurred;
    } else {
      logger.warn('[media-pipeline] blur redaction failed → degraded', { traceId });
    }
  }
  const effectiveRedaction: MediaSignal['redaction'] =
    mode === 'blur' && redactedBytes ? 'done' : 'degraded';

  // A4 — basic fraud signals (heuristics, for admin review only).
  const fraudSignals = computeFraudSignals({ bytes, sha256: hash, duplicate: false });
  if (moderation.flagged) fraudSignals.push('moderation_review');

  await appendAudit({
    tenantId, traceId, userId, channel, stage: 'INGRESS', event: 'media_intake',
    payload: {
      sha256: hash.slice(0, 16) + '…', phash: phash ?? null, bytes: bytes.length,
      exifStripped, redaction: effectiveRedaction, redactMode: mode,
      redactDetail, faceCount,
      forwardToLlm: false, fraudSignals,
      moderation: { flagged: moderation.flagged, skinRatio: moderation.skinRatio },
    },
  }).catch(() => undefined);

  const kind: MediaSignal['estimatedKind'] =
    /document|pdf/i.test(input.mediaType ?? '') ? 'document'
    : /image|photo|jpeg|png/i.test(input.mediaType ?? '') ? 'photo'
    : 'unknown';

  const fraudNote = fraudSignals.length > 0
    ? ` Sinyal pemeriksaan bukti (heuristik, perlu review petugas): ${fraudSignals.join(', ')}.`
    : '';

  // W15: KTP / identity documents are NEVER blurred (needed for manual admin
  // verification) and are admin-eyes-only. General report photos keep the
  // env-driven redaction behavior above (targeted face blur when the model is
  // present, whole-image blur fallback, or never forwarded in 'degraded').
  // Open TODO: license-plate detection (no plate model vetted yet).
  const adminOnly = input.retainBytes === true || kind === 'document';

  // W15: persist intake to the DB registry (best-effort; never fails intake).
  await recordMediaIntake({
    villageId: tenantId,
    userId,
    sha256: hash,
    phash: phash ?? undefined,
    messageId: input.messageId,
    mediaKind: kind,
    bytes: bytes.length,
    exifStripped,
    redaction: effectiveRedaction,
    adminOnly,
  });

  return {
    hasImage: true, sha256: hash, phash: phash ?? undefined, duplicate: false,
    exifStripped, redaction: effectiveRedaction, forwardToLlm: false,
    estimatedKind: kind, bytes: bytes.length,
    fraudSignals,
    adminOnly,
    bytesForOcr: isOcrConfigured() ? bytes : undefined,
    retainedBytes: input.retainBytes ? (redactedBytes ?? bytes) : undefined,
    promptFact:
      '[SINYAL MEDIA] Warga melampirkan 1 gambar ' +
      `(${kind === 'unknown' ? 'jenis tidak diketahui' : kind}, hash ${hash.slice(0, 12)}…). ` +
      (effectiveRedaction === 'done'
        ? 'Gambar telah diburamkan (blur) untuk privasi sebelum diproses lebih lanjut. '
        : 'Redaksi wajah/plat nomor BELUM tersedia di environment ini, sehingga gambar tidak diteruskan ' +
          'ke AI. ') +
      'Perlakukan sebagai bukti visual yang belum terverifikasi; ' +
      'jika isi gambar penting untuk laporan, minta warga mendeskripsikannya dengan kata-kata. ' +
      'JANGAN meminta warga mengirim ulang gambar yang sama.' +
      (moderation.flagged
        ? ' PERHATIAN: gambar ditandai untuk review moderasi (heuristik). Teruskan ke admin.'
        : '') +
      fraudNote,
  };
}
