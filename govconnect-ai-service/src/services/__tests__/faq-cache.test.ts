/**
 * FAQ Cache — unit tests.
 *
 * Storage layer (pipeline/semantic-cache.ts + pipeline/pipeline-store.ts) is
 * faked in-memory via vi.mock, replicating real semantics:
 *  - store applies the REAL isCacheable() guard (importOriginal)
 *  - keys computed with the REAL cacheKeyFor() (tenant-scoped hash)
 *  - TTL enforced per entry (expires_at semantics)
 *  - listQuestions / invalidate are tenant-scoped
 * This tests OUR logic (normalization, fuzzy, guards, metrics) without a DB.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeEntry {
  tenantId: string;
  docV: string;
  cacheKey: string;
  question: string; // normalized, as the real store saves it
  answer: string;
  ts: number;
  ttlMs: number;
}

const fakeTable = new Map<string, FakeEntry>();
let fakeSeq = 0;

/** Replicates pipeline/semantic-cache.ts normalizeQuestion. */
function realNormalize(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

vi.mock('../../pipeline/semantic-cache', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../pipeline/semantic-cache')>();
  return {
    ...orig,
    semanticCacheLookup: vi.fn(async (tenantId: string, question: string) => {
      const key = orig.cacheKeyFor(tenantId, question);
      for (const [id, e] of fakeTable) {
        if (e.tenantId === tenantId && e.cacheKey === key) {
          if (Date.now() - e.ts > e.ttlMs) {
            fakeTable.delete(id); // expired → miss (expires_at semantics)
            return null;
          }
          return e.answer;
        }
      }
      return null;
    }),
    semanticCacheStore: vi.fn(
      async (tenantId: string, question: string, answer: string, stage: string, ttlMs = 24 * 3600 * 1000) => {
        // Faithful to the real store: the isCacheable() guard decides.
        if (!orig.isCacheable(stage, question, answer)) return;
        const key = orig.cacheKeyFor(tenantId, question);
        fakeTable.set(`e${++fakeSeq}`, {
          tenantId,
          docV: orig.docVersion(),
          cacheKey: key,
          question: realNormalize(question),
          answer,
          ts: Date.now(),
          ttlMs,
        });
      },
    ),
  };
});

vi.mock('../../pipeline/pipeline-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../pipeline/pipeline-store')>();
  return {
    ...orig,
    semanticCacheListQuestions: vi.fn(async (tenantId: string, docV: string, limit = 500) => {
      const out: Array<{ cacheKey: string; question: string; answer: string; hits: number }> = [];
      for (const e of fakeTable.values()) {
        if (e.tenantId !== tenantId || e.docV !== docV) continue;
        if (Date.now() - e.ts > e.ttlMs) continue; // expires_at filter
        out.push({ cacheKey: e.cacheKey, question: e.question, answer: e.answer, hits: 0 });
        if (out.length >= limit) break;
      }
      return out;
    }),
    semanticCacheInvalidate: vi.fn(async (tenantId: string) => {
      for (const [id, e] of fakeTable) {
        if (e.tenantId === tenantId) fakeTable.delete(id);
      }
    }),
    semanticCacheEvictOverflow: vi.fn(async () => 0),
  };
});

import {
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
} from '../faq-cache.service';

const FAQ_A = 'Syarat membuat KTP: fotokopi KK dan surat pengantar RT/RW.';

beforeEach(() => {
  fakeTable.clear();
  resetFaqCacheStats();
});

// ==================== normalization ====================

describe('normalizeFaqQuery', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeFaqQuery('  Jam   BUKA kantor?? ')).toBe('jam buka kantor');
  });

  it('maps colloquial synonyms and drops filler words', () => {
    expect(normalizeFaqQuery('Syarat bikin KTP dong?')).toBe('syarat buat ktp');
    expect(normalizeFaqQuery('Gimana cara ngurus KTP, kak?')).toBe('bagaimana cara ngurus ktp');
    expect(normalizeFaqQuery('Biaya ga ada kan ya?')).toBe('biaya tidak ada kan');
  });
});

// ==================== similarity ====================

