/**
 * W6: unit tests untuk post-retrieval fail-closed assertion.
 *
 * Menguji evaluateFailClosed() dari rag.service.ts (pure function, tanpa I/O):
 * - top score < 0.65 + query substantif → unreliable=true (hasil dibuang)
 * - top score >= 0.65 → unreliable=false (perilaku HIGH/MEDIUM tidak berubah)
 * - tanpa hasil → unreliable=false (tidak ada yang dibuang)
 * - intent 'skip' (sapaan) → exempt
 */
import { describe, it, expect, vi } from 'vitest';

// Mock modul berat sebelum import rag.service (hanya evaluateFailClosed yang
// dipakai; mock mencegah side-effect import seperti PrismaClient).
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
  recordBatchRetrievals: vi.fn(),
}));
vi.mock('../hybrid-search.service', () => ({
  hybridSearch: vi.fn(),
}));
vi.mock('../ai-gateway.service', () => ({
  // getDefaultRAGRewriteModels() dipanggil di top-level rag.service.ts.
  getDefaultRAGRewriteModels: vi.fn().mockReturnValue([]),
  isAIGatewayEnabledAsync: vi.fn().mockResolvedValue(false),
  buildPromptMessages: vi.fn(),
  callAIGatewayPrompt: vi.fn(),
  callAIGatewayRerank: vi.fn(),
}));
vi.mock('../micro-llm-matcher.service', () => ({
  classifyRAGIntent: vi.fn(),
}));

import { evaluateFailClosed, RAG_FAILCLOSED_MIN_SCORE } from '../rag.service';

describe('rag fail-closed (W6)', () => {
  it('threshold fail-closed = 0.65', () => {
    expect(RAG_FAILCLOSED_MIN_SCORE).toBe(0.65);
  });

  it('unreliable=true: semua hasil di bawah threshold (query substantif)', () => {
    const d = evaluateFailClosed(0.5, 3, 'information');
    expect(d.unreliable).toBe(true);
    expect(d.reason).toMatch(/0\.500.*<.*0\.65|threshold/);
  });

  it('unreliable=true: tepat di bawah threshold (0.649)', () => {
    expect(evaluateFailClosed(0.649, 2, 'service_info').unreliable).toBe(true);
  });

  it('unreliable=false: top score tepat di threshold (0.65)', () => {
    const d = evaluateFailClosed(0.65, 2, 'information');
    expect(d.unreliable).toBe(false);
  });

  it('unreliable=false: skor HIGH/MEDIUM tidak berubah perilakunya', () => {
    expect(evaluateFailClosed(0.92, 5, 'information').unreliable).toBe(false);
    expect(evaluateFailClosed(0.72, 3, 'complaint').unreliable).toBe(false);
  });

  it('unreliable=false: tidak ada hasil (tidak ada yang perlu dibuang)', () => {
    expect(evaluateFailClosed(null, 0, 'information').unreliable).toBe(false);
    expect(evaluateFailClosed(null, 0, 'information').reason).toMatch(/no results/);
  });

  it('unreliable=false: sapaan/greeting (intent skip) dikecualikan', () => {
    const d = evaluateFailClosed(0.4, 2, 'skip');
    expect(d.unreliable).toBe(false);
    expect(d.reason).toMatch(/exempt/);
  });

  it('berlaku untuk semua intent substantif', () => {
    for (const intent of ['information', 'service_info', 'complaint', 'required', 'status']) {
      expect(evaluateFailClosed(0.3, 1, intent).unreliable).toBe(true);
      expect(evaluateFailClosed(0.9, 1, intent).unreliable).toBe(false);
    }
  });
});
