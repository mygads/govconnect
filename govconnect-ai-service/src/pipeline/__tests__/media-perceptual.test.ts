/**
 * W15: unit tests untuk pHash (dHash), Hamming distance, moderasi heuristik,
 * dan blur — modul media-perceptual.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  dHash,
  hammingDistance,
  moderateImage,
  blurImage,
  isSharpAvailable,
  PHASH_NEAR_DUP_THRESHOLD,
} from '../media-perceptual';

const sharpAvailable = isSharpAvailable();

/** Buat PNG solid-color via sharp (skip bila sharp tidak ada). */
async function solidPng(r: number, g: number, b: number, w = 64, h = 64): Promise<Buffer | null> {
  if (!sharpAvailable) return null;
  const sharp = (await import('sharp')).default;
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

describe('media-perceptual (W15)', () => {
  it('dHash menghasilkan 16 hex char yang deterministik', async () => {
    const img = await solidPng(200, 100, 50);
    if (!img) return; // sharp tidak tersedia → skip
    const h1 = await dHash(img);
    const h2 = await dHash(img);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(h1).toBe(h2);
  });

  it('dHash robust terhadap resize (near-duplicate terdeteksi)', async () => {
    const big = await solidPng(200, 100, 50, 128, 128);
    const small = await solidPng(200, 100, 50, 32, 32);
    if (!big || !small) return;
    const h1 = await dHash(big);
    const h2 = await dHash(small);
    expect(h1).not.toBeNull();
    expect(h2).not.toBeNull();
    // Gambar solid identik → hash identik walau beda ukuran
    expect(hammingDistance(h1!, h2!)).toBeLessThanOrEqual(PHASH_NEAR_DUP_THRESHOLD);
  });

  it('hammingDistance: identik=0, beda total=64', () => {
    expect(hammingDistance('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa')).toBe(0);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('ff00ff00ff00ff00', 'ff00ff00ff00ff00')).toBe(0);
    // 1 bit beda
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
  });

  it('hammingDistance input invalid → 64', () => {
    expect(hammingDistance('abc', 'aaaaaaaaaaaaaaaa')).toBe(64);
  });

  it('moderateImage: gambar solid non-kulit tidak di-flag', async () => {
    const img = await solidPng(30, 80, 200); // biru
    if (!img) return;
    const res = await moderateImage(img);
    expect(res.flagged).toBe(false);
    expect(res.skinRatio).toBeLessThan(0.45);
  });

  it('moderateImage: gambar solid warna kulit di-flag (heuristik)', async () => {
    const img = await solidPng(210, 150, 110); // skin tone
    if (!img) return;
    const res = await moderateImage(img);
    expect(res.flagged).toBe(true);
    expect(res.skinRatio).toBeGreaterThanOrEqual(0.45);
  });

  it('blurImage mengembalikan buffer berbeda dari input', async () => {
    const img = await solidPng(200, 100, 50);
    if (!img) return;
    // Buat pola agar blur terlihat: campur dua warna via composite
    const sharp = (await import('sharp')).default;
    const patterned = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 32, height: 64, channels: 3, background: { r: 255, g: 255, b: 255 } },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const blurred = await blurImage(patterned, 8);
    expect(blurred).not.toBeNull();
    expect(Buffer.compare(blurred!, patterned)).not.toBe(0);
  });

  it('dHash/moderate/blur fail-soft pada buffer invalid', async () => {
    if (!sharpAvailable) return;
    const garbage = Buffer.from('bukan gambar sama sekali');
    expect(await dHash(garbage)).toBeNull();
    const mod = await moderateImage(garbage);
    expect(mod.flagged).toBe(false);
    expect(await blurImage(garbage)).toBeNull();
  });
});