describe('faqTokenSimilarity', () => {
  it('is 1 for paraphrases equal after normalization', () => {
    expect(faqTokenSimilarity('syarat bikin ktp', 'syarat buat ktp')).toBe(1);
  });

  it('is order-independent', () => {
    expect(faqTokenSimilarity('jam buka kantor desa', 'kantor desa buka jam berapa')).toBeCloseTo(0.8, 5);
  });

  it('is 0 for unrelated questions', () => {
    expect(faqTokenSimilarity('syarat bikin ktp', 'jam buka kantor')).toBe(0);
  });

  it('rejects single-word meaning changes below the 0.7 threshold', () => {
    // ktp↔kk and buka↔tutup must NOT fuzzy-match (wrong factual answer risk)
    expect(faqTokenSimilarity('syarat buat ktp', 'syarat buat kk')).toBeLessThan(0.7);
    expect(faqTokenSimilarity('jam buka kantor', 'jam tutup kantor')).toBeLessThan(0.7);
  });

  it('accepts single-word add/drop at/above the 0.7 threshold', () => {
    expect(faqTokenSimilarity('jam buka kantor desa', 'jam buka kantor')).toBeGreaterThanOrEqual(0.7);
  });
});

// ==================== contextual guard ====================

describe('isContextualFollowUp', () => {
  it('flags anaphoric follow-ups that need conversation context', () => {
    expect(isContextualFollowUp('syaratnya?')).toBe(true);
    expect(isContextualFollowUp('Biayanya dong kak')).toBe(true);
    expect(isContextualFollowUp('berapa lama prosesnya?')).toBe(true);
  });

  it('allows self-contained questions', () => {
    expect(isContextualFollowUp('syarat bikin ktp apa saja?')).toBe(false);
    expect(isContextualFollowUp('jam buka kantor desa?')).toBe(false);
  });
});

// ==================== cacheability guard ====================

describe('isFaqCacheable', () => {
  it('accepts stable factual INFORMATION answers', () => {
    expect(isFaqCacheable('syarat bikin ktp apa saja?', FAQ_A, 'INFORMATION')).toBe(true);
  });

  it('rejects non-INFORMATION stages (no caching mid multi-turn flow)', () => {
    expect(isFaqCacheable('syarat bikin ktp apa saja?', FAQ_A, 'COLLECT')).toBe(false);
    expect(isFaqCacheable('syarat bikin ktp apa saja?', FAQ_A, 'VERIFY')).toBe(false);
  });

  it('rejects NIK / phone in question or answer', () => {
    expect(isFaqCacheable('cek NIK saya 3273010101900001', 'ok', 'INFORMATION')).toBe(false);
    expect(isFaqCacheable('jam buka?', 'hubungi 081234567890 ya', 'INFORMATION')).toBe(false);
  });

  it('rejects ticket refs and personal status questions', () => {
    expect(isFaqCacheable('cek status laporan saya', 'Status LAP-20260101-001: diproses.', 'INFORMATION')).toBe(false);
    expect(isFaqCacheable('status LAP-20260101-001?', 'diproses', 'INFORMATION')).toBe(false);
  });

  it('rejects error / fallback answers', () => {
    expect(isFaqCacheable('syarat bikin ktp?', 'Maaf, terjadi gangguan. Coba lagi nanti.', 'INFORMATION')).toBe(false);
  });

  it('rejects too-short and contextual follow-up questions', () => {
    expect(isFaqCacheable('halo', 'Halo!', 'INFORMATION')).toBe(false);
    expect(isFaqCacheable('syaratnya?', FAQ_A, 'INFORMATION')).toBe(false);
  });
});

// ==================== (a) village isolation ====================

