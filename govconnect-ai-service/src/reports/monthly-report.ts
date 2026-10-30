/**
 * R11: monthly government report generator — JSON + Markdown.
 *
 * Template baku pemerintah: Sumber, Materi, Fakta (top-5 kategori, by-status,
 * matriks kanal × status, rata-rata waktu penyelesaian), Analisis,
 * Kesimpulan, Saran — dengan cut-off eksplisit. Export PDF is future work.
 *
 * Data:
 * - Ticket aggregates: case-service internal API
 *   GET /internal/report/monthly (month-bounded, village-scoped). DB-first.
 * - AI stats: local ai DB (turns, cost, fallback tickets, security events).
 *   Both sources are fail-soft: a failed source yields a null section with
 *   an explicit "data tidak tersedia" note — never fabricated numbers.
 */
import { config } from '../config/env';
import logger from '../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────

export interface CaseAggregates {
  village_id: string;
  period: { year: number; month: number; start: string; end: string };
  cut_off: string;
  complaints: {
    total: number;
    by_status: Record<string, number>;
    by_category: Array<{ kategori: string; count: number }>;
    channel_status_matrix: Record<string, Record<string, number>>;
    resolution: { resolved_count: number; avg_hours: number | null; note: string };
  };
  service_requests: {
    total: number;
    by_status: Record<string, number>;
    by_service: Array<{ service_id: string; count: number }>;
    channel_status_matrix: Record<string, Record<string, number>>;
    resolution: { resolved_count: number; avg_hours: number | null; note: string };
  };
}

export interface AiStats {
  turns: number;
  fallback_tickets: number;
  cost_usd: number;
  security_events: { canary_leaks: number; secret_rejections: number };
}

export interface MonthlyReport {
  village_id: string;
  village_name: string;
  period: { year: number; month: number; label: string };
  cut_off: string;
  generated_at: string;
  tickets: CaseAggregates['complaints'] & {
    top_categories: Array<{ kategori: string; count: number }>;
  } | null;
  services: CaseAggregates['service_requests'] | null;
  ai: AiStats | null;
  notes: string[];
}

// ── Fetchers (fail-soft) ──────────────────────────────────────────────────

type PrismaLike = {
  $queryRawUnsafe: (query: string, ...args: unknown[]) => Promise<unknown>;
};
async function getPrisma(): Promise<PrismaLike> {
  const mod = await import('../lib/prisma');
  return mod.default as PrismaLike;
}

