/**
 * KB Router (R3) — deterministic upload classification.
 *
 * One uploaded document → exactly one route (v4 §4.1):
 * - 'rag'      : factual reference (Perdes, pengumuman, panduan umum) → RAG chunks.
 * - 'skill'    : procedural (alur mengurus KTP, SOP langkah 1-2-3) → SKILL.md (R4 builds it).
 * - 'both'     : mixed (panduan layanan) → RAG chunks + SKILL.md source.
 * - 'rejected' : type-D — data already authoritative in case-service/DB
 *                (jam layanan, tarif, kontak, status). Rejected with the
 *                message "Data ini dikelola di case-service. Update di sana."
 *                This removes the conflict class before it exists instead of
 *                resolving it at runtime.
 *
 * Deterministic: pure function of (title, text). The rejection bar is
 * deliberately high — authoritative signals must DOMINATE and no
 * procedural structure may be present — so a Perdes that merely mentions a
 * fee in passing is factual (rag), never rejected. Admin review (REVIEW →
 * PUBLISH) remains the backstop for borderline calls.
 */

export type KbRoute = 'rag' | 'skill' | 'both' | 'rejected';

export interface KbRouterInput {
  title?: string;
  text: string;
  category?: string;
}

export interface KbRouteResult {
  route: KbRoute;
  reasons: string[];
  signals: { authoritative: number; procedural: number; factual: number; steps: number };
}

/** Rejection copy shown to the uploading admin (v4 §4.1). */
export const KB_REJECTED_COPY =
  'Data ini dikelola di case-service. Update di sana.';

/** Patterns for authoritative operational data (type-D). */
const AUTHORITATIVE_PATTERNS: RegExp[] = [
  /\b(jam\s+layanan|jam\s+operasional|jam\s+kerja|jam\s+buka|jam\s+pelayanan)/i,
  /\b(?:hari\s+)?(senin|selasa|rabu|kamis|ju?'?mat|sabtu|minggu)\b.{0,40}\d{1,2}[.:]\d{2}/i,
  /\btarif\b|\bretribusi\b/i,
  /\bbiaya\s+(administrasi|layanan|pembuatan|pengurusan)\b/i,
  /\bRp\s?[\d.]{4,}/,
  /\bkontak\b|\bhubungi\b|\bcall\s*center\b/i,
  /\b(nomor|no\.?)\s*(telepon|telp|hp|wa|darurat)\b/i,
  /\b08\d{8,}\b/,
];

/** Title alone can signal a type-D document ("Tarif Retribusi Sampah"). */
const TITLE_AUTHORITATIVE = /tarif|retribusi|jam\s+layanan|kontak|nomor\s+(penting|darurat|telepon)|daftar\s+(harga|tarif)/i;

/** Procedural markers: steps, SOP language. */
const PROCEDURAL_PATTERNS: RegExp[] = [
  /\blangkah\b|\btata\s*cara\b|\balur\b|\bprosedur\b|\bsop\b/i,
  /\bsyarat\b/i,
  /\bbagaimana\s+cara\b/i,
  /\bpanduan\s+pengurusan\b/i,
];

/** Factual-reference markers: regulations, announcements. */
const FACTUAL_PATTERNS: RegExp[] = [
  /\bperaturan\b|\bperdes\b|\bperda\b|\bkeputusan\b|\bpengumuman\b/i,
  /\bundang-undang\b|\buu\s+(no|nomor)\b/i,
  /\bpasal\b|\bayat\b/i,
];

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const p of patterns) {
    const flags = p.flags.includes('g') ? p.flags : `${p.flags}g`;
    const m = text.match(new RegExp(p.source, flags));
    if (m) n += m.length;
  }
  return n;
}

/** Lines that look like numbered steps ("1. Datang ke kantor desa"). */
function countNumberedSteps(text: string): number {
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\d{1,2}[.)]\s+\S/.test(line)) n++;
  }
  return n;
}

export function routeKnowledgeDocument(input: KbRouterInput): KbRouteResult {
  const title = input.title ?? '';
  const text = input.text ?? '';
  const reasons: string[] = [];

  let authoritative = countMatches(text, AUTHORITATIVE_PATTERNS);
  if (TITLE_AUTHORITATIVE.test(title)) {
    authoritative += 3;
    reasons.push(`judul mengindikasikan data operasional ("${title.slice(0, 60)}")`);
  }
  const steps = countNumberedSteps(text);
  const procedural = countMatches(text, PROCEDURAL_PATTERNS) + (steps >= 3 ? 2 : 0);
  const factual = countMatches(text, FACTUAL_PATTERNS);

  const signals = { authoritative, procedural, factual, steps };

  // ── Type D: REJECTED. High bar by design ──────────────────────────────
  // Authoritative signals must dominate, and the document must have no
  // procedural structure at all. A Perdes mentioning "biaya administrasi"
  // twice stays factual; a tariff sheet / office-hours notice / contact
  // list goes here.
  if (authoritative >= 4 && steps === 0 && procedural === 0 && authoritative > factual) {
    reasons.push(
      `dokumen didominasi data operasional otoritatif (sinyal=${authoritative}) tanpa struktur prosedural`,
    );
    return { route: 'rejected', reasons, signals };
  }

  const hasProcedural = procedural >= 2 || steps >= 3;
  const hasFactual = factual >= 2;

  if (hasProcedural && hasFactual) {
    reasons.push('memuat prosedur langkah-demi-langkah sekaligus referensi faktual');
    return { route: 'both', reasons, signals };
  }
  if (hasProcedural) {
    reasons.push(
      steps >= 3
        ? `memuat ${steps} langkah bernomor (prosedural)`
        : 'bahasa prosedural dominan (langkah/tata cara/alur/syarat)',
    );
    return { route: 'skill', reasons, signals };
  }
  reasons.push('referensi faktual — masuk RAG dengan sitasi');
  return { route: 'rag', reasons, signals };
}
