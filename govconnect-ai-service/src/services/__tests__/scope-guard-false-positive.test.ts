/**
 * Regression tests for the out-of-scope guard and phone-grounding verifier.
 *
 * These encode audit findings where the original regexes misrouted
 * legitimate village conversation to out-of-scope or incorrectly downgraded
 * references to status codes as "fabricated phone numbers".
 */

import { describe, it, expect } from 'vitest';
import { tryHandleOutOfScopeGuard } from '../pre-agent-state-router.service';

const runGuard = (message: string) =>
  tryHandleOutOfScopeGuard({ message, traceId: 't-scope', startTime: Date.now() });

describe('out-of-scope guard — villager phrasing must NOT be rejected', () => {
  const shouldPassThrough = [
    'program pkh kapan cair?',
    'ada program bantuan buat warga?',
    'bantuan sosial program keluarga harapan',
    'sepak bola antar RT besok jadi gak?',
    'film dokumenter desa kami bisa diputar?',
    'artis wali datang ke acara 17-an kok',
    'mau urus surat pengantar untuk bpjs',
    'loop buat urus ktp gimana?',
    'rumus perhitungan pajak bumi desa',
    'ada pengajian malam ini pak lurah?',
    // Direct village help questions
    'kapan jam buka kantor desa?',
    'alamat kantor desa dimana?',
  ];

  for (const msg of shouldPassThrough) {
    it(`lets through: "${msg}"`, () => {
      const result = runGuard(msg);
      expect(result).toBeNull();
    });
  }
});

describe('out-of-scope guard — genuine off-topic MUST be rejected', () => {
  const shouldReject = [
    'ajari saya javascript dong',
    'rekomendasi film netflix',
    '1+1 berapa?',
    'kerjain soal matematika pr saya',
    'bahas artis K-pop dong',
    'gimana cara bikin aplikasi javascript',
    'zodiak saya hari ini apa?',
    'horoskop mingguan',
  ];

  for (const msg of shouldReject) {
    it(`rejects: "${msg}"`, () => {
      const result = runGuard(msg);
      expect(result).not.toBeNull();
      expect(result?.intent).toBe('QUESTION');
    });
  }
});

describe('phone-number grounding regex is tight (no false positives on ref codes / NIK / RT)', () => {
  const phonePattern = /(?:(?<![-\w])0\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}(?!\d)|\+?62\s?\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}|(?<!\d)08\d{8,11}(?!\d)|\(0\d{2,3}\)\s?\d{6,8})/;
  const refPattern = /\b(LAP|LAY|LYN|RPT)-\d{8}-\d{3}\b/i;

  const matrix = [
    ['Nomor puskesmas Solo adalah 0812-3456-7890', true, false],
    ['Hubungi 021-555-1234', true, false],
    ['Kontaknya +62 811 0000 1111', true, false],
    ['Hub: (021) 123456', true, false],
    ['laporan LAP-20260101-001 anda sudah diterima', false, true],
    ['jumlah warga 1234', false, false],
    ['tahun 2024 ada 12,345 orang', false, false],
    ['RT 03/04 sudah dilayani', false, false],
    ['kk saya 3274 1234 5678 9012', false, false],
    ['ktp saya nomornya 3274011234567890', false, false],
  ] as const;

  for (const [text, expectPhone, expectRef] of matrix) {
    it(`matrix: "${text}"`, () => {
      expect(phonePattern.test(text)).toBe(expectPhone);
      expect(refPattern.test(text)).toBe(expectRef);
    });
  }
});