describe('(a) village isolation', () => {
  it('same query hits in village A, misses in village B', async () => {
    await faqCacheStore('desa-a', 'Apa saja syarat membuat KTP?', FAQ_A, 'INFORMATION');

    const exact = await faqCacheLookup('desa-a', 'APA SAJA SYARAT MEMBUAT KTP?');
    expect(exact).not.toBeNull();
    expect(exact!.matchType).toBe('exact');
    expect(exact!.answer).toBe(FAQ_A);

    const other = await faqCacheLookup('desa-b', 'APA SAJA SYARAT MEMBUAT KTP?');
    expect(other).toBeNull();
  });

  it('fuzzy variant hits in the same village only', async () => {
    await faqCacheStore('desa-a', 'Apa saja syarat membuat KTP?', FAQ_A, 'INFORMATION');

    const fuzzy = await faqCacheLookup('desa-a', 'apa saja syarat membuat ktp dong?');
    expect(fuzzy).not.toBeNull();
    expect(fuzzy!.matchType).toBe('fuzzy');
    expect(fuzzy!.answer).toBe(FAQ_A);

    expect(await faqCacheLookup('desa-b', 'apa saja syarat membuat ktp dong?')).toBeNull();
  });
});

// ==================== (b) TTL expiry ====================

describe('(b) TTL expiry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('entry hits before TTL, misses after', async () => {
    vi.setSystemTime(new Date('2026-10-01T10:00:00+07:00'));
    await faqCacheStore('desa-a', 'Apa saja syarat membuat KTP?', FAQ_A, 'INFORMATION');
    expect(await faqCacheLookup('desa-a', 'apa saja syarat membuat ktp?')).not.toBeNull();

    vi.advanceTimersByTime(FAQ_CACHE_CONFIG.ttlMs + 1000);
    expect(await faqCacheLookup('desa-a', 'apa saja syarat membuat ktp?')).toBeNull();
    expect(getFaqCacheStats().misses).toBeGreaterThanOrEqual(1);
  });
});

// ==================== (c) invalidation on KB change ====================

describe('(c) invalidation on KB change', () => {
  it('faqCacheInvalidate clears only the affected village', async () => {
    await faqCacheStore('desa-a', 'Apa saja syarat membuat KTP?', FAQ_A, 'INFORMATION');
    await faqCacheStore('desa-a', 'Jam berapa kantor desa buka?', 'Senin–Jumat 08.00–14.00.', 'INFORMATION');
    await faqCacheStore('desa-b', 'Apa saja syarat membuat KTP?', 'Syarat versi desa B.', 'INFORMATION');

    await faqCacheInvalidate('desa-a');

    expect(await faqCacheLookup('desa-a', 'apa saja syarat membuat ktp?')).toBeNull();
    expect(await faqCacheLookup('desa-a', 'jam berapa kantor desa buka?')).toBeNull();
    // Village B untouched — answers never leak, invalidations neither.
    const b = await faqCacheLookup('desa-b', 'apa saja syarat membuat ktp?');
    expect(b).not.toBeNull();
    expect(b!.answer).toBe('Syarat versi desa B.');
  });
});

// ==================== (d) personal/ticket never cached ====================

describe('(d) personal/ticket never cached', () => {
  it('does not store NIK questions, ticket statuses, or error answers', async () => {
    await faqCacheStore('desa-a', 'berapa NIK saya 3273010101900001?', 'NIK Anda terdaftar.', 'INFORMATION');
    await faqCacheStore('desa-a', 'cek status laporan saya', 'Status LAP-20260101-001: diproses.', 'INFORMATION');
    await faqCacheStore('desa-a', 'syarat bikin ktp apa saja?', 'Maaf, terjadi gangguan. Coba lagi nanti.', 'INFORMATION');

    expect(await faqCacheLookup('desa-a', 'berapa nik saya 3273010101900001?')).toBeNull();
    expect(await faqCacheLookup('desa-a', 'cek status laporan saya')).toBeNull();
    // The factual question itself was never stored (its answer was an error).
    expect(await faqCacheLookup('desa-a', 'syarat bikin ktp apa saja?')).toBeNull();
    expect(fakeTable.size).toBe(0);
  });

  it('does not store COLLECT-stage turns (mid-flow complaint drafts)', async () => {
    await faqCacheStore('desa-a', 'Apa saja syarat membuat KTP?', FAQ_A, 'COLLECT');
    expect(await faqCacheLookup('desa-a', 'apa saja syarat membuat ktp?')).toBeNull();
    expect(fakeTable.size).toBe(0);
  });
});

// ==================== (e) hit-rate simulation ====================