export async function fetchCaseAggregates(
  villageId: string, year: number, month: number,
): Promise<CaseAggregates | null> {
  try {
    const base = (config.caseServiceUrl ?? '').replace(/\/$/, '');
    if (!base) return null;
    const url =
      `${base}/internal/report/monthly?village_id=${encodeURIComponent(villageId)}&year=${year}&month=${month}`;
    const res = await fetch(url, {
      headers: { 'x-internal-api-key': config.internalApiKey ?? '' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      logger.warn('[report] case-service aggregates failed', { status: res.status });
      return null;
    }
    return (await res.json()) as CaseAggregates;
  } catch (err) {
    logger.warn('[report] case-service aggregates failed (fail-soft)', {
      error: (err as Error)?.message ?? String(err),
    });
    return null;
  }
}

export async function fetchAiStats(
  villageId: string, startIso: string, endIso: string,
): Promise<AiStats | null> {
  try {
    const prisma = await getPrisma();
    const one = async (sql: string, ...args: unknown[]): Promise<number> => {
      const rows = (await prisma.$queryRawUnsafe(sql, ...args)) as Array<{ n: string | number }>;
      return Number(rows[0]?.n ?? 0);
    };
    const [turns, fallbackTickets, costUsd, canaryLeaks, secretRejections] = await Promise.all([
      one(
        `SELECT count(*) AS n FROM pipeline_audit_events
         WHERE tenant_id = $1 AND event = 'turn_completed' AND occurred_at >= $2 AND occurred_at < $3`,
        villageId, startIso, endIso,
      ),
      one(
        `SELECT count(*) AS n FROM pipeline_fallback_tickets
         WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
        villageId, startIso, endIso,
      ),
      one(
        `SELECT coalesce(sum(actual_cost_usd),0) AS n FROM ai.ai_token_usage
         WHERE village_id = $1 AND created_at >= $2 AND created_at < $3`,
        villageId, startIso, endIso,
      ),
      one(
        `SELECT count(*) AS n FROM pipeline_audit_events
         WHERE tenant_id = $1 AND event = 'canary_token_leaked' AND occurred_at >= $2 AND occurred_at < $3`,
        villageId, startIso, endIso,
      ),
      one(
        `SELECT count(*) AS n FROM pipeline_audit_events
         WHERE tenant_id = $1 AND event = 'document_secret_rejected' AND occurred_at >= $2 AND occurred_at < $3`,
        villageId, startIso, endIso,
      ),
    ]);
    return {
      turns,
      fallback_tickets: fallbackTickets,
      cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
      security_events: { canary_leaks: canaryLeaks, secret_rejections: secretRejections },
    };
  } catch (err) {
    logger.warn('[report] ai stats failed (fail-soft)', {
      error: (err as Error)?.message ?? String(err),
    });
    return null;
  }
}

// ── Pure assembly ─────────────────────────────────────────────────────────

const BULAN = [
  '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function periodBounds(year: number, month: number): { start: Date; end: Date; label: string } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end, label: `${BULAN[month]} ${year}` };
}

export function buildMonthlyReportData(args: {
  villageId: string;
  villageName?: string;
  year: number;
  month: number;
  cases: CaseAggregates | null;
  ai: AiStats | null;
}): MonthlyReport {
  const { start, end, label } = periodBounds(args.year, args.month);
  const notes: string[] = [];
  if (!args.cases) notes.push('Data tiket tidak tersedia (case-service tidak dapat dihubungi) — bagian tiket dikosongkan, bukan diestimasi.');
  if (!args.ai) notes.push('Statistik AI tidak tersedia — bagian AI dikosongkan.');
  return {
    village_id: args.villageId,
    village_name: args.villageName || args.villageId,
    period: { year: args.year, month: args.month, label },
    cut_off: end.toISOString(),
    generated_at: new Date().toISOString(),
    tickets: args.cases
      ? {
          ...args.cases.complaints,
          top_categories: args.cases.complaints.by_category.slice(0, 5),
        }
      : null,
    services: args.cases ? args.cases.service_requests : null,
    ai: args.ai,
    notes,
  };
}

// ── Pure Markdown renderer (template baku pemerintah) ─────────────────────

function statusTable(byStatus: Record<string, number>): string {
  const order = ['OPEN', 'PROCESS', 'DONE', 'CANCELED', 'REJECT'];
  const rows = order
    .filter((s) => (byStatus[s] ?? 0) > 0 || true)
    .map((s) => `| ${s} | ${byStatus[s] ?? 0} |`)
    .join('\n');
  return `| Status | Jumlah |\n|---|---|\n${rows}`;
}

function matrixTable(matrix: Record<string, Record<string, number>>): string {
  const channels = Object.keys(matrix);
  if (channels.length === 0) return '_Tidak ada data._';
  const statuses = [...new Set(channels.flatMap((c) => Object.keys(matrix[c])))].sort();
  const head = `| Kanal | ${statuses.join(' | ')} |`;
  const sep = `|---|${statuses.map(() => '---').join('|')}|`;
  const rows = channels
    .map((c) => `| ${c} | ${statuses.map((s) => matrix[c][s] ?? 0).join(' | ')} |`)
    .join('\n');
  return `${head}\n${sep}\n${rows}`;
}

function fmtHours(h: number | null): string {
  if (h === null) return 'belum ada data';
  if (h < 24) return `${h} jam`;
  return `${Math.round((h / 24) * 10) / 10} hari (${h} jam)`;
}

/** Pure renderer — deterministic for the same input. */
export function renderMonthlyMarkdown(r: MonthlyReport): string {
  const L: string[] = [];
  L.push(`# LAPORAN BULANAN PELAYANAN MASYARAKAT`);
  L.push(`## Pemerintah Desa ${r.village_name}`);
  L.push(`**Periode:** ${r.period.label}`);
  L.push(`**Cut-off data:** ${r.cut_off} (data setelah cut-off masuk periode berikutnya)`);
  L.push(`**Dibuat:** ${r.generated_at}`);
  L.push(``);
  L.push(`## 1. Sumber`);
  L.push(`- Data tiket: case-service (database, bukan dokumen).`);
  L.push(`- Statistik AI: audit trail pipeline ai-service.`);
  L.push(`- Dokumen/RAG tidak digunakan sebagai sumber angka — database selalu otoritatif.`);
  L.push(``);
  L.push(`## 2. Materi`);
  L.push(`Laporan mencakup aduan warga (complaint) dan permohonan layanan (service request) `);
  L.push(`yang dibuat pada periode ${r.period.label}, serta kinerja asisten AI desa.`);
  L.push(``);
  L.push(`## 3. Fakta`);
  if (r.tickets) {
    L.push(`### 3.1 Aduan warga — total ${r.tickets.total}`);
    L.push(``);
    L.push(`**Top-5 kategori:**`);
    if (r.tickets.top_categories.length === 0) L.push(`_Tidak ada aduan pada periode ini._`);
    r.tickets.top_categories.forEach((c, i) => L.push(`${i + 1}. ${c.kategori} — ${c.count}`));
    L.push(``);
    L.push(`**Per status:**`);
    L.push(statusTable(r.tickets.by_status));
    L.push(``);
    L.push(`**Matriks kanal × status:**`);
    L.push(matrixTable(r.tickets.channel_status_matrix));
    L.push(``);
    L.push(`**Rata-rata waktu penyelesaian:** ${fmtHours(r.tickets.resolution.avg_hours)} `);
    L.push(`(dari ${r.tickets.resolution.resolved_count} aduan selesai; ${r.tickets.resolution.note})`);
  } else {
    L.push(`### 3.1 Aduan warga — _data tidak tersedia_`);
  }
  L.push(``);
  if (r.services) {
    L.push(`### 3.2 Permohonan layanan — total ${r.services.total}`);
    L.push(``);
    L.push(`**Per status:**`);
    L.push(statusTable(r.services.by_status));
    L.push(``);
    L.push(`**Matriks kanal × status:**`);
    L.push(matrixTable(r.services.channel_status_matrix));
    L.push(``);
    L.push(`**Rata-rata waktu penyelesaian:** ${fmtHours(r.services.resolution.avg_hours)} `);
    L.push(`(dari ${r.services.resolution.resolved_count} permohonan selesai)`);
  } else {
    L.push(`### 3.2 Permohonan layanan — _data tidak tersedia_`);
  }
  L.push(``);
  L.push(`### 3.3 Kinerja asisten AI`);
  if (r.ai) {
    L.push(`- Total turn percakapan: ${r.ai.turns}`);
    L.push(`- Tiket fallback (AI tidak bisa menjawab): ${r.ai.fallback_tickets}`);
    L.push(`- Biaya AI periode ini: $${r.ai.cost_usd}`);
    L.push(`- Insiden kebocoran canary: ${r.ai.security_events.canary_leaks}`);
    L.push(`- Dokumen ditolak (mengandung kredensial): ${r.ai.security_events.secret_rejections}`);
  } else {
    L.push(`_Data tidak tersedia._`);
  }
  L.push(``);
  L.push(`## 4. Analisis`);
  L.push(`_(Diisi petugas desa — template tidak mengarang analisis otomatis.)_`);
  L.push(``);
  L.push(`## 5. Kesimpulan`);
  L.push(`_(Diisi petugas desa.)_`);
  L.push(``);
  L.push(`## 6. Saran`);
  L.push(`_(Diisi petugas desa.)_`);
  L.push(``);
  if (r.notes.length > 0) {
    L.push(`## Catatan keterbatasan data`);
    r.notes.forEach((n) => L.push(`- ${n}`));
    L.push(``);
  }
  L.push(`---`);
  L.push(`*Export PDF belum tersedia (future work). Laporan ini dibuat otomatis dari database; `);
  L.push(`bagian Analisis/Kesimpulan/Saran wajib diisi manusia.*`);
  return L.join('\n');
}
