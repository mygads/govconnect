/**
 * Unit test untuk query rewriting sebelum RAG retrieval
 * (query-rewrite.service.ts + wiring di retrieveContext).
 *
 * Cakupan:
 * - rewriteQueryForRAG: pure function, tanpa I/O — kasus anaforis,
 *   kasus sudah-lengkap (tidak di-rewrite), preservasi makna,
 *   buildQueryRewriteContext dari slots/recentMessages.
 * - retrieveContext: membuktikan query yang sampai ke lapisan retrieval
 *   (hybridSearch) adalah hasil rewrite, bukan query mentah.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  rewriteQueryForRAG,
  buildQueryRewriteContext,
  deriveTopicFromTurns,
  hasAnaphoricSignal,
  type QueryRewriteContext,
} from '../query-rewrite.service';

// ── Mock modul berat SEBELUM import rag.service ──────────────────────────
// (pola yang sama dengan rag-failclosed.test.ts)
vi.mock('../../lib/prisma', () => ({
  default: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  },
}));
vi.mock('../embedding.service', () => ({
  generateEmbedding: vi.fn(),
}));
vi.mock('../vector-db.service', () => ({
  searchVectors: vi.fn(),
  recordBatchRetrievals: vi.fn().mockResolvedValue(undefined),
}));
const hybridSearchMock = vi.fn();
vi.mock('../hybrid-search.service', () => ({
  hybridSearch: (...args: unknown[]) => hybridSearchMock(...args),
}));
vi.mock('../ai-gateway.service', () => ({
  getDefaultRAGRewriteModels: vi.fn().mockReturnValue([]),
  isAIGatewayEnabledAsync: vi.fn().mockResolvedValue(false),
  buildPromptMessages: vi.fn(),
  callAIGatewayPrompt: vi.fn().mockResolvedValue(null),
  callAIGatewayRerank: vi.fn(),
}));
vi.mock('../micro-llm-matcher.service', () => ({
  classifyRAGIntent: vi.fn(),
}));

import { retrieveContext } from '../rag.service';

// ── rewriteQueryForRAG ───────────────────────────────────────────────────

describe('rewriteQueryForRAG: pertanyaan anaforis di-rewrite dengan konteks', () => {
  const lapCtx: QueryRewriteContext = { activeTopic: 'laporan LAP-20261001-001' };

  it('"kapan selesainya?" + konteks laporan LAP-xxx → rewritten mengandung nomor laporan', () => {
    const r = rewriteQueryForRAG('kapan selesainya?', lapCtx);
    expect(r.didRewrite).toBe(true);
    expect(r.rewritten).toContain('LAP-20261001-001');
  });

  it('"syaratnya apa aja?" + konteks "pembuatan KTP" → rewritten mengandung KTP', () => {
    const r = rewriteQueryForRAG('syaratnya apa aja?', { activeTopic: 'pembuatan KTP' });
    expect(r.didRewrite).toBe(true);
    expect(r.rewritten).toContain('KTP');
  });

  it('"di mana?" + konteks layanan → di-rewrite (interogatif telanjang = anaforis)', () => {
    const r = rewriteQueryForRAG('di mana?', { activeTopic: 'KTP' });
    expect(r.didRewrite).toBe(true);
    expect(r.rewritten).toContain('KTP');
  });

  it('rewrite TIDAK mengubah makna: pertanyaan asli dipertahankan utuh di depan', () => {
    const r = rewriteQueryForRAG('kapan selesainya?', lapCtx);
    // Core pertanyaan asli ("kapan selesainya") tetap menjadi awalan —
    // rewrite hanya MENAMBAH frasa topik, tidak memparafrase.
    expect(r.rewritten.startsWith('kapan selesainya')).toBe(true);
    expect(r.rewritten.endsWith('?')).toBe(true);
  });

  it('entitas tambahan ikut ditempel bila belum disebut query', () => {
    const r = rewriteQueryForRAG('biayanya berapa?', {
      activeTopic: 'pembuatan KTP',
      entities: ['surat domisili'],
    });
    expect(r.didRewrite).toBe(true);
    expect(r.rewritten).toContain('KTP');
  });
});

describe('rewriteQueryForRAG: pertanyaan lengkap TIDAK di-rewrite (hemat)', () => {
  it('"syarat bikin KTP apa?" + konteks KTP → tidak di-rewrite (sudah lengkap)', () => {
    const r = rewriteQueryForRAG('syarat bikin KTP apa?', { activeTopic: 'KTP' });
    expect(r.didRewrite).toBe(false);
    expect(r.rewritten).toBe('syarat bikin KTP apa?');
  });

  it('query yang sudah menyebut nomor tiketnya sendiri → tidak di-rewrite', () => {
    const r = rewriteQueryForRAG('kapan laporan LAP-20261001-001 selesai?', {
      activeTopic: 'laporan LAP-20261001-001',
    });
    expect(r.didRewrite).toBe(false);
    expect(r.reason).toBe('already_mentions_topic');
  });

  it('query lengkap tanpa sinyal anafora → tidak di-rewrite', () => {
    const r = rewriteQueryForRAG('saya mau tanya jam buka kantor desa', {
      activeTopic: 'KTP',
    });
    expect(r.didRewrite).toBe(false);
    expect(r.reason).toBe('no_anaphoric_signal');
  });

  it('tanpa konteks → tidak di-rewrite (tidak ada yang bisa ditempelkan)', () => {
    const r = rewriteQueryForRAG('kapan selesainya?');
    expect(r.didRewrite).toBe(false);
    expect(r.reason).toBe('no_context');
    expect(r.rewritten).toBe('kapan selesainya?');
  });

  it('"saya punya KTP baru" → tidak di-rewrite ("punya" bukan klitika anafora)', () => {
    const r = rewriteQueryForRAG('saya punya KTP baru', { activeTopic: 'KTP' });
    expect(r.didRewrite).toBe(false);
  });

  it('ganti topik eksplisit ("kalau KK gimana?") tidak ditempeli topik lama', () => {
    const r = rewriteQueryForRAG('kalau KK gimana?', { activeTopic: 'KTP' });
    expect(r.didRewrite).toBe(false);
    expect(r.rewritten).not.toContain('KTP');
  });

  it('query kosong → tidak di-rewrite', () => {
    expect(rewriteQueryForRAG('   ', { activeTopic: 'KTP' }).didRewrite).toBe(false);
  });
});

describe('hasAnaphoricSignal', () => {
  it('mendeteksi -nya anaforis', () => {
    expect(hasAnaphoricSignal('kapan selesainya?')).toBe(true);
    expect(hasAnaphoricSignal('berapa biayanya?')).toBe(true);
  });
  it('mendeteksi demonstrativa/pronomina', () => {
    expect(hasAnaphoricSignal('itu maksudnya apa?')).toBe(true);
    expect(hasAnaphoricSignal('dia sudah diproses?')).toBe(true);
  });
  it('tidak false-positive pada "punya"/"hanya"', () => {
    expect(hasAnaphoricSignal('saya punya KTP')).toBe(false);
    // 'hanya' dikecualikan dari aturan -nya; tanpa demonstrativa lain
    // ('itu'/'ini' memang sinyal anafora yang sah) tidak ada sinyal.
    expect(hasAnaphoricSignal('saya hanya butuh info')).toBe(false);
  });
});

// ── buildQueryRewriteContext / deriveTopicFromTurns ─────────────────────

describe('buildQueryRewriteContext', () => {
  it('mengekstrak nomor tiket dari recentMessages menjadi activeTopic', () => {
    const ctx = buildQueryRewriteContext({
      recentMessages: [
        { role: 'user', content: 'saya mau lapor jalan rusak' },
        { role: 'assistant', content: 'Laporan LAP-20261001-001 sudah tercatat.' },
      ],
    });
    expect(ctx.activeTopic).toContain('LAP-20261001-001');
  });

  it('mengekstrak kata kunci layanan (KTP) dari turn terakhir', () => {
    const ctx = buildQueryRewriteContext({
      recentMessages: [{ role: 'user', content: 'saya mau bikin KTP' }],
    });
    expect(ctx.activeTopic?.toLowerCase()).toContain('ktp');
  });

  it('mengambil topik dari slots (turnState), mis. kategori triage', () => {
    const ctx = buildQueryRewriteContext({
      slots: { kategori: 'Surat Keterangan Domisili' },
    });
    expect(ctx.activeTopic).toBe('Surat Keterangan Domisili');
  });

  it('tiket di slots diprioritaskan sebagai activeTopic', () => {
    const ctx = buildQueryRewriteContext({
      slots: { pendingTool: { tool: 'create_complaint', args: { ref: 'LAP-20261001-007' } } },
    });
    expect(ctx.activeTopic).toContain('LAP-20261001-007');
  });

  it('tanpa sinyal apa pun → konteks kosong (rewrite tidak jalan)', () => {
    const ctx = buildQueryRewriteContext({});
    expect(ctx.activeTopic).toBeUndefined();
  });

  it('deriveTopicFromTurns: tiket mengalahkan kata kunci layanan', () => {
    const topic = deriveTopicFromTurns([
      'Warga: saya mau bikin KTP',
      'Asisten: laporan LAP-20261001-001 sudah tercatat untuk KTP anda',
    ]);
    expect(topic).toContain('LAP-20261001-001');
  });
});

// ── Wiring: retrieveContext memakai hasil rewrite ────────────────────────

describe('retrieveContext: rewrite berjalan SEBELUM retrieval', () => {
  beforeEach(() => {
    hybridSearchMock.mockReset();
    hybridSearchMock.mockResolvedValue([
      {
        id: 'doc-1',
        score: 0.9,
        content: 'Estimasi penyelesaian laporan adalah 3-7 hari kerja.',
        source: 'SOP Pengaduan',
        sourceType: 'knowledge',
        metadata: {},
      },
    ]);
  });

  it('query anaforis sampai ke hybridSearch sebagai query lengkap berkonteks', async () => {
    const result = await retrieveContext('kapan selesainya?', {
      topK: 5,
      minScore: 0.5,
      retrievalMode: 'raw_no_rerank',
      useQueryExpansion: false,
      queryRewriteContext: { activeTopic: 'laporan LAP-20261001-001' },
    });

    expect(hybridSearchMock).toHaveBeenCalledTimes(1);
    const querySentToRetrieval = hybridSearchMock.mock.calls[0][0] as string;
    expect(querySentToRetrieval).toContain('LAP-20261001-001');
    expect(querySentToRetrieval.startsWith('kapan selesainya')).toBe(true);

    // Observabilitas: retrievalDebug mencatat rewrite.
    expect(result.retrievalDebug?.rewroteQuery).toBe(true);
    expect(result.retrievalDebug?.rewrittenQuery).toContain('LAP-20261001-001');
    expect(result.totalResults).toBe(1);
  });

  it('tanpa queryRewriteContext, query diteruskan apa adanya', async () => {
    await retrieveContext('kapan selesainya?', {
      topK: 5,
      minScore: 0.5,
      retrievalMode: 'raw_no_rerank',
      useQueryExpansion: false,
    });

    const querySentToRetrieval = hybridSearchMock.mock.calls[0][0] as string;
    expect(querySentToRetrieval).toBe('kapan selesainya?');
  });
});

describe('[P2-3] multi-entity anaphora', () => {
  it('rewrites "semua itu" with all entities', async () => {
    const { rewriteQueryForRAG } = await import('../query-rewrite.service');
    const result = rewriteQueryForRAG('biayanya berapa semua itu?', {
      activeTopic: 'KTP',
      entities: ['KTP', 'Kartu Keluarga'],
      recentTurns: ['syarat KTP apa?', 'kalau KK gimana?'],
    });
    expect(result.didRewrite).toBe(true);
    expect(result.rewritten).toMatch(/KTP/i);
    expect(result.rewritten).toMatch(/Kartu Keluarga/i);
  });

  it('rewrites single entity normally', async () => {
    const { rewriteQueryForRAG } = await import('../query-rewrite.service');
    const result = rewriteQueryForRAG('biayanya berapa?', {
      activeTopic: 'KTP',
      entities: ['KTP'],
      recentTurns: [],
    });
    expect(result.didRewrite).toBe(true);
    expect(result.rewritten).toMatch(/KTP/i);
  });
});
