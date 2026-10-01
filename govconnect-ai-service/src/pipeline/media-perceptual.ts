/**
 * Perceptual hashing (dHash) + basic image moderation heuristics.
 *
 * W15 (arsitektur-final §2, §5.7): media pipeline requires
 * dedup via SHA-256/pHash and a moderation step before redaction.
 *
 * - dHash: 64-bit difference hash. Robust to resize/recompress/re-encode;
 *   catches near-duplicates that exact SHA-256 misses.
 * - Moderation: heuristic skin-tone ratio on a downscaled image. This is
 *   NOT a production content-moderation classifier — it flags candidates
 *   for admin review (fraudSignals), never auto-rejects evidence.
 *
 * Requires `sharp` (native). All functions fail soft (return null / empty)
 * when sharp or decoding fails — the pipeline must never crash on media.
 */

import logger from '../utils/logger';

let sharp: typeof import('sharp') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sharp = require('sharp');
} catch {
  sharp = null;
}

export function isSharpAvailable(): boolean {
  return sharp !== null;
}

/**
 * Compute the 64-bit dHash of an image buffer.
 * Steps: decode → grayscale → resize to 9x8 → compare adjacent pixels
 * horizontally → 64 bits → 16 hex chars.
 * Returns null when sharp is unavailable or decoding fails.
 */
export async function dHash(buf: Buffer): Promise<string | null> {
  if (!sharp) return null;
  try {
    const { data, info } = await sharp(buf)
      .greyscale()
      .resize(9, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== 9 || info.height !== 8 || data.length < 72) return null;
    let hash = 0n;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = data[y * 9 + x]!;
        const right = data[y * 9 + x + 1]!;
        hash = (hash << 1n) | (left > right ? 1n : 0n);
      }
    }
    return hash.toString(16).padStart(16, '0');
  } catch (err) {
    logger.debug('[media-perceptual] dHash failed', {
      error: String((err as Error)?.message ?? err).slice(0, 100),
    });
    return null;
  }
}

/** Hamming distance between two 16-hex-char dHashes. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) return 64;
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    let xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

/** Max Hamming distance to consider two images near-duplicates. */
export const PHASH_NEAR_DUP_THRESHOLD = Number(
  process.env.MEDIA_PHASH_THRESHOLD ?? 8,
);

export interface ModerationResult {
  /** Heuristic flag — for admin review only, never auto-reject. */
  flagged: boolean;
  /** 0..1 skin-tone pixel ratio on the downscaled sample. */
  skinRatio: number;
  /** Raw RGB stats for audit. */
  detail: string;
}

/**
 * Basic explicit-content heuristic: fraction of pixels in a downscaled
 * (32x32) image whose RGB falls in a skin-tone range.
 *
 * Thresholds (env-overridable):
 * - MEDIA_MODERATION_SKIN_RATIO (default 0.45): above → flagged
 *
 * This is intentionally conservative and review-oriented: cultural dress,
 * close-up faces, and desert/sand photos can trigger it. A `flagged`
 * result adds a `moderation_review` fraud signal; it NEVER blocks the
 * report or deletes the image.
 */
export async function moderateImage(buf: Buffer): Promise<ModerationResult> {
  const empty: ModerationResult = { flagged: false, skinRatio: 0, detail: 'unavailable' };
  if (!sharp) return empty;
  try {
    const { data, info } = await sharp(buf)
      .resize(32, 32, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const px = data.length / channels;
    if (px === 0) return empty;
    let skin = 0;
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      // Classic skin-tone heuristic (RGB rule).
      if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) {
        skin++;
      }
    }
    const ratio = skin / px;
    const threshold = Number(process.env.MEDIA_MODERATION_SKIN_RATIO ?? 0.45);
    return {
      flagged: ratio >= threshold,
      skinRatio: Number(ratio.toFixed(3)),
      detail: `skin=${skin}/${px}`,
    };
  } catch (err) {
    logger.debug('[media-perceptual] moderation failed', {
      error: String((err as Error)?.message ?? err).slice(0, 100),
    });
    return empty;
  }
}

/**
 * Strip ALL metadata (EXIF, XMP, ICC, GPS, device info) by re-encoding the
 * image. sharp drops every metadata chunk on output unless .withMetadata()
 * is called, so a plain re-encode is a reliable EXIF stripper for every
 * format sharp can decode (JPEG, PNG, WebP, …) — unlike the pure-TS
 * JPEG-APPn stripper in media-pipeline.ts which only handles JPEG.
 *
 * Returns the re-encoded buffer, or null when sharp is unavailable or
 * decoding fails (caller falls back to the JPEG segment stripper).
 */
export async function stripExifMetadata(buf: Buffer): Promise<Buffer | null> {
  if (!sharp) return null;
  try {
    // No .withMetadata() → all EXIF/XMP/GPS dropped. rotate() also applies
    // the EXIF orientation so the pixels stay visually correct afterwards.
    return await sharp(buf).rotate().toBuffer();
  } catch (err) {
    logger.debug('[media-perceptual] exif strip failed', {
      error: String((err as Error)?.message ?? err).slice(0, 100),
    });
    return null;
  }
}

/**
 * Blur an image buffer (for face/plate redaction regions in future, or
 * whole-image fallback). Returns the blurred buffer, or null when sharp
 * is unavailable / decoding fails.
 *
 * NOTE: whole-image blur is a privacy fallback, not a substitute for
 * targeted face/plate detection (no detection model in this environment).
 */
export async function blurImage(
  buf: Buffer,
  sigma = Number(process.env.MEDIA_BLUR_SIGMA ?? 12),
): Promise<Buffer | null> {
  if (!sharp) return null;
  try {
    return await sharp(buf).blur(sigma).toBuffer();
  } catch (err) {
    logger.debug('[media-perceptual] blur failed', {
      error: String((err as Error)?.message ?? err).slice(0, 100),
    });
    return null;
  }
}
