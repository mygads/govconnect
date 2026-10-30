/**
 * A2 — Village glossary: local terms → standard Indonesian.
 *
 * Citizens often write in Javanese/Sundanese/dialect ("dalane rusak",
 * "bade ngadamel KTP"). The deterministic pipeline (intent router, slot
 * FSM) only understands standard Indonesian, so glossary normalization
 * runs BEFORE routing/slot extraction.
 *
 * Rules:
 * - Whole-word, case-insensitive replacement; longest terms first so
 *   "surat pengantar" wins over "surat".
 * - Pure function (unit-testable). DB load is best-effort with a small
 *   in-process cache; a missing glossary = no normalization (fail-open,
 *   the message flows through unchanged).
 * - Normalization is AUDITED (which terms fired) so staff can see it.
 *
 * How a village adds terms (for now, via SQL — dashboard UI is future):
 *   INSERT INTO pipeline_village_glossaries (id, village_id, istilah, bentuk_baku, contoh)
 *   VALUES ('...', '<village_id>', 'dalane', 'jalannya', 'dalane rusak → jalannya rusak');
 * Example seeds: prisma/seeds/village-glossary-seed.sql
 */

import { getDb, dbDown } from './pipeline-store';
import logger from '../utils/logger';

export interface GlossaryEntry {
  istilah: string;
  bentukBaku: string;
  contoh?: string;
}

export interface NormalizationResult {
  text: string;
  /** Terms that fired, in order. Empty = nothing changed. */
  applied: Array<{ istilah: string; bentukBaku: string }>;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pure: replace glossary terms in text (whole-word, case-insensitive,
 * longest-first). Returns the normalized text + which terms fired.
 */
export function normalizeWithGlossary(
  text: string, entries: GlossaryEntry[],
): NormalizationResult {
  if (!text || entries.length === 0) return { text, applied: [] };
  const sorted = [...entries]
    .filter((e) => e.istilah.trim().length > 0 && e.bentukBaku.trim().length > 0)
    .sort((a, b) => b.istilah.length - a.istilah.length);
  let out = text;
  const applied: Array<{ istilah: string; bentukBaku: string }> = [];
  for (const e of sorted) {
    const re = new RegExp(`\\b${escapeRegExp(e.istilah.trim())}\\b`, 'gi');
    if (re.test(out)) {
      out = out.replace(re, e.bentukBaku.trim());
      applied.push({ istilah: e.istilah.trim(), bentukBaku: e.bentukBaku.trim() });
    }
  }
  return { text: out, applied };
}

// ── DB load (best-effort, small TTL cache) ────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; entries: GlossaryEntry[] }>();

export async function loadGlossary(tenantId: string): Promise<GlossaryEntry[]> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.entries;
  const db = await getDb();
  if (!db) return dbDown('loadGlossary', []);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT istilah, bentuk_baku, contoh FROM pipeline_village_glossaries
        WHERE village_id = $1 ORDER BY length(istilah) DESC`,
      tenantId,
    )) as Array<{ istilah: string; bentuk_baku: string; contoh: string }>;
    const entries = rows.map((r) => ({
      istilah: r.istilah, bentukBaku: r.bentuk_baku, contoh: r.contoh,
    }));
    cache.set(tenantId, { at: Date.now(), entries });
    return entries;
  } catch (err) {
    logger.debug('[glossary] load failed (fail-open: no normalization)', {
      error: String((err as Error)?.message ?? err).slice(0, 100),
    });
    return [];
  }
}

/** Test/ops helper: clear the in-process cache. */
export function clearGlossaryCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}
