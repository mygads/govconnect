/**
 * Semantic cache — for factual, non-personal INFORMATION answers.
 *
 * Design (arsitektur-final §10 cost):
 * - Caches ONLY deterministic informational answers (office hours, fees,
 *   procedures). Never: personal data, ticket statuses, anything with a
 *   ticket ref / NIK / phone, or COLLECT/VERIFY/EXECUTE turns.
 * - Key scope: (tenant_id, doc_version, normalized question). A document
 *   update bumps doc_version → old entries stop matching (see
 *   semanticCacheInvalidate).
 * - TTL 24h default. Hits increment a counter for effectiveness tracking.
 */

import { createHash } from 'crypto';
import { semanticCacheGet, semanticCachePut } from './pipeline-store';
import { extractClaims } from './claim-verifier';

const CACHE_TTL_MS = Number(process.env.SEMANTIC_CACHE_TTL_MS ?? 24 * 3600 * 1000);

/** Document version: bump when village documents change. */
export function docVersion(): string {
  return process.env.KB_DOC_VERSION ?? 'v1';
}

function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export function cacheKeyFor(tenantId: string, question: string): string {
  return createHash('sha256')
    .update(`${tenantId}|${docVersion()}|${normalizeQuestion(question)}`)
    .digest('hex');
}

/**
 * Is this answer safe to cache? Rejects anything personal or dynamic.
 */
export function isCacheable(stage: string, question: string, answer: string): boolean {
  if (stage !== 'INFORMATION') return false;
  const claims = extractClaims(answer);
  // Ticket refs and amounts are personal/dynamic — never cache.
  if (claims.some((c) => c.type === 'ticket_ref' || c.type === 'amount')) return false;
  if (/\b\d{16}\b/.test(answer) || /(?:\+62|62|0)8\d{8,11}/.test(answer)) return false;
  if (normalizeQuestion(question).length < 8) return false;
  return true;
}

export async function semanticCacheLookup(
  tenantId: string, question: string,
): Promise<string | null> {
  const hit = await semanticCacheGet(cacheKeyFor(tenantId, question));
  return hit?.answer ?? null;
}

export async function semanticCacheStore(
  tenantId: string, question: string, answer: string, stage: string,
): Promise<void> {
  if (!isCacheable(stage, question, answer)) return;
  await semanticCachePut(
    cacheKeyFor(tenantId, question), tenantId, docVersion(),
    normalizeQuestion(question), answer, CACHE_TTL_MS,
  );
}
