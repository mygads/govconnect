/**
 * NLU Few-Shot Examples Service
 *
 * Admin-curated few-shot examples for the micro-NLU classifier. When an admin
 * flags a wrong answer as "should have been intent X", the villager's phrasing
 * is stored in ai.ai_nlu_few_shot_examples and injected into the classifier
 * prompt for that village. This lets the agent progressively understand local /
 * colloquial / regional phrasing WITHOUT retraining — a lightweight
 * self-improvement loop.
 *
 * Mirrors the caching pattern of dynamic-categories.service.ts, but sources
 * from the AI service's own Prisma DB (where the table lives) rather than the
 * Dashboard API.
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { LRUCache } from '../utils/lru-cache';

export interface FewShotExample {
  utterance: string;
  correct_intent: string | null;
  correct_category: string | null;
}

interface CachedExamples {
  examples: FewShotExample[];
  fetchedAt: number;
}

/** Cache TTL: 10 minutes (same as dynamic categories / service catalog). */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Cap examples injected into the prompt to keep token cost bounded. */
const MAX_EXAMPLES_PER_PROMPT = 15;

/** Per-village cache — bounded LRU to prevent memory leaks. */
const exampleCache = new LRUCache<string, CachedExamples>({
  maxSize: 200,
  ttlMs: CACHE_TTL_MS,
  name: 'nluFewShotCache',
});

/**
 * Get enabled few-shot examples for a village. Cached with TTL.
 * Returns [] when there is no village_id, no examples, or on DB error — the
 * classifier prompt simply omits the block, so this is always safe.
 */
export async function getFewShotExamples(villageId?: string): Promise<FewShotExample[]> {
  if (!villageId) return [];

  const cached = exampleCache.get(villageId);
  if (cached) return cached.examples;

  try {
    const rows = await prisma.ai_nlu_few_shot_examples.findMany({
      where: { village_id: villageId, enabled: true },
      orderBy: { created_at: 'desc' },
      take: MAX_EXAMPLES_PER_PROMPT,
      select: { utterance: true, correct_intent: true, correct_category: true },
    });

    const examples: FewShotExample[] = rows
      .filter((r) => (r.utterance || '').trim().length > 0)
      .map((r) => ({
        utterance: r.utterance.trim(),
        correct_intent: r.correct_intent,
        correct_category: r.correct_category,
      }));

    exampleCache.set(villageId, { examples, fetchedAt: Date.now() });
    if (examples.length > 0) {
      logger.info('[FewShot] Loaded NLU few-shot examples', { villageId, count: examples.length });
    }
    return examples;
  } catch (error: any) {
    logger.warn('[FewShot] Failed to load few-shot examples, skipping', {
      villageId,
      error: error.message,
    });
    const stale = exampleCache.get(villageId);
    if (stale) return stale.examples;
    return [];
  }
}

/**
 * Get the few-shot block formatted for injection into the classifier prompt.
 * Returns '' when there are no examples (safe for new/empty villages).
 *
 * Format (one line per example):
 *   - "<utterance>" → routing_intent: "<intent>"[, categories: ["<cat>"]]
 */
export async function getFewShotForPrompt(villageId?: string): Promise<string> {
  const examples = await getFewShotExamples(villageId);
  if (examples.length === 0) return '';

  const lines = examples.map((ex) => {
    const parts: string[] = [`routing_intent: "${ex.correct_intent || 'unknown'}"`];
    if (ex.correct_category) parts.push(`categories: ["${ex.correct_category}"]`);
    return `- "${ex.utterance}" → ${parts.join(', ')}`;
  });

  return [
    'CONTOH DARI DESA INI (koreksi admin — utamakan pola ini bila pesan mirip):',
    ...lines,
  ].join('\n');
}

/**
 * Invalidate the cache for a village after an admin adds/edits an example.
 * Call with no argument to clear all (useful for tests).
 */
export function clearFewShotCache(villageId?: string): void {
  if (villageId) {
    exampleCache.delete(villageId);
    logger.info('[FewShot] Cleared few-shot cache for village', { villageId });
  } else {
    exampleCache.clear();
    logger.info('[FewShot] Cleared all few-shot cache');
  }
}
