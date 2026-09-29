/**
 * KB Precedence P0–P3 + tenant-scoped retrieval assertion.
 *
 * Design (arsitektur-final §5.4, §6; v4 KB-router):
 * - P0 — DB records (tickets, requests, profile): ALWAYS authoritative.
 *   When P0 contradicts a document, the DB wins and the conflict is logged.
 * - P1 — official current-version documents (tenant-scoped).
 * - P2 — older versions / general knowledge base.
 * - P3 — model parametric knowledge: NEVER a source for factual claims.
 *   The prompt explicitly forbids P3-as-fact; the claim verifier enforces it.
 *
 * Tenant assertion (fail-closed): retrieval results that carry tenant
 * metadata must match the current tenant. A mismatch means the storage
 * layer leaked across tenants → the result is dropped and quarantined in
 * the audit trail. Results WITHOUT tenant metadata are treated as
 * untrusted (P2 max) but still shown — the SQL layer already scopes by
 * tenant; this is defense in depth, not the primary barrier.
 */

import logger from '../utils/logger';

export type Precedence = 'P0' | 'P1' | 'P2' | 'P3';

/** Tool → precedence mapping. DB-backed reads are P0, documents P1/P2. */
export function precedenceOf(toolName: string): Precedence {
  if (/^(get_|check_status|get_my_history)/.test(toolName)) return 'P0';
  if (toolName === 'search_documents') return 'P1';
  if (toolName === 'search_knowledge') return 'P2';
  if (toolName === 'search_user_memory') return 'P2';
  return 'P2';
}

export const PRECEDENCE_LABEL: Record<Precedence, string> = {
  P0: '[P0 — DATA DATABASE, PALING OTORITATIF]',
  P1: '[P1 — DOKUMEN RESMI DESA]',
  P2: '[P2 — BASIS PENGETAHUAN UMUM]',
  P3: '[P3 — PENGETAHUAN MODEL — JANGAN JADIKAN FAKTA]',
};

export interface TenantCheckResult {
  ok: boolean;
  /** 'match' | 'missing-metadata' | 'mismatch' */
  detail: string;
}

/**
 * Post-retrieval tenant assertion (fail-closed).
 * Inspects tenant metadata anywhere in the result payload.
 */
export function assertTenant(data: unknown, tenantId: string): TenantCheckResult {
  const found: string[] = [];
  const scan = (v: unknown, depth: number): void => {
    if (depth > 4 || v === null || v === undefined) return;
    if (Array.isArray(v)) {
      for (const item of v.slice(0, 20)) scan(item, depth + 1);
      return;
    }
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of ['tenant_id', 'village_id']) {
        if (typeof o[k] === 'string' && o[k] !== '') found.push(o[k] as string);
      }
      for (const val of Object.values(o).slice(0, 30)) scan(val, depth + 1);
    }
  };
  scan(data, 0);
  if (found.length === 0) return { ok: true, detail: 'missing-metadata' };
  const mismatch = found.some((t) => t !== tenantId);
  if (mismatch) {
    logger.warn('[kb-precedence] CROSS-TENANT retrieval detected — dropping result', {
      expected: tenantId.slice(0, 8) + '…',
    });
    return { ok: false, detail: 'mismatch' };
  }
  return { ok: true, detail: 'match' };
}

export interface EvidenceEntry {
  tool: string;
  precedence: Precedence;
  text: string;
  tenantCheck: TenantCheckResult;
}

/** Format evidence for the prompt with explicit precedence labels. */
export function formatEvidenceWithPrecedence(entries: EvidenceEntry[]): string {
  const order: Precedence[] = ['P0', 'P1', 'P2', 'P3'];
  const sorted = [...entries].sort(
    (a, b) => order.indexOf(a.precedence) - order.indexOf(b.precedence),
  );
  return sorted
    .map((e) => `${PRECEDENCE_LABEL[e.precedence]} (sumber: ${e.tool})\n${e.text}`)
    .join('\n\n---\n\n');
}

/**
 * Detect P0-vs-document conflicts: when a P0 record and a P1/P2 document
 * disagree on a status-like claim, P0 wins. Returns a conflict note for the
 * prompt, or null when there is no conflict to report.
 */
export function detectPrecedenceConflict(entries: EvidenceEntry[]): string | null {
  const p0 = entries.filter((e) => e.precedence === 'P0');
  const docs = entries.filter((e) => e.precedence === 'P1' || e.precedence === 'P2');
  if (p0.length === 0 || docs.length === 0) return null;
  const p0Text = p0.map((e) => e.text.toLowerCase()).join('\n');
  const statusWords = ['diproses', 'diterima', 'disetujui', 'ditolak', 'selesai', 'dibatalkan', 'menunggu'];
  for (const w of statusWords) {
    const inP0 = p0Text.includes(w);
    for (const d of docs) {
      const other = statusWords.find((x) => x !== w && d.text.toLowerCase().includes(x));
      if (inP0 && other) {
        return `KONFLIK SUMBER: database menyatakan "${w}" sedangkan dokumen menyebut "${other}". ` +
          `Database (P0) selalu menang — jawab berdasarkan database dan abaikan dokumen untuk klaim ini.`;
      }
    }
  }
  return null;
}
