/**
 * A4: fraud-signal tests (pure — synthetic JPEG bytes, no fixtures).
 */
import { describe, it, expect } from 'vitest';
import {
  extractExifDateTimeOriginal, extractJpegDimensions, computeFraudSignals,
} from '../media-pipeline';
import { createHash } from 'crypto';

/** Build a minimal JPEG: SOI + optional APP1(Exif DateTimeOriginal) + SOF0. */
function makeJpeg(opts: { exifDate?: string; width?: number; height?: number }): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (opts.exifDate) {
    const dateStr = opts.exifDate + '\0';
    const dateBytes = Buffer.from(dateStr, 'ascii');
    // TIFF (little-endian): header + IFD0(1 entry: EXIF sub-IFD ptr) + sub-IFD(1 entry: 0x9003)
    const tiffHeader = Buffer.alloc(8);
    tiffHeader.write('II', 0);
    tiffHeader.writeUInt16LE(42, 2);
    tiffHeader.writeUInt32LE(8, 4); // IFD0 at +8
    const ifd0 = Buffer.alloc(18);
    ifd0.writeUInt16LE(1, 0);
    ifd0.writeUInt16LE(0x8769, 2); // EXIF sub-IFD pointer
    ifd0.writeUInt16LE(4, 4); // LONG
    ifd0.writeUInt32LE(1, 6);
    ifd0.writeUInt32LE(26, 10); // sub-IFD at TIFF+26
    ifd0.writeUInt32LE(0, 14);
    const subIfd = Buffer.alloc(18);
    subIfd.writeUInt16LE(1, 0);
    subIfd.writeUInt16LE(0x9003, 2); // DateTimeOriginal
    subIfd.writeUInt16LE(2, 4); // ASCII
    subIfd.writeUInt32LE(dateBytes.length, 6);
    subIfd.writeUInt32LE(44, 10); // string at TIFF+44
    subIfd.writeUInt32LE(0, 14);
    const exifBody = Buffer.concat([
      Buffer.from('Exif\0\0', 'ascii'), tiffHeader, ifd0, subIfd, dateBytes,
    ]);
    const app1 = Buffer.alloc(2 + 2 + exifBody.length);
    app1[0] = 0xff; app1[1] = 0xe1;
    app1.writeUInt16BE(2 + exifBody.length, 2);
    exifBody.copy(app1, 4);
    parts.push(app1);
  }
  const w = opts.width ?? 800, h = opts.height ?? 600;
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08,
    (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff,
    0x01, 0x01, 0x11, 0x00]);
  parts.push(sof);
  return Buffer.concat(parts);
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('extractExifDateTimeOriginal', () => {
  it('reads DateTimeOriginal from APP1', () => {
    expect(extractExifDateTimeOriginal(makeJpeg({ exifDate: '2026:03:01 10:00:00' })))
      .toBe('2026:03:01 10:00:00');
  });
  it('returns null when no EXIF', () => {
    expect(extractExifDateTimeOriginal(makeJpeg({}))).toBeNull();
  });
  it('returns null for non-JPEG', () => {
    expect(extractExifDateTimeOriginal(Buffer.from('not a jpeg'))).toBeNull();
  });
});

describe('extractJpegDimensions', () => {
  it('reads width/height from SOF0', () => {
    expect(extractJpegDimensions(makeJpeg({ width: 200, height: 100 })))
      .toEqual({ width: 200, height: 100 });
  });
  it('returns null for non-JPEG', () => {
    expect(extractJpegDimensions(Buffer.from('nope'))).toBeNull();
  });
});

describe('computeFraudSignals', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  it('clean photo → no signals', () => {
    const b = makeJpeg({ exifDate: '2026:03:01 10:00:00', width: 1200, height: 900 });
    expect(computeFraudSignals({ bytes: b, sha256: sha(b), duplicate: false, now })).toEqual([]);
  });
  it('duplicate → duplicate_image', () => {
    const b = makeJpeg({});
    const s = computeFraudSignals({ bytes: b, sha256: sha(b), duplicate: true, now });
    expect(s).toContain('duplicate_image');
  });
  it('future EXIF date → exif_datetime_suspicious', () => {
    const b = makeJpeg({ exifDate: '2030:01:01 00:00:00' });
    const s = computeFraudSignals({ bytes: b, sha256: sha(b), duplicate: false, now });
    expect(s).toContain('exif_datetime_suspicious');
  });
  it('ancient EXIF date → exif_datetime_suspicious', () => {
    const b = makeJpeg({ exifDate: '1995:01:01 00:00:00' });
    const s = computeFraudSignals({ bytes: b, sha256: sha(b), duplicate: false, now });
    expect(s).toContain('exif_datetime_suspicious');
  });
  it('tiny image → low_resolution', () => {
    const b = makeJpeg({ width: 120, height: 90 });
    const s = computeFraudSignals({ bytes: b, sha256: sha(b), duplicate: false, now });
    expect(s).toContain('low_resolution');
  });
  it('non-JPEG → no crash, no signals', () => {
    const b = Buffer.from('hello');
    expect(computeFraudSignals({ bytes: b, sha256: sha(b), duplicate: false, now })).toEqual([]);
  });
});
