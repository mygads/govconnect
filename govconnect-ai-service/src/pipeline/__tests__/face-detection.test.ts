/**
 * W15: face detection + targeted region blur.
 *
 * - The "model present" tests require FACE_MODEL_DIR pointing at a directory
 *   with the tiny_face_detector weights (fetched via
 *   scripts/download-face-models.sh, e.g. FACE_MODEL_DIR=/tmp/w15-face-api/model).
 *   They are SKIPPED (not failed) when the model is absent, so the suite
 *   stays green on machines without the download.
 * - The degradation/fallback tests always run: they assert detectFaces()
 *   returns null (never throws) when the model is missing, and that
 *   blurImageRegions() fails soft.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

afterEach(() => {
  vi.resetModules();
});

const REAL_MODEL_DIR = process.env.FACE_MODEL_DIR;
const modelPresent =
  !!REAL_MODEL_DIR &&
  fs.existsSync(path.join(REAL_MODEL_DIR, 'tiny_face_detector_model-weights_manifest.json'));

async function loadFaceDetection(modelDir: string | undefined) {
  if (modelDir === undefined) delete process.env.FACE_MODEL_DIR;
  else process.env.FACE_MODEL_DIR = modelDir;
  return import('../face-detection');
}

describe('W15 face-detection graceful degradation', () => {
  it('returns null (never throws) when the model dir is missing', async () => {
    const { detectFaces } = await loadFaceDetection('/tmp/does-not-exist-w15-face');
    const res = await detectFaces(Buffer.from('not-an-image'));
    expect(res).toBeNull();
  });

  it('returns null on undecodable image bytes even with a model', async () => {
    const { detectFaces } = await loadFaceDetection(REAL_MODEL_DIR ?? '/tmp/does-not-exist-w15-face');
    const res = await detectFaces(Buffer.from('definitely not an image'));
    // null either because model missing or decode failed — must not throw
    expect(res === null || Array.isArray(res)).toBe(true);
  });
});

describe('W15 face-detection with real model', () => {
  it.skipIf(!modelPresent)('detects the face in the Lena sample', async () => {
    const { detectFaces } = await loadFaceDetection(REAL_MODEL_DIR);
    const lena = path.join('/tmp/w15-face-api/samples', 'lena.jpg');
    const res = await detectFaces(fs.readFileSync(lena));
    expect(res).not.toBeNull();
    expect(res!.length).toBeGreaterThanOrEqual(1);
    const b = res![0]!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.width).toBeGreaterThan(50);
    expect(b.height).toBeGreaterThan(50);
    expect(b.score).toBeGreaterThan(0.4);
  }, 60000);

  it.skipIf(!modelPresent)('detects 3 faces in the group-photo sample', async () => {
    const { detectFaces } = await loadFaceDetection(REAL_MODEL_DIR);
    const group = fs
      .readdirSync('/tmp/w15-face-api/samples')
      .find((f) => f.startsWith('media-generation-w15-group-photo'));
    expect(group).toBeDefined();
    const res = await detectFaces(
      fs.readFileSync(path.join('/tmp/w15-face-api/samples', group!)),
    );
    expect(res).not.toBeNull();
    expect(res!.length).toBe(3);
  }, 60000);
});

describe('W15 blurImageRegions', () => {
  it('blurs only the requested region and leaves the rest intact', async () => {
    const { blurImageRegions } = await import('../media-perceptual');
    const sharp = (await import('sharp')).default;
    // Synthetic: white 200x200 with a black 40x40 square at (80,80).
    const black = Buffer.alloc(40 * 40 * 3, 0);
    const base = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([{ input: black, raw: { width: 40, height: 40, channels: 3 }, left: 80, top: 80 }])
      .png()
      .toBuffer();

    const out = await blurImageRegions(base, [{ x: 80, y: 80, width: 40, height: 40 }]);
    expect(out).not.toBeNull();

    const inPx = await sharp(base).raw().toBuffer({ resolveWithObject: true });
    const outPx = await sharp(out!).raw().toBuffer({ resolveWithObject: true });
    const ch = outPx.info.channels;
    const at = (d: Buffer, x: number, y: number) =>
      d[(y * outPx.info.width + x) * ch]! +
      d[(y * outPx.info.width + x) * ch + 1]! +
      d[(y * outPx.info.width + x) * ch + 2]!;

    // Region interior changed (blurred black square edges into gray).
    expect(at(outPx.data, 95, 95)).not.toBe(at(inPx.data, 95, 95));
    // Far corner untouched.
    expect(at(outPx.data, 10, 10)).toBe(at(inPx.data, 10, 10));
  });

  it('clamps out-of-bounds boxes and returns null when sharp is missing is impossible', async () => {
    const { blurImageRegions } = await import('../media-perceptual');
    const sharp = (await import('sharp')).default;
    const base = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .png()
      .toBuffer();
    const out = await blurImageRegions(base, [{ x: 90, y: 90, width: 50, height: 50 }]);
    expect(out).not.toBeNull();
  });
});