describe('(e) hit-rate simulation', () => {
  it('measures hit rate over a realistic mixed workload', async () => {
    const seeds: Array<[string, string]> = [
      ['Apa saja syarat membuat KTP?', 'Syarat membuat KTP: fotokopi KK dan surat pengantar RT/RW.'],
      ['Jam berapa kantor desa buka?', 'Kantor desa buka Senin sampai Jumat pukul 08.00 sampai 14.00.'],
      ['Berapa biaya pembuatan KK baru?', 'Pembuatan KK baru tidak dipungut biaya.'],
      ['Bagaimana cara mengurus surat domisili?', 'Bawa KTP dan KK ke kantor desa, isi formulir, surat jadi hari yang sama.'],
      ['Di mana lokasi kantor desa?', 'Kantor desa berlokasi di Jl. Raya Desa No. 1.'],
    ];
    for (const [q, a] of seeds) {
      await faqCacheStore('desa-a', q, a, 'INFORMATION');
    }

    // 35 exact repeats (the "asked 100x/day" reality)
    for (let r = 0; r < 7; r++) {
      for (const [q] of seeds) {
        await faqCacheLookup('desa-a', q);
      }
    }

    // 15 paraphrase variants (some hit via fuzzy, some correctly miss)
    const variants = [
      'apa saja syarat membuat ktp dong?',
      'Syarat membuat KTP apa saja kak?',
      'jam berapa kantor desa buka',
      'kapan kantor desa buka?',
      'biaya pembuatan kk baru berapa?',
      'berapa biaya bikin kk baru?',
      'cara mengurus surat domisili gimana?',
      'gimana cara urus surat domisili?',
      'lokasi kantor desa di mana?',
      'dimana kantor desa?',
      'syarat buat ktp?',
      'info syarat ktp dong',
      'jam buka kantor desa?',
      'kantor desa tutup jam berapa?',
      'surat domisili cara mengurusnya?',
    ];
    for (const v of variants) {
      await faqCacheLookup('desa-a', v);
    }

    // 10 cross-village (must ALL miss — isolation)
    for (const [q] of seeds) {
      await faqCacheLookup('desa-b', q);
      await faqCacheLookup('desa-b', q);
    }

    // 10 personal / contextual / too-short (must ALL miss)
    const personal = [
      'cek status laporan saya LAP-20260101-001',
      'status LAP-20260101-001 gimana?',
      'berapa NIK saya 3273010101900001?',
      'syaratnya?',
      'biayanya dong',
      'halo',
      'berapa lama prosesnya?',
      'cek laporan saya TMP-20260101-001',
      'nik saya berapa ya?',
      'ok',
    ];
    for (const p of personal) {
      await faqCacheLookup('desa-a', p);
    }

    const stats = getFaqCacheStats();
    // eslint-disable-next-line no-console
    console.log('[faq-cache simulation]', JSON.stringify(stats));

    expect(stats.exactHits).toBeGreaterThanOrEqual(30); // 35 repeats + exact variants
    expect(stats.fuzzyHits).toBeGreaterThanOrEqual(5);  // filler/reorder variants
    expect(stats.misses).toBeGreaterThanOrEqual(20);    // cross-village + personal + far variants
    expect(stats.hitRate).toBeGreaterThanOrEqual(0.55);
  });
});

// ==================== metrics ====================

describe('metrics', () => {
  it('tracks exact/fuzzy/miss counters and hit rate', async () => {
    await faqCacheStore('desa-a', 'Apa saja syarat membuat KTP?', FAQ_A, 'INFORMATION');
    await faqCacheLookup('desa-a', 'apa saja syarat membuat ktp?'); // exact
    await faqCacheLookup('desa-a', 'apa saja syarat membuat ktp dong?'); // fuzzy
    await faqCacheLookup('desa-a', 'jam berapa kantor desa buka?'); // miss

    const s = getFaqCacheStats();
    expect(s.exactHits).toBe(1);
    expect(s.fuzzyHits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.totalHits).toBe(2);
    expect(s.hitRate).toBeCloseTo(2 / 3, 5);
    expect(s.fuzzyShare).toBeCloseTo(0.5, 5);
  });
});
