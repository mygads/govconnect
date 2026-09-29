/**
 * R5: knowledge suggester — pure deterministic core (no DB, no prisma).
 *
 * Topic keys, audit-event mining, proposal types and the status transition
 * guard live here so they are unit-testable without a database.
 * DB access lives in kb-suggester.service.ts.
 */

// ── Topic key ─────────────────────────────────────────────────────────────
// Deterministic keyword clustering for "10× tanya X" detection. Runs on
// PII-REDACTED text only (callers must pass redactForLog output).

const STOPWORDS = new Set([
  'yang', 'dan', 'atau', 'tapi', 'namun', 'sedangkan', 'agar', 'supaya',
  'jika', 'kalau', 'bila', 'karena', 'sebab', 'oleh', 'sebagai', 'dalam',
  'antara', 'setiap', 'semua', 'para', 'untuk', 'pada', 'dengan', 'dari',
  'ke', 'di', 'adalah', 'ialah', 'ini', 'itu', 'saya', 'kami', 'kita',
  'anda', 'kamu', 'mereka', 'beliau', 'pak', 'bu', 'mas', 'mbak',
  'tolong', 'mohon', 'bisa', 'dapat', 'akan', 'sudah', 'telah', 'belum',
  'tidak', 'nggak', 'gak', 'apa', 'bagaimana', 'gimana', 'berapa', 'kapan',
  'dimana', 'siapa', 'mengapa', 'kenapa', 'dong', 'kok', 'sih', 'deh',
  'kah', 'lah', 'pun', 'juga', 'nya', 'ku', 'mu', 'teh', 'the',
]);

/**
 * Extract a stable topic key from redacted text. Keywords are sorted so
 * "syarat SKTM" and "SKTM syarat" cluster together. Max 3 keywords.
 */
