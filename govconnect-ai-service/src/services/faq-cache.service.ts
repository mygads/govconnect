/**
 * FAQ Cache — semantic (fuzzy) question matching for repeated factual questions.
 *
 * Motivation: questions like "syarat bikin KTP?" are asked ~100x/day per
 * village. Answering each one via LLM+RAG wastes cost and latency. This cache
 * answers repeats without any model call.
 *
 * Architecture: this module is the MATCHING + GUARD + METRICS layer. Durable
 * storage is the existing `pipeline_semantic_cache` table (via
 * pipeline/semantic-cache.ts + pipeline/pipeline-store.ts) — one store, no
 * duplication. Storage key = sha256(tenant_id | doc_version | normalized
 * question): village-scoped by construction, so answers NEVER leak across
 * villages. KB changes invalidate via the existing semanticCacheInvalidate
 * hooks (knowledge.routes.ts POST/PUT/DELETE, document-ingest, kb-publish).
 *
 * Design decision — exact vs fuzzy (documented per task):
 *   1. EXACT-normalized match first (fast path, deterministic, 1 indexed SELECT).
 *   2. FUZZY fallback: token-set Jaccard similarity ≥ 0.7 over the tenant's
 *      non-expired cached questions (one more indexed SELECT, CPU-only).
 *      Threshold analysis (short Indonesian queries are 3–5 tokens):
 *        - 0.7 accepts a question that ADDS/DROPS one content word
 *          ({a,b,c} vs {a,b,c,d} → 0.75) or reorders words — the common
 *          real-world variants.
 *        - 0.7 REJECTS single-word substitutions that change meaning:
 *          "syarat buat ktp" vs "syarat buat kk" → 0.5; "jam buka kantor"
 *          vs "jam tutup kantor" → 0.6. Serving a wrong factual answer is
 *          worse than a cache miss, so substitution is biased to miss.
 *   3. NO embedding similarity — deliberate. An embedding call per message
 *      would add a network round-trip + provider cost + latency to EVERY
 *      message, including the cache-hit path, defeating the cache's purpose
 *      (skip LLM+RAG). Synonym normalization (bikin→buat, gak→tidak, …)
 *      handles the common Indonesian colloquial variants that embeddings
 *      would otherwise buy us, at zero marginal cost.
 *
 * Safety rules:
 * - Only INFORMATION-stage, factual, stable answers are cached. NEVER:
 *   ticket statuses, personal data (NIK/phone), mutation results, error or
 *   fallback responses, or context-dependent follow-ups ("syaratnya?" —
 *   "nya" refers to whatever service was discussed; the cache key carries no
 *   conversation context, so caching it would serve wrong answers).
 * - Lookup/store is skipped for active multi-turn flows: the v2 pipeline only
 *   consults this cache when decision.stage === 'INFORMATION' (VERIFY/COLLECT
 *   stages never touch it), and contextual follow-ups are rejected outright.
 * - TTL default 2h (FAQ_CACHE_TTL_MS): bounds staleness after admin edits
 *   while covering the intra-day repetition peak. Size cap: 1000 entries per
 *   tenant (most-hit/newest kept).
 */

import logger from '../utils/logger';
import {
  semanticCacheLookup,
  semanticCacheStore,
  docVersion,
} from '../pipeline/semantic-cache';
import {
  semanticCacheListQuestions,
  semanticCacheInvalidate,
  semanticCacheEvictOverflow,
} from '../pipeline/pipeline-store';

// ==================== CONFIG ====================

export const FAQ_CACHE_CONFIG = {
  /** TTL for FAQ entries — within the 1–6h task requirement. */
  ttlMs: Number(process.env.FAQ_CACHE_TTL_MS ?? 2 * 3600 * 1000),
  /** Token-set Jaccard threshold for fuzzy matching (see design note above). */
  fuzzyThreshold: Number(process.env.FAQ_FUZZY_THRESHOLD ?? 0.7),
  /** Max candidate rows scanned on the fuzzy path. */
  maxCandidates: Number(process.env.FAQ_MAX_CANDIDATES ?? 500),
  /** Per-tenant size cap (most-hit / newest kept). */
  maxEntriesPerTenant: Number(process.env.FAQ_MAX_ENTRIES_PER_TENANT ?? 1000),
  /** Minimum normalized question length (chars) to be cache-eligible. */
  minQuestionChars: 12,
} as const;

// ==================== NORMALIZATION ====================

/** Indonesian colloquial → canonical, applied before matching. */
const SYNONYMS: Array<[RegExp, string]> = [
  [/\bgimana\b/g, 'bagaimana'],
  [/\b(nggak|ngga|gak|ga|kagak|ngk)\b/g, 'tidak'],
  [/\b(udah|sdh)\b/g, 'sudah'],
  [/\b(bikin)\b/g, 'buat'],
  [/\b(aja)\b/g, 'saja'],
  [/\b(donk)\b/g, 'dong'],
];

