/**
 * R11 — monthly report tests.
 *
 * - Pure: periodBounds (UTC month edges, Indonesian label), buildMonthlyReportData
 *   (top-5 slicing, null sections + honest notes, no fabricated numbers),
 *   renderMonthlyMarkdown (template sections, explicit cut-off, no invented
 *   analysis — Analisis/Kesimpulan/Saran are human-filled placeholders).
 */
import { describe, it, expect } from 'vitest';
import {
  periodBounds,
  buildMonthlyReportData,
  renderMonthlyMarkdown,
  type CaseAggregates,
  type AiStats,
} from '../monthly-report';

function sampleCases(): CaseAggregates {
  return {
    village_id: 'v1',
    period: { year: 2026, month: 9, start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
    cut_off: '2026-10-01T00:00:00.000Z',
    complaints: {
      total: 42,
      by_status: { OPEN: 5, PROCESS: 10, DONE: 25, CANCELED: 1, REJECT: 1 },
      by_category: [
        { kategori: 'jalan rusak', count: 12 },
        { kategori: 'banjir', count: 8 },
        { kategori: 'sampah', count: 7 },
        { kategori: 'lampu jalan', count: 5 },
        { kategori: 'air bersih', count: 4 },
        { kategori: 'lainnya', count: 6 },
      ],
      channel_status_matrix: { WHATSAPP: { OPEN: 5, DONE: 25 }, WEBCHAT: { PROCESS: 10 } },
      resolution: { resolved_count: 25, avg_hours: 72.5, note: 'Approximation note.' },
    },
    service_requests: {
      total: 10,
      by_status: { OPEN: 2, DONE: 8 },
      by_service: [{ service_id: 'sktm', count: 6 }],
      channel_status_matrix: { WHATSAPP: { DONE: 8 } },
      resolution: { resolved_count: 8, avg_hours: 48, note: 'Approximation note.' },
    },
  };
}

function sampleAi(): AiStats {
  return {
    turns: 1200,
    fallback_tickets: 17,
    cost_usd: 2.345678,
    security_events: { canary_leaks: 0, secret_rejections: 2 },
  };
}

describe('periodBounds', () => {
  it('computes UTC month edges and Indonesian label', () => {
    const { start, end, label } = periodBounds(2026, 9);
    expect(start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(label).toBe('September 2026');
  });

  it('handles December → January rollover', () => {
    const { start, end, label } = periodBounds(2026, 12);
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(label).toBe('Desember 2026');
  });
});

describe('buildMonthlyReportData', () => {
  it('slices top-5 categories and carries the cut-off', () => {
    const r = buildMonthlyReportData({
      villageId: 'v1', villageName: 'Desa X', year: 2026, month: 9,
      cases: sampleCases(), ai: sampleAi(),
    });
    expect(r.tickets?.top_categories).toHaveLength(5);
    expect(r.tickets?.top_categories[0]).toEqual({ kategori: 'jalan rusak', count: 12 });
    expect(r.cut_off).toBe('2026-10-01T00:00:00.000Z');
    expect(r.period.label).toBe('September 2026');
    expect(r.notes).toEqual([]);
  });

  it('null sections + honest notes when sources are down (never fabricated)', () => {
    const r = buildMonthlyReportData({
      villageId: 'v1', year: 2026, month: 9, cases: null, ai: null,
    });
    expect(r.tickets).toBeNull();
    expect(r.services).toBeNull();
    expect(r.ai).toBeNull();
    expect(r.notes.length).toBe(2);
    expect(r.notes.join(' ')).toMatch(/tidak tersedia/i);
    // The village name falls back to the id — no invented name.
    expect(r.village_name).toBe('v1');
  });
});

describe('renderMonthlyMarkdown', () => {
  it('renders the government template with explicit cut-off', () => {
    const r = buildMonthlyReportData({
      villageId: 'v1', villageName: 'Desa X', year: 2026, month: 9,
      cases: sampleCases(), ai: sampleAi(),
    });
    const md = renderMonthlyMarkdown(r);
    for (const section of ['Sumber', 'Materi', 'Fakta', 'Analisis', 'Kesimpulan', 'Saran']) {
      expect(md).toContain(section);
    }
    expect(md).toContain('Cut-off data:** 2026-10-01T00:00:00.000Z');
    expect(md).toContain('1. jalan rusak — 12');
    expect(md).toContain('| WHATSAPP |');
    expect(md).toContain('1200');
    expect(md).toContain('Dokumen ditolak (mengandung kredensial): 2');
    // Template honesty: analysis sections are human-filled placeholders.
    expect(md).toContain('Diisi petugas desa');
    // PDF is declared future work, not silently missing.
    expect(md).toMatch(/PDF.*future work/i);
  });

  it('is deterministic for the same input', () => {
    const args = {
      villageId: 'v1', villageName: 'Desa X', year: 2026, month: 9,
      cases: sampleCases(), ai: sampleAi(),
    };
    const a = renderMonthlyMarkdown(buildMonthlyReportData(args));
    const b = renderMonthlyMarkdown(buildMonthlyReportData(args));
    // generated_at differs; everything else must be identical.
    const strip = (s: string) => s.replace(/Dibuat:\*\* .+/, 'Dibuat:** X');
    expect(strip(a)).toBe(strip(b));
  });

  it('renders missing sections as unavailable, not zero-filled fiction', () => {
    const r = buildMonthlyReportData({ villageId: 'v1', year: 2026, month: 9, cases: null, ai: sampleAi() });
    const md = renderMonthlyMarkdown(r);
    expect(md).toContain('data tidak tersedia');
    expect(md).not.toContain('Top-5 kategori');
  });
});
