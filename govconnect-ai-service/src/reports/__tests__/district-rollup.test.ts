/**
 * A5: district rollup tests (pure — injected fetcher, no network/DB).
 */
import { describe, it, expect } from 'vitest';
import { buildDistrictRollup, renderDistrictMarkdown } from '../district-rollup';
import type { CaseAggregates } from '../monthly-report';

function agg(villageId: string, o: {
  total: number; byStatus: Record<string, number>; byCategory: Array<[string, number]>;
  resolved: number; avgHours: number | null; services: number;
}): CaseAggregates {
  return {
    village_id: villageId,
    period: { year: 2026, month: 9, start: '', end: '' },
    cut_off: '',
    complaints: {
      total: o.total,
      by_status: o.byStatus,
      by_category: o.byCategory.map(([kategori, count]) => ({ kategori, count })),
      channel_status_matrix: {},
      resolution: { resolved_count: o.resolved, avg_hours: o.avgHours, note: '' },
    },
    service_requests: {
      total: o.services, by_status: {}, by_service: [],
      channel_status_matrix: {},
      resolution: { resolved_count: 0, avg_hours: null, note: '' },
    },
  };
}

const FETCHER = async (villageId: string) => {
  if (villageId === 'v1') {
    return agg('v1', {
      total: 10, byStatus: { OPEN: 4, DONE: 6 }, byCategory: [['jalan', 7], ['air', 3]],
      resolved: 6, avgHours: 48, services: 2,
    });
  }
  if (villageId === 'v2') {
    return agg('v2', {
      total: 5, byStatus: { OPEN: 5 }, byCategory: [['jalan', 5]],
      resolved: 0, avgHours: null, services: 1,
    });
  }
  return null; // v3 unavailable
};

describe('buildDistrictRollup', () => {
  it('rolls up totals, merges categories, weights avg hours', async () => {
    const r = await buildDistrictRollup({
      villages: [{ id: 'v1', name: 'Desa A' }, { id: 'v2', name: 'Desa B' }, { id: 'v3', name: 'Desa C' }],
      year: 2026, month: 9, fetchCases: FETCHER,
    });
    expect(r.village_count).toBe(3);
    expect(r.villages_with_data).toBe(2);
    expect(r.totals.tickets).toBe(15);
    expect(r.totals.by_status).toEqual({ OPEN: 9, DONE: 6 });
    expect(r.totals.by_category[0]).toEqual({ kategori: 'jalan', count: 12 });
    // weighted: only v1 has resolved tickets → 48h
    expect(r.avg_resolution_hours).toBe(48);
    expect(r.villages.find((v) => v.village_id === 'v3')!.data_available).toBe(false);
    expect(r.notes.some((n) => n.includes('Desa C'))).toBe(true);
  });

  it('avg is null when nothing resolved', async () => {
    const r = await buildDistrictRollup({
      villages: [{ id: 'v2' }], year: 2026, month: 9, fetchCases: FETCHER,
    });
    expect(r.avg_resolution_hours).toBeNull();
  });

  it('markdown renders per-village table and notes', async () => {
    const r = await buildDistrictRollup({
      villages: [{ id: 'v1', name: 'Desa A' }, { id: 'v3', name: 'Desa C' }],
      year: 2026, month: 9, fetchCases: FETCHER,
    });
    const md = renderDistrictMarkdown(r);
    expect(md).toContain('KABUPATEN');
    expect(md).toContain('Desa A');
    expect(md).toContain('data tidak tersedia');
    expect(md).toContain('September 2026');
  });
});
