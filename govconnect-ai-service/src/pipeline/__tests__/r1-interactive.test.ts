/**
 * R1 — Interactive messages: triage list id binding + WhatsApp Flows.
 *
 * 1. resolveTriageCategory: row id dari triage list (cat_jalan, dst)
 *    harus ter-bind ke kategori terstruktur, bukan diklasifikasi ulang dari teks.
 * 2. isTriageCategoryId: deteksi id triage vs id lain.
 * 3. WhatsApp Flows: struktur JSON valid, parse submit menghasilkan slot.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveTriageCategory,
  isTriageCategoryId,
  COMPLAINT_CATEGORY_OPTIONS,
} from '../wa-interactive';
import {
  FLOW_LAPORAN_INFRASTRUKTUR,
  FLOW_PERMOHONAN_SURAT,
  toMetaFlowJson,
  parseFlowSubmit,
  getFlowByName,
  AVAILABLE_FLOWS,
} from '../wa-flows';

describe('R1: triage list id binding', () => {
  it('resolveTriageCategory mengembalikan kategori untuk setiap opsi list', () => {
    for (const opt of COMPLAINT_CATEGORY_OPTIONS) {
      const cat = resolveTriageCategory(opt.id);
      expect(cat).not.toBeNull();
      expect(cat!.id).toBe(opt.id);
      expect(cat!.title).toBe(opt.title);
      expect(cat!.typeKey).toBeTruthy();
    }
  });

  it('resolveTriageCategory null untuk id tidak dikenal', () => {
    expect(resolveTriageCategory('confirm_send')).toBeNull();
    expect(resolveTriageCategory('cat_tidak_ada')).toBeNull();
    expect(resolveTriageCategory('')).toBeNull();
    expect(resolveTriageCategory(null)).toBeNull();
    expect(resolveTriageCategory(undefined)).toBeNull();
  });

  it('resolveTriageCategory null untuk id tanpa prefix cat_', () => {
    expect(resolveTriageCategory('jalan_rusak')).toBeNull();
  });

  it('isTriageCategoryId true hanya untuk id triage', () => {
    expect(isTriageCategoryId('cat_jalan')).toBe(true);
    expect(isTriageCategoryId('cat_lain')).toBe(true);
    expect(isTriageCategoryId('confirm_send')).toBe(false);
    expect(isTriageCategoryId('edit_data')).toBe(false);
    expect(isTriageCategoryId(null)).toBe(false);
  });

  it('semua opsi list punya id unik dengan prefix cat_', () => {
    const ids = COMPLAINT_CATEGORY_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith('cat_')).toBe(true);
    }
  });
});

describe('R1: WhatsApp Flows structure', () => {
  it('flow laporan infrastruktur punya field wajib', () => {
    const names = FLOW_LAPORAN_INFRASTRUKTUR.fields.map((f) => f.name);
    expect(names).toContain('kategori');
    expect(names).toContain('lokasi');
    expect(names).toContain('deskripsi');
    const required = FLOW_LAPORAN_INFRASTRUKTUR.fields.filter((f) => f.required);
    expect(required.length).toBeGreaterThan(0);
  });

  it('toMetaFlowJson menghasilkan struktur Flow v5 valid', () => {
    const json = toMetaFlowJson(FLOW_LAPORAN_INFRASTRUKTUR) as any;
    expect(json.version).toBe('5.0');
    expect(Array.isArray(json.screens)).toBe(true);
    expect(json.screens.length).toBe(2); // FORM + SUCCESS
    expect(json.screens[0].id).toBe('FORM');
    expect(json.screens[1].id).toBe('SUCCESS');
  });

  it('parseFlowSubmit mengubah JSON submit jadi slot', () => {
    const slots = parseFlowSubmit('laporan_infrastruktur', {
      kategori: 'jalan_rusak',
      lokasi: 'Jl. Merdeka RT 03',
      deskripsi: '  Jalan berlubang besar  ',
      kosong: '',
    });
    expect(slots['kategori']).toBe('jalan_rusak');
    expect(slots['lokasi']).toBe('Jl. Merdeka RT 03');
    expect(slots['deskripsi']).toBe('Jalan berlubang besar'); // trimmed
    expect(slots['kosong']).toBeUndefined(); // empty di-skip
    expect(slots['_flow_name']).toBe('laporan_infrastruktur');
    expect(slots['_flow_submitted']).toBe('true');
  });

  it('getFlowByName menemukan flow terdaftar', () => {
    expect(getFlowByName('laporan_infrastruktur')).not.toBeNull();
    expect(getFlowByName('permohonan_surat')).not.toBeNull();
    expect(getFlowByName('tidak_ada')).toBeNull();
  });

  it('semua flow terdaftar punya nama unik', () => {
    const names = AVAILABLE_FLOWS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('flow permohonan surat punya field nama dan keperluan', () => {
    const names = FLOW_PERMOHONAN_SURAT.fields.map((f) => f.name);
    expect(names).toContain('jenis_surat');
    expect(names).toContain('nama_lengkap');
    expect(names).toContain('keperluan');
  });
});
