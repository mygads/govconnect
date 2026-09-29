/**
 * R10 — OTP binding + SID adapter tests.
 *
 * Pure unit tests (no DB, no network):
 *  - OTP code generation: 6 digits, format valid.
 *  - OTP hashing: deterministic, pepper-sensitive, tidak menyimpan plaintext.
 *  - Validasi nomor WA dan NIK.
 *  - SID adapter: unconfigured menolak eksplisit (SidNotConfiguredError),
 *    isConfigured false, registry bisa di-override untuk integrasi nyata.
 */
import { describe, it, expect } from 'vitest';
import {
  generateOtpCode, hashOtp, isValidWaNumber, isValidNik,
} from '../otp-binding';
import {
  UnconfiguredSidAdapter, SidNotConfiguredError,
  registerSidAdapter, getSidAdapter, isSidConfigured,
  type SidAdapter,
} from '../sid-adapter';

describe('OTP code generation', () => {
  it('menghasilkan 6 digit numerik', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^[0-9]{6}$/);
    }
  });

  it('tidak selalu sama (random)', () => {
    const codes = new Set(Array.from({ length: 10 }, () => generateOtpCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('OTP hashing', () => {
  it('deterministik untuk kode yang sama', () => {
    expect(hashOtp('123456')).toBe(hashOtp('123456'));
  });

  it('berbeda untuk kode berbeda', () => {
    expect(hashOtp('123456')).not.toBe(hashOtp('654321'));
  });

  it('hash bukan plaintext kode', () => {
    const h = hashOtp('123456');
    expect(h).not.toContain('123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });
});

describe('validasi input', () => {
  it('isValidWaNumber menerima 8-16 digit', () => {
    expect(isValidWaNumber('628123456789')).toBe(true);
    expect(isValidWaNumber('08123456')).toBe(true);
    expect(isValidWaNumber('1234567')).toBe(false); // 7 digit
    expect(isValidWaNumber('12345678901234567')).toBe(false); // 17 digit
    expect(isValidWaNumber('+62812')).toBe(false); // ada +
    expect(isValidWaNumber('08abc123')).toBe(false); // ada huruf
    expect(isValidWaNumber('')).toBe(false);
  });

  it('isValidNik menerima tepat 16 digit', () => {
    expect(isValidNik('3201010101010001')).toBe(true);
    expect(isValidNik('320101010101001')).toBe(false); // 15 digit
    expect(isValidNik('32010101010100011')).toBe(false); // 17 digit
    expect(isValidNik('320101010101000a')).toBe(false);
    expect(isValidNik('')).toBe(false);
  });
});

describe('SID adapter (jujur: belum terkonfigurasi)', () => {
  it('UnconfiguredSidAdapter.isConfigured selalu false', async () => {
    const a = new UnconfiguredSidAdapter();
    expect(a.name).toBe('unconfigured');
    expect(await a.isConfigured('TEST-DESA-A')).toBe(false);
  });

  it('lookupByNikToken melempar SidNotConfiguredError (never fake-verified)', async () => {
    const a = new UnconfiguredSidAdapter();
    await expect(a.lookupByNikToken('TEST-DESA-A', 'tok_test'))
      .rejects.toThrow(SidNotConfiguredError);
  });

  it('error menjelaskan cara konfigurasi yang benar', async () => {
    const a = new UnconfiguredSidAdapter();
    try {
      await a.lookupByNikToken('DESA-X', 'tok');
      expect.unreachable();
    } catch (err: any) {
      expect(err.message).toContain('belum dikonfigurasi');
      expect(err.message).toContain('Secure Vault');
    }
  });

  it('registry default ke unconfigured untuk desa tak dikenal', async () => {
    const a = getSidAdapter('DESA-TIDAK-ADA-' + Date.now());
    expect(a.name).toBe('unconfigured');
    expect(await isSidConfigured('DESA-TIDAK-ADA-' + Date.now())).toBe(false);
  });

  it('registry bisa di-override untuk integrasi nyata (masa depan)', async () => {
    const vid = 'DESA-MOCK-' + Date.now();
    const mockAdapter: SidAdapter = {
      name: 'mock-opensid',
      isConfigured: async () => true,
      lookupByNikToken: async () => ({ nikFound: true, isResident: true }),
    };
    registerSidAdapter(vid, mockAdapter);
    expect(getSidAdapter(vid).name).toBe('mock-opensid');
    expect(await isSidConfigured(vid)).toBe(true);
    const res = await getSidAdapter(vid).lookupByNikToken(vid, 'tok');
    expect(res.nikFound).toBe(true);
  });
});
