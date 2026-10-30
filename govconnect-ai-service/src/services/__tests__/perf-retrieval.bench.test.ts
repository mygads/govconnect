/**
 * P0-1 latency benchmark: RAG retrieval orchestration cost (before/after).
 *
 * Provider boundaries are mocked with realistic simulated latencies
 * (Sumopod-era observations: micro-LLM ~1.2s, embedding ~1.5s, vector DB
 * query ~0.3s, dashboard keyword HTTP ~0.2s). The benchmark measures what the
 * pipeline itself controls: HOW MANY sequential provider calls it makes and
 * the resulting orchestration wall time.
 *
 * Scenarios (per searchKnowledge call):
 *   A "hit-first" : candidates survive the first attempt's threshold.
 *   B "full-miss" : no candidates at any threshold -> exercises the whole
 *                   fallback chain + keyword fallbacks.
 *
 * The embedding mock emulates the real RETRIEVAL_QUERY cache (same text ->
 * instant hit), so the benchmark reflects the true before/after delta of the
 * fallback-chain collapse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const LAT = { microLLM: 1200, embedding: 1500, vectorDB: 300, dashboardKw: 200 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mutable candidate pool (scores) used by the searchVectors mock. */
let CANDIDATE_SCORES: number[] = [];

const toVectorResult = (score: number, i: number) => ({
  id: `vec-${i}`,
  content: `konten pengetahuan ${i} tentang syarat surat domisili dan prosedur layanan desa`,
  score,
  source: `Dokumen ${i}`,
  sourceType: 'knowledge' as const,
  metadata: { category: 'layanan_administrasi', keywords: ['syarat', 'domisili'] },
});

vi.mock('../ai-gateway.service', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../ai-gateway.service')>();
  return {
    ...orig,
    // keep heuristic rerank (no external rerank lane) so we measure the
    // deterministic path; all other lanes enabled.
    isAIGatewayEnabledAsync: vi.fn(async (kind: string) => kind !== 'rerank'),
    // Realistic provider latency for any direct LLM call the pipeline makes
    // (e.g. expandQuery's LLM fallback on the final retrieval attempt).
    callAIGatewayPrompt: vi.fn(async (opts: any) => {
      await sleep(opts?.callType === 'rag_query_expand' ? 1000 : 800);
      const q: string = opts?.messages?.[opts.messages.length - 1]?.content ?? 'query';
      return { text: `${q} tambahan kata kunci mock`, model: 'mock-llm' };
    }),
  };
});

vi.mock('../micro-llm-matcher.service', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../micro-llm-matcher.service')>();
  return {
    ...orig,
    classifyRAGIntent: vi.fn(async () => {
      await sleep(LAT.microLLM);
      return {
        decision: 'RAG_REQUIRED',
        confidence: 0.8,
        reason: 'bench',
        categories: ['layanan_administrasi'],
      };
    }),
  };
});

vi.mock('../embedding.service', async () => {
  // Emulates the real RETRIEVAL_QUERY embedding cache: identical text is an
  // instant hit, a new text pays the provider latency once.
  const cache = new Map<string, number[]>();
  return {
    generateEmbedding: vi.fn(async (text: string) => {
      const hit = cache.get(text);
      if (hit) return { values: hit, dimensions: 768, model: 'cached', normalized: true };
      await sleep(LAT.embedding);
      const values = new Array(768).fill(0.01);
      cache.set(text, values);
      return { values, dimensions: 768, model: 'mock', normalized: true };
    }),
    __benchResetEmbeddingCache: () => cache.clear(),
  };
});

vi.mock('../vector-db.service', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../vector-db.service')>();
  return {
    ...orig,
    searchVectors: vi.fn(async (_emb: number[], opts: { minScore?: number; topK?: number }) => {
      await sleep(LAT.vectorDB);
      const min = opts.minScore ?? 0;
      return CANDIDATE_SCORES.filter((s) => s >= min)
        .slice(0, opts.topK ?? 5)
        .map(toVectorResult);
    }),
    countKnowledgeDocs: vi.fn(async () => 5),
    searchKnowledgeByKeywordsDirect: vi.fn(async () => []),
    recordBatchRetrievals: vi.fn(async () => undefined),
  };
});

vi.mock('../rag-quality-gate.service', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../rag-quality-gate.service')>();
  return { ...orig, recordRAGQualityMetrics: vi.fn(async () => undefined) };
});

vi.mock('../ai-analytics.service', async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    aiAnalyticsService: {
      ...(orig.aiAnalyticsService ?? {}),
      recordKnowledge: vi.fn(),
      recordRetrievalTrace: vi.fn(),
    },
  };
});

vi.mock('axios', () => ({
  default: {
    post: vi.fn(async () => {
      await sleep(LAT.dashboardKw);
      return { data: { total: 0, data: [], context: '' } };
    }),
  },
}));

process.env.PERF_TRACE = '1';

describe('P0-1 retrieval orchestration benchmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CANDIDATE_SCORES = [];
  });

  it('scenario A (hit on first attempt): wall time + provider call counts', async () => {
    CANDIDATE_SCORES = [0.78, 0.62, 0.5];
    const { searchKnowledge } = await import('../knowledge.service');
    const { clearRetrievalCache } = await import('../rag.service');
    const { perfReset, perfGetCounters, perfReport } = await import('../../pipeline/perf-timer');
    clearRetrievalCache();
    (await import('../embedding.service') as any).__benchResetEmbeddingCache?.();
    perfReset();

    const t0 = Date.now();
    const res = await searchKnowledge(
      'syarat membuat surat domisili apa saja',
      undefined,
      { villageId: 'bench-village', channel: 'webchat' },
    );
    const wall = Date.now() - t0;
    perfReport('bench:hit-first');

    console.log(`[bench] HIT-FIRST wall=${wall}ms total=${res.total}`);
    expect(res.total).toBeGreaterThan(0);
    // Budget for the optimized path (single attempt):
    //   intent(1200) + embedding(1500) + vectorDB(300) + overhead < 6000ms
    expect(wall).toBeLessThan(6000);
    const counters = perfGetCounters();
    console.log('[bench] counters', JSON.stringify(counters));
  }, 60000);

  it('scenario B (full miss): fallback chain wall time + provider call counts', async () => {
    CANDIDATE_SCORES = [];
    const { searchKnowledge } = await import('../knowledge.service');
    const { clearRetrievalCache } = await import('../rag.service');
    const { perfReset, perfGetCounters, perfReport } = await import('../../pipeline/perf-timer');
    clearRetrievalCache();
    perfReset();

    const t0 = Date.now();
    const res = await searchKnowledge(
      'pertanyaan yang tidak ada di dokumen manapun xyzabc',
      undefined,
      { villageId: 'bench-village', channel: 'webchat' },
    );
    const wall = Date.now() - t0;
    perfReport('bench:full-miss');

    console.log(`[bench] FULL-MISS wall=${wall}ms total=${res.total}`);
    expect(res.total).toBe(0);
    const counters = perfGetCounters();
    console.log('[bench] counters', JSON.stringify(counters));
  }, 60000);
});