/** Filler words that don't change question meaning. */
const FILLERS = new Set([
  'dong', 'deh', 'sih', 'nih', 'ya', 'yah', 'kak', 'pak', 'bu',
  'mas', 'mbak', 'tolong', 'mohon', 'punten', 'permisi',
]);

/**
 * Normalize a question for matching: lowercase, strip punctuation, collapse
 * whitespace, map colloquial synonyms, drop filler words.
 */
export function normalizeFaqQuery(q: string): string {
  let s = (q ?? '').toLowerCase().normalize('NFKC');
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  for (const [re, rep] of SYNONYMS) s = s.replace(re, rep);
  return s
    .split(' ')
    .filter((t) => t.length > 0 && !FILLERS.has(t))
    .join(' ')
    .slice(0, 300);
}

/**
 * Token-set Jaccard similarity over normalized tokens: |A∩B| / |A∪B|.
 * Order-independent ("ktp syarat bikin" ≡ "syarat bikin ktp").
 */
export function faqTokenSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeFaqQuery(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeFaqQuery(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ==================== CONTEXT GUARD ====================

/** Bare keywords that only make sense with conversation context. */
const CONTEXTUAL_KEYWORDS = new Set([
  'syarat', 'syaratnya', 'biaya', 'biayanya', 'tarif', 'tarifnya',
  'berapa lama', 'lamanya', 'proses', 'prosesnya', 'cara', 'caranya',
  'link', 'linknya', 'form', 'formnya', 'dimana', 'kapan', 'kenapa',
  'bagaimana', 'lanjut', 'iya', 'oke', 'ok', 'siap',
]);

/**
 * True when the question depends on conversation context (anaphoric "…nya",
 * bare "syarat?"/"biaya?"). The cache key carries no context, so caching
 * these would serve wrong answers — they must always go through the agent.
 */
export function isContextualFollowUp(q: string): boolean {
  const n = normalizeFaqQuery(q);
  if (!n) return true;
  if (CONTEXTUAL_KEYWORDS.has(n)) return true;
  const tokens = n.split(' ');
  if (tokens.length <= 4 && tokens.some((t) => t.endsWith('nya'))) return true;
  return false;
}

// ==================== CACHEABILITY GUARD ====================

const NIK_RE = /\b\d{16}\b/;
const PHONE_RE = /(?:\+62|62|0)8\d{8,11}\b/;
const TICKET_RE = /\b(?:LAP|TMP|SRV|REQ|LAY)-\d{4}\d{2}\d{2}-\d{2,6}\b/;
const TICKET_SHORT_RE = /\b(?:LAP|TMP|SRV|REQ|LAY)-\d+\b/i;
const PERSONAL_Q_RE = /\b(saya|aku|gue|nik saya|punya saya|ktp saya)\b/i;
const ERROR_ANSWER_RE =
  /(terjadi gangguan|coba lagi nanti|sistem sedang (?:error|gangguan|sibuk)|service unavailable|temporarily unavailable|maaf[,.]?\s+(?:kami|saya) (?:tidak dapat|belum dapat|tidak bisa))/i;

/**
 * Is this (question, answer) pair safe to cache as a village FAQ?
 * Only stable factual answers (service info/requirements from DB/KB).
 * Rejects: non-INFORMATION stages, personal data, ticket refs/statuses,
 * mutation results, error/fallback answers, contextual follow-ups.
 */
export function isFaqCacheable(question: string, answer: string, stage: string): boolean {
  if (stage !== 'INFORMATION') return false;
  const q = (question ?? '').trim();
  const a = (answer ?? '').trim();
  if (!q || !a) return false;
  const nq = normalizeFaqQuery(q);
  if (nq.length < FAQ_CACHE_CONFIG.minQuestionChars) return false;
  if (isContextualFollowUp(q)) return false;
  if (NIK_RE.test(q) || NIK_RE.test(a)) return false;
  if (PHONE_RE.test(q) || PHONE_RE.test(a)) return false;
  if (TICKET_RE.test(a) || TICKET_SHORT_RE.test(q) || TICKET_SHORT_RE.test(a)) return false;
  if (PERSONAL_Q_RE.test(q)) return false;
  if (ERROR_ANSWER_RE.test(a)) return false;
  return true;
}

// ==================== METRICS ====================

let exactHits = 0;
let fuzzyHits = 0;
let misses = 0;

export interface FaqCacheStats {
  exactHits: number;
  fuzzyHits: number;
  totalHits: number;
  misses: number;
  hitRate: number;
  fuzzyShare: number;
}

export function getFaqCacheStats(): FaqCacheStats {
  const totalHits = exactHits + fuzzyHits;
  const total = totalHits + misses;
  return {
    exactHits,
    fuzzyHits,
    totalHits,
    misses,
    hitRate: total > 0 ? totalHits / total : 0,
    fuzzyShare: totalHits > 0 ? fuzzyHits / totalHits : 0,
  };
}

/** For tests / manual reset. */
export function resetFaqCacheStats(): void {
  exactHits = 0;
  fuzzyHits = 0;
  misses = 0;
}

// ==================== LOOKUP / STORE ====================

export interface FaqCacheHit {
  answer: string;
  matchType: 'exact' | 'fuzzy';
  similarity?: number;
}

/**
 * Look up a cached FAQ answer for this village.
 * Exact-normalized match first; fuzzy token-set fallback second.
 * Returns null on miss (caller runs the agent as usual). Never throws.
 */
export async function faqCacheLookup(
  tenantId: string,
  question: string,
): Promise<FaqCacheHit | null> {
  const miss = (reason: string): null => {
    misses++;
    logger.debug('[FaqCache] miss', {
      tenantId,
      reason,
      q: (question ?? '').slice(0, 60),
    });
    return null;
  };

  if (!tenantId || !(question ?? '').trim()) return miss('empty');
  const normalized = normalizeFaqQuery(question);
  if (normalized.length < FAQ_CACHE_CONFIG.minQuestionChars) return miss('too_short');
  if (isContextualFollowUp(question)) return miss('contextual_follow_up');

  // 1. Exact-normalized match (cheap, deterministic).
  try {
    const exact = await semanticCacheLookup(tenantId, question);
    if (exact) {
      exactHits++;
      logger.info('[FaqCache] HIT exact', {
        tenantId,
        q: normalized.slice(0, 80),
      });
      return { answer: exact, matchType: 'exact' };
    }
  } catch {
    /* fall through to fuzzy */
  }

  // 2. Fuzzy fallback: token-set Jaccard over this tenant's live entries.
  // Tenant-scoped by construction — cross-village candidates are impossible.
  try {
    const candidates = await semanticCacheListQuestions(
      tenantId,
      docVersion(),
      FAQ_CACHE_CONFIG.maxCandidates,
    );
    let best: { answer: string; sim: number } | null = null;
    for (const c of candidates) {
      const sim = faqTokenSimilarity(normalized, c.question);
      if (sim >= FAQ_CACHE_CONFIG.fuzzyThreshold && (!best || sim > best.sim)) {
        best = { answer: c.answer, sim };
      }
    }
    if (best) {
      fuzzyHits++;
      logger.info('[FaqCache] HIT fuzzy', {
        tenantId,
        similarity: best.sim.toFixed(3),
        q: normalized.slice(0, 80),
      });
      // Promote the variant: next identical phrasing becomes an exact hit.
      void semanticCacheStore(
        tenantId, question, best.answer, 'INFORMATION', FAQ_CACHE_CONFIG.ttlMs,
      ).catch(() => undefined);
      return { answer: best.answer, matchType: 'fuzzy', similarity: best.sim };
    }
  } catch {
    /* fail-open → miss */
  }

  return miss('no_match');
}

/**
 * Store an agent answer as a village FAQ. Silently skips anything that is
 * not a stable factual answer (see isFaqCacheable). Never throws.
 */
export async function faqCacheStore(
  tenantId: string,
  question: string,
  answer: string,
  stage: string,
): Promise<void> {
  if (!isFaqCacheable(question, answer, stage)) {
    logger.debug('[FaqCache] not cacheable — skip store', {
      tenantId,
      stage,
      q: (question ?? '').slice(0, 60),
    });
    return;
  }
  try {
    await semanticCacheStore(tenantId, question, answer, stage, FAQ_CACHE_CONFIG.ttlMs);
    // Simple size cap (keep most-hit / newest per tenant).
    void semanticCacheEvictOverflow(
      tenantId, docVersion(), FAQ_CACHE_CONFIG.maxEntriesPerTenant,
    ).catch(() => undefined);
  } catch {
    /* best effort — caching must never break the pipeline */
  }
}

/**
 * Invalidate all FAQ entries for one village (e.g. after KB / service
 * requirement changes). Delegates to the shared semantic-cache table.
 */
export async function faqCacheInvalidate(tenantId: string): Promise<void> {
  if (!tenantId) return;
  logger.info('[FaqCache] invalidate village', { tenantId });
  await semanticCacheInvalidate(tenantId).catch(() => undefined);
}

export default {
  normalizeFaqQuery,
  faqTokenSimilarity,
  isContextualFollowUp,
  isFaqCacheable,
  faqCacheLookup,
  faqCacheStore,
  faqCacheInvalidate,
  getFaqCacheStats,
  resetFaqCacheStats,
  FAQ_CACHE_CONFIG,
};