export function extractTopicKey(redactedText: string): string {
  const words = (redactedText ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [...new Set(words)].sort().slice(0, 3).join('+');
}

// ── Mining (pure) ─────────────────────────────────────────────────────────

export interface SuggesterEvent {
  traceId: string;
  stage: string;
  event: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export type ProposalType = 'content_gap' | 'data_gap' | 'action_gap';

export interface ProposalDraft {
  type: ProposalType;
  title: string;
  draft: string;
  dedupeKey: string;
  source: Record<string, unknown>;
}

export interface MineOptions {
  /** Minimum occurrences in the window to propose. Defaults per type below. */
  minCount?: number;
  /** Human label for the window, e.g. "7 hari terakhir". */
  windowLabel?: string;
}

const DEFAULT_MIN: Record<ProposalType, number> = {
  content_gap: 5,
  data_gap: 3,
  action_gap: 5,
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Sorted + capped sample so identical event sets yield identical drafts. */
function sampleTraces(g: { count: number; traces: string[] }): string[] {
  return [...new Set(g.traces)].sort().slice(0, 5);
}

/**
 * Deterministic mining: audit events → proposal drafts. Same input always
 * yields the same drafts (sorted by dedupeKey).
 */
export function mineProposals(
  events: SuggesterEvent[],
  opts: MineOptions = {},
): ProposalDraft[] {
  const windowLabel = opts.windowLabel ?? 'periode analisis';
  const minFor = (t: ProposalType) => opts.minCount ?? DEFAULT_MIN[t];
  const drafts: ProposalDraft[] = [];

  // — content_gap: INFORMATION turns the KB couldn't satisfy —
  // (degraded, or answered with no tool evidence at all).
  const byTopic = new Map<string, { count: number; traces: string[] }>();
  for (const e of events) {
    if (e.event !== 'turn_completed' || e.stage !== 'INFORMATION') continue;
    const p = e.payload ?? {};
    const toolsUsed = Array.isArray(p.toolsUsed) ? p.toolsUsed : [];
    if (!(p.degraded === true || toolsUsed.length === 0)) continue;
    const topic = str(p.topic);
    if (!topic) continue;
    const g = byTopic.get(topic) ?? { count: 0, traces: [] };
    g.count++;
    g.traces.push(e.traceId);
    byTopic.set(topic, g);
  }
  for (const [topic, g] of byTopic) {
    if (g.count < minFor('content_gap')) continue;
    drafts.push({
      type: 'content_gap',
      title: `Konten kurang: topik "${topic}" (${g.count}×)`,
      draft:
        `Warga bertanya tentang topik "${topic}" sebanyak ${g.count} kali dalam ${windowLabel} ` +
        `tanpa jawaban memuaskan dari knowledge base (turn degraded atau tanpa tool evidence).\n\n` +
        `Usulan: tambah artikel/dokumen atau SKILL.md yang menjawab topik ini, lalu publish lewat alur review dokumen.\n\n` +
        `Contoh trace: ${sampleTraces(g).join(', ')}`,
      dedupeKey: `content_gap:${topic}`,
      source: { count: g.count, topic, sampleTraceIds: sampleTraces(g), windowLabel },
    });
  }

  // — data_gap: repeated handoffs / missing slots — the village needs data
  // from case-service, not more documents.
  const slotCounts = new Map<string, { count: number; traces: string[] }>();
  for (const e of events) {
    if (e.event === 'handoff_after_repeated_failure') {
      const key = 'handoff';
      const g = slotCounts.get(key) ?? { count: 0, traces: [] };
      g.count++;
      g.traces.push(e.traceId);
      slotCounts.set(key, g);
    } else if (e.event === 'slot_missing') {
      const slot = str(e.payload?.slot) || 'unknown';
      const key = `slot:${slot}`;
      const g = slotCounts.get(key) ?? { count: 0, traces: [] };
      g.count++;
      g.traces.push(e.traceId);
      slotCounts.set(key, g);
    }
  }
  for (const [key, g] of slotCounts) {
    if (g.count < minFor('data_gap')) continue;
    const what = key === 'handoff' ? 'handoff berulang' : `slot "${key.slice(5)}" berulang kali kosong`;
    drafts.push({
      type: 'data_gap',
      title: `Data kurang: ${what} (${g.count}×)`,
      draft:
        `Terjadi ${what} sebanyak ${g.count} kali dalam ${windowLabel}. ` +
        `Ini sinyal butuh DATA dari case-service (bukan dokumen): field, integrasi, atau alur verifikasi baru.\n\n` +
        `Usulan: petakan kebutuhan data ini ke case-service sebelum menambah dokumen.\n\n` +
        `Contoh trace: ${sampleTraces(g).join(', ')}`,
      dedupeKey: `data_gap:${key}`,
      source: { count: g.count, key, sampleTraceIds: sampleTraces(g), windowLabel },
    });
  }

  // — action_gap: repeated fallbacks on the same intent — the agent needs a
  // new tool/procedure, not more knowledge.
  const intentCounts = new Map<string, { count: number; traces: string[] }>();
  for (const e of events) {
    if (e.event !== 'fallback_ticket_issued') continue;
    const intent = str(e.payload?.intentHint) || 'unknown';
    const g = intentCounts.get(intent) ?? { count: 0, traces: [] };
    g.count++;
    g.traces.push(e.traceId);
    intentCounts.set(intent, g);
  }
  for (const [intent, g] of intentCounts) {
    if (g.count < minFor('action_gap')) continue;
    drafts.push({
      type: 'action_gap',
      title: `Aksi kurang: fallback berulang pada intent "${intent}" (${g.count}×)`,
      draft:
        `Fallback ticket diterbitkan ${g.count} kali untuk intent "${intent}" dalam ${windowLabel}. ` +
        `Ini sinyal butuh TOOL atau prosedur baru (atau perbaikan SOP), bukan sekadar dokumen.\n\n` +
        `Usulan: definisikan tool/prosedur untuk intent ini, atau perbaiki SOP yang menyebabkan kegagalan.\n\n` +
        `Contoh trace: ${sampleTraces(g).join(', ')}`,
      dedupeKey: `action_gap:${intent}`,
      source: { count: g.count, intent, sampleTraceIds: sampleTraces(g), windowLabel },
    });
  }

  return drafts.sort((a, b) => (a.dedupeKey < b.dedupeKey ? -1 : 1));
}

// ── Proposal model ────────────────────────────────────────────────────────

export interface KbProposal {
  id: string;
  villageId: string;
  type: ProposalType;
  title: string;
  draft: string;
  dedupeKey: string;
  status: 'pending' | 'approved' | 'rejected' | 'published' | 'withdrawn';
  source: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
}

export interface ProposalStore {
  findActiveByDedupeKeys(villageId: string, keys: string[]): Promise<Set<string>>;
  insert(proposal: KbProposal): Promise<void>;
  list(villageId: string, status?: KbProposal['status']): Promise<KbProposal[]>;
  get(id: string): Promise<KbProposal | null>;
  setStatus(
    id: string,
    status: 'approved' | 'rejected' | 'published' | 'withdrawn',
    reviewer: string,
    note?: string,
  ): Promise<KbProposal | null>;
}

/**
 * Allowed status transitions. Notably: NOTHING transitions to 'published'
 * automatically — publishing is a separate explicit human step outside the
 * suggester (no auto-promote, by design).
 */
export function canTransition(
  from: KbProposal['status'],
  to: 'approved' | 'rejected' | 'published' | 'withdrawn',
): boolean {
  if (from === 'pending') return to === 'approved' || to === 'rejected';
  if (from === 'approved') return to === 'published' || to === 'withdrawn';
  return false;
}

export function proposalId(): string {
  return `kbp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
