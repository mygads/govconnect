/**
 * Tests for R14: KTP OCR pre-fill (ocr-ktp.ts).
 *
 * - validateKtpFields / prefillSlotsFromKtp are pure: no mocks needed.
 * - extractKtpFields: global fetch is stubbed; the sidecar is never hit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateKtpFields,
  prefillSlotsFromKtp,
  buildOcrPrefillFact,
  extractKtpFields,
  isOcrConfigured,
  getOcrMinConfidence,
  type OcrField,
} from '../ocr-ktp';

const F = (value: string | null, confidence: number | null): OcrField => ({
  value,
  confidence,
});

const savedEnv: Record<string, string | undefined> = {
  OCR_ENABLED: process.env.OCR_ENABLED,
  OCR_API_URL: process.env.OCR_API_URL,
  OCR_API_KEY: process.env.OCR_API_KEY,
  OCR_MIN_CONFIDENCE: process.env.OCR_MIN_CONFIDENCE,
};

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

describe('ocr config helpers', () => {
  it('isOcrConfigured requires the flag AND a URL', () => {
    delete process.env.OCR_ENABLED;
    delete process.env.OCR_API_URL;
    expect(isOcrConfigured()).toBe(false);
    process.env.OCR_ENABLED = 'true';
    expect(isOcrConfigured()).toBe(false);
    process.env.OCR_API_URL = 'http://ocr:8001';
    expect(isOcrConfigured()).toBe(true);
  });

  it('getOcrMinConfidence defaults to 0.6 and clamps garbage', () => {
    delete process.env.OCR_MIN_CONFIDENCE;
    expect(getOcrMinConfidence()).toBe(0.6);
    process.env.OCR_MIN_CONFIDENCE = 'bogus';
    expect(getOcrMinConfidence()).toBe(0.6);
    process.env.OCR_MIN_CONFIDENCE = '0.8';
    expect(getOcrMinConfidence()).toBe(0.8);
  });
});

describe('validateKtpFields', () => {
  it('accepts a valid 16-digit NIK', () => {
    const { valid, dropped } = validateKtpFields({
      nik: F('3273010101900001', 0.98),
    });
    expect(valid).toHaveLength(1);
    expect(valid[0]!.value).toBe('3273010101900001');
    expect(dropped).toHaveLength(0);
  });

  it('normalizes spaced NIK but drops non-16-digit NIK', () => {
    const spaced = validateKtpFields({ nik: F('3273 0101 0190 0001', 0.9) });
    expect(spaced.valid[0]!.value).toBe('3273010101900001');
    const short = validateKtpFields({ nik: F('327301010190001', 0.9) });
    expect(short.valid).toHaveLength(0);
    expect(short.dropped[0]!.reason).toContain('16 digit');
  });

  it('drops low-confidence fields without fixing them up', () => {
    const { valid, dropped } = validateKtpFields(
      { nama: F('BUDI SANTOSO', 0.4) },
      0.6,
    );
    expect(valid).toHaveLength(0);
    expect(dropped[0]!.reason).toContain('keyakinan rendah');
  });

  it('validates tanggal_lahir as a real DD-MM-YYYY date', () => {
    const ok = validateKtpFields({ tanggal_lahir: F('01-01-1990', 0.9) });
    expect(ok.valid[0]!.value).toBe('01-01-1990');
    const bad = validateKtpFields({ tanggal_lahir: F('31-02-2000', 0.9) });
    expect(bad.valid).toHaveLength(0);
    expect(bad.dropped[0]!.reason).toContain('tanggal lahir');
    const wrongFormat = validateKtpFields({ tanggal_lahir: F('1990-01-01', 0.9) });
    expect(wrongFormat.valid).toHaveLength(0);
  });

  it('skips null/empty fields silently', () => {
    const { valid, dropped } = validateKtpFields({
      nama: F(null, null),
      pekerjaan: F('   ', 0.9),
    });
    expect(valid).toHaveLength(0);
    expect(dropped).toHaveLength(0);
  });
});

describe('prefillSlotsFromKtp', () => {
  const fields = {
    nik: F('3273010101900001', 0.98),
    nama: F('BUDI SANTOSO', 0.95),
    tanggal_lahir: F('01-01-1990', 0.93),
  };

  it('fills empty reporter_name but never overwrites citizen input', () => {
    const slots: Record<string, unknown> = {};
    const out = prefillSlotsFromKtp(slots, fields);
    expect(slots.reporter_name).toBe('BUDI SANTOSO');
    expect(out.filledSlots).toEqual(['reporter_name']);

    const slots2: Record<string, unknown> = { reporter_name: 'Diketik sendiri' };
    prefillSlotsFromKtp(slots2, fields);
    expect(slots2.reporter_name).toBe('Diketik sendiri');
  });

  it('records identity candidates with confirmation required, NIK never a slot', () => {
    const slots: Record<string, unknown> = {};
    const out = prefillSlotsFromKtp(slots, fields);
    expect(slots.nik).toBeUndefined(); // NIK is a candidate, not a slot
    const cands = slots._ocr_identity as Array<{ field: string; needsConfirmation: boolean }>;
    expect(cands.map((c) => c.field).sort()).toEqual(['nama', 'nik', 'tanggal_lahir']);
    expect(cands.every((c) => c.needsConfirmation)).toBe(true);
    expect(out.identityCandidates).toHaveLength(3);
  });

  it('dropped fields are reported, not pre-filled', () => {
    const slots: Record<string, unknown> = {};
    const out = prefillSlotsFromKtp(slots, {
      nik: F('123', 0.99), // invalid format
      nama: F('BUDI', 0.95),
    });
    expect(slots.reporter_name).toBe('BUDI');
    expect(out.dropped.map((d) => d.field)).toEqual(['nik']);
  });
});

describe('buildOcrPrefillFact', () => {
  it('presents values for confirmation and warns about vault writes', () => {
    const slots: Record<string, unknown> = {};
    const outcome = prefillSlotsFromKtp(slots, {
      nik: F('3273010101900001', 0.98),
      nama: F('BUDI SANTOSO', 0.95),
    });
    const fact = buildOcrPrefillFact(outcome);
    expect(fact).toContain('BUDI SANTOSO');
    expect(fact).toContain('3273010101900001');
    expect(fact).toContain('BELUM TERVERIFIKASI');
    expect(fact).toContain('konfirmasi eksplisit');
    expect(fact).toContain('JANGAN simpan NIK ke vault');
  });
});

describe('extractKtpFields', () => {
  function enableOcr() {
    process.env.OCR_ENABLED = 'true';
    process.env.OCR_API_URL = 'http://ocr:8001';
  }

  it('returns null without calling fetch when not configured', async () => {
    delete process.env.OCR_ENABLED;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await extractKtpFields(Buffer.from('img'))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses a successful sidecar response', async () => {
    enableOcr();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          fields: { nik: { value: '3273010101900001', confidence: 0.98 } },
          overall_confidence: 0.9,
          engine: 'paddleocr',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await extractKtpFields(Buffer.from('img'));
    expect(res?.fields.nik?.value).toBe('3273010101900001');
    expect(res?.overallConfidence).toBe(0.9);
    expect(fetchMock).toHaveBeenCalledWith('http://ocr:8001/ocr/ktp', expect.anything());
  });

  it('returns null on sidecar HTTP error and on network failure', async () => {
    enableOcr();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 503 })));
    expect(await extractKtpFields(Buffer.from('img'))).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await extractKtpFields(Buffer.from('img'))).toBeNull();
  });
});
