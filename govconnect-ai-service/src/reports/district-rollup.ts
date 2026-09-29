/**
 * A5 — District/province analytics: rollup of per-village monthly reports.
 *
 * Reuses the same DB-first aggregates as the village monthly report
 * (fetchCaseAggregates → case-service). Output: JSON + Markdown.
 *
 * SCOPE MODEL (important):
 * - This module is scope-agnostic: it rolls up EXACTLY the villages the
 *   caller passes. Authorization ("which villages may this operator see")
 *   MUST be enforced by the caller (dashboard session: kabupaten operator
 *   → only their villages). Never pass an unfiltered village list.
 * - Fail-soft per village: a village whose aggregates are unavailable is
 *   listed with data_available=false and excluded from totals — never
 *   estimated, always noted.
 *
 * "Rata-rata waktu respons": the underlying aggregate exposes average
 * RESOLUTION hours (created → resolved). First-response latency is not
 * tracked by case-service yet, so the rollup reports what exists and
 * says so explicitly.
 */

import {
  fetchCaseAggregates,
  periodBounds,
  type CaseAggregates,
} from './monthly-report';

export interface VillageSummary {
  village_id: string;
  village_name: string;
  data_available: boolean;
  tickets_total: number;
  by_status: Record<string, number>;
  by_category: Array<{ kategori: string; count: number }>;
  services_total: number;
  resolved_count: number;
  avg_resolution_hours: number | null;
}

export interface DistrictRollup {
  scope: 'district';
  period: { year: number; month: number; label: string };
  generated_at: string;
  village_count: number;
  villages_with_data: number;
  villages: VillageSummary[];
  totals: {
    tickets: number;
    services: number;
    resolved: number;
    by_status: Record<string, number>;
    by_category: Array<{ kategori: string; count: number }>;
  };
  /** Weighted by resolved_count across villages that have data. */
  avg_resolution_hours: number | null;
  notes: string[];
}

export interface RollupVillage {
  id: string;
  name?: string;
}

type CasesFetcher = (villageId: string, year: number, month: number) => Promise<CaseAggregates | null>;

function mergeCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

/**
 * Pure assembly from per-village aggregates. `fetchCases` is injectable for tests.
 */
export async function buildDistrictRollup(args: {
  villages: RollupVillage[];
  year: number;
  month: number;
  fetchCases?: CasesFetcher;
}): Promise<DistrictRollup> {
  const { villages, year, month } = args;
  const fetchCases = args.fetchCases ?? fetchCaseAggregates;
  const { label } = periodBounds(year, month);
  const notes: string[] = [];
  const summaries: VillageSummary[] = await Promise.all(
    villages.map(async (v): Promise<VillageSummary> => {
      const cases = await fetchCases(v.id, year, month);
      if (!cases) {
        notes.push(`Data ${v.name ?? v.id} tidak tersedia — dikecualikan dari total, bukan diestimasi.`);
        return {
          village_id: v.id, village_name: v.name ?? v.id, data_available: false,
          tickets_total: 0, by_status: {}, by_category: [], services_total: 0,
          resolved_count: 0, avg_resolution_hours: null,
        };
      }
      return {
        village_id: v.id,
        village_name: v.name ?? cases.village_id,
        data_available: true,
        tickets_total: cases.complaints.total,
        by_status: cases.complaints.by_status,
        by_category: cases.complaints.by_category,
        services_total: cases.service_requests.total,
        resolved_count: cases.complaints.resolution.resolved_count,
        avg_resolution_hours: cases.complaints.resolution.avg_hours,
      };
    }),
  );

  const totals = { tickets: 0, services: 0, resolved: 0, by_status: {} as Record<string, number>, by_category: {} as Record<string, number> };
  let weightedHours = 0;
  let weightedCount = 0;
  for (const s of summaries) {
    if (!s.data_available) continue;
    totals.tickets += s.tickets_total;
    totals.services += s.services_total;
    totals.resolved += s.resolved_count;
    mergeCounts(totals.by_status, s.by_status);
    for (const c of s.by_category) totals.by_category[c.kategori] = (totals.by_category[c.kategori] ?? 0) + c.count;
    if (s.avg_resolution_hours !== null && s.resolved_count > 0) {
      weightedHours += s.avg_resolution_hours * s.resolved_count;
      weightedCount += s.resolved_count;
    }
  }
  const byCategory = Object.entries(totals.by_category)
    .map(([kategori, count]) => ({ kategori, count }))
    .sort((a, b) => b.count - a.count);

  return {
    scope: 'district',
    period: { year, month, label },
    generated_at: new Date().toISOString(),
    village_count: villages.length,
    villages_with_data: summaries.filter((s) => s.data_available).length,
    villages: summaries,
    totals: { tickets: totals.tickets, services: totals.services, resolved: totals.resolved, by_status: totals.by_status, by_category: byCategory },
    avg_resolution_hours: weightedCount > 0 ? Math.round((weightedHours / weightedCount) * 10) / 10 : null,
    notes,
  };
}

function fmtHours(h: number | null): string {
  if (h === null) return 'belum ada data';
  if (h < 24) return `${h} jam`;
  return `${Math.round((h / 24) * 10) / 10} hari`;
}

/** Pure Markdown renderer. */
export function renderDistrictMarkdown(r: DistrictRollup): string {
  const L: string[] = [];
  L.push('# REKAPITULASI PELAYANAN MASYARAKAT TINGKAT KABUPATEN');
  L.push(`**Periode:** ${r.period.label}`);
  L.push(`**Desa tercakup:** ${r.villages_with_data}/${r.village_count} desa (data tersedia)`);
  L.push(`**Dibuat:** ${r.generated_at}`);
  L.push('');
  L.push('## Ringkasan');
  L.push(`- Total tiket pengaduan: **${r.totals.tickets}**`);
  L.push(`- Total layanan: **${r.totals.services}**`);
  L.push(`- Tiket selesai: **${r.totals.resolved}**`);
  L.push(`- Rata-rata waktu penyelesaian (tertimbang): **${fmtHours(r.avg_resolution_hours)}**`);
  L.push('');
  L.push('## Per Desa');
  L.push('| Desa | Tiket | Selesai | Rata-rata penyelesaian |');
  L.push('|---|---|---|---|');
  for (const v of r.villages) {
    L.push(v.data_available
      ? `| ${v.village_name} | ${v.tickets_total} | ${v.resolved_count} | ${fmtHours(v.avg_resolution_hours)} |`
      : `| ${v.village_name} | _data tidak tersedia_ | | |`);
  }
  L.push('');
  L.push('## Kategori Terbanyak (gabungan)');
  if (r.totals.by_category.length === 0) {
    L.push('_Tidak ada data._');
  } else {
    L.push('| Kategori | Jumlah |');
    L.push('|---|---|');
    for (const c of r.totals.by_category.slice(0, 10)) L.push(`| ${c.kategori} | ${c.count} |`);
  }
  if (r.notes.length > 0) {
    L.push('');
    L.push('## Catatan');
    for (const n of r.notes) L.push(`- ${n}`);
  }
  L.push('');
  L.push('_Catatan: rata-rata waktu penyelesaian dihitung dari tiket yang selesai (created → resolved). ' +
    'Latensi respons pertama belum dilacak case-service._');
  return L.join('\n');
}
