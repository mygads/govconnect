/**
 * Tests for R3: KB upload router (rag | skill | both | rejected).
 *
 * Deterministic classifier — same input always yields the same route.
 * The critical safety property: 'rejected' (type-D: jam/tarif/kontak
 * authoritative in case-service) must fire for genuine operational dumps
 * and must NOT fire for documents that merely mention such data in passing
 * (e.g. a Perdes citing a fee).
 */

import { describe, it, expect } from 'vitest';

import {
  routeKnowledgeDocument,
  KB_REJECTED_COPY,
  type KbRoute,
} from '../kb-router.service';

function routeOf(title: string, text: string): KbRoute {
  return routeKnowledgeDocument({ title, text }).route;
}

describe('R3: type-D rejection (authoritative operational data)', () => {
  it('rejects a tariff sheet', () => {
    const r = routeKnowledgeDocument({
      title: 'Tarif Retribusi Sampah 2026',
      text: [
        'TARIF RETRIBUSI SAMPAH TAHUN 2026',
        'Rumah tangga: Rp15.000/bulan',
        'Usaha kecil: Rp50.000/bulan',
        'Usaha besar: Rp150.000/bulan',
      ].join('\n'),
    });
    expect(r.route).toBe('rejected');
    expect(r.reasons.join(' ')).toMatch(/otoritatif/i);
  });

  it('rejects an office-hours notice', () => {
    expect(
      routeOf(
        'Jam Layanan Kantor Desa',
        [
          'JAM LAYANAN KANTOR DESA',
          'Senin - Jumat: 08.00 - 14.00',
          'Sabtu: 08.00 - 11.00',
          'Kontak: 081234567890',
        ].join('\n'),
      ),
    ).toBe('rejected');
  });

  it('rejects a contact/emergency-number list', () => {
    expect(
      routeOf(
        'Nomor Penting Desa',
        [
          'NOMOR DARURAT DAN KONTAK PENTING',
          'Ambulans desa: 081111111111',
          'Pemadam kebakaran: 081222222222',
          'Kantor desa: 081333333333',
          'Hubungi call center desa untuk informasi.',
        ].join('\n'),
      ),
    ).toBe('rejected');
  });

  it('rejection copy directs admins to case-service', () => {
    expect(KB_REJECTED_COPY).toContain('case-service');
  });
});

describe('R3: no false rejections', () => {
  it('does NOT reject a Perdes that merely mentions a fee', () => {
    expect(
      routeOf(
        'Perdes No 3 Tahun 2025 tentang Pengelolaan Sampah',
        [
          'PERATURAN DESA NOMOR 3 TAHUN 2025',
          'TENTANG PENGELOLAAN SAMPAH',
          'Pasal 1: Ketentuan umum.',
          'Pasal 5: Setiap rumah tangga wajib membayar biaya administrasi Rp50.000 per bulan.',
          'Pasal 6: Sanksi administratif.',
        ].join('\n'),
      ),
    ).toBe('rag');
  });

  it('does NOT reject a procedural guide that lists office hours', () => {
    const r = routeOf(
      'Alur Pengurusan Surat Keterangan',
      [
        'TATA CARA PENGURUSAN SURAT KETERANGAN',
        'Jam layanan: Senin-Jumat 08.00-14.00.',
        '1. Datang ke kantor desa.',
        '2. Isi formulir.',
        '3. Serahkan syarat dokumen.',
        '4. Tunggu verifikasi petugas.',
      ].join('\n'),
    );
    expect(r).not.toBe('rejected');
  });
});

describe('R3: skill / both / rag routing', () => {
  it('routes a numbered SOP to skill', () => {
    expect(
      routeOf(
        'Alur Mengurus KTP',
        [
          'TATA CARA MENGURUS KTP',
          '1. Datang ke kantor desa dengan membawa KK asli.',
          '2. Isi formulir permohonan.',
          '3. Petugas memfoto dan merekam tanda tangan.',
          '4. Tunggu 14 hari kerja.',
          'Syarat: berusia 17 tahun.',
        ].join('\n'),
      ),
    ).toBe('skill');
  });

  it('routes a mixed service guide to both', () => {
    expect(
      routeOf(
        'Panduan Layanan Administrasi',
        [
          'PANDUAN LAYANAN ADMINISTRASI DESA',
          'Berdasarkan Peraturan Desa Nomor 1 Tahun 2024, Pasal 3 mengatur jenis layanan.',
          'Langkah pengurusan:',
          '1. Siapkan syarat dokumen.',
          '2. Datang ke kantor desa.',
          '3. Ikuti alur verifikasi petugas.',
        ].join('\n'),
      ),
    ).toBe('both');
  });

  it('routes a plain announcement to rag', () => {
    expect(
      routeOf(
        'Pengumuman Musyawarah Desa',
        'PENGUMUMAN\nMusyawarah desa akan diadakan pada hari Minggu di balai desa. Warga diharapkan hadir.',
      ),
    ).toBe('rag');
  });

  it('is deterministic: same input, same route', () => {
    const input = {
      title: 'Tarif Retribusi Sampah 2026',
      text: 'TARIF RETRIBUSI\nRumah tangga: Rp15.000/bulan\nKontak: 081234567890',
    };
    const a = routeKnowledgeDocument(input);
    const b = routeKnowledgeDocument(input);
    expect(a).toEqual(b);
  });

  it('handles empty text without crashing', () => {
    expect(routeOf('Dokumen kosong', '')).toBe('rag');
  });
});
