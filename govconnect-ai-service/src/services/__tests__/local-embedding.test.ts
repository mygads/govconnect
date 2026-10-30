/**
 * Tests for W18: self-hosted embedding (LOCAL_EMBEDDING=true).
 *
 * The heavy provider module is mocked here; only the wiring in
 * embedding.service.ts (branch → local vectors, model label, dims) is
 * exercised. Real-model verification lives in local-embedding-config.test.ts
 * (opt-in slow test) and was verified manually 2026-09-29.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai-gateway.service', () => ({
  callAIGatewayEmbeddings: vi.fn(),
  isAIGatewayEnabledAsync: vi.fn(async () => true),
}));
vi.mock('../ai-turn-billing.service', () => ({
  getCurrentBillingContext: vi.fn(() => null),
}));
vi.mock('../local-embedding.provider', () => ({
  isLocalEmbeddingEnabled: vi.fn(() => true),
  localEmbed: vi.fn(async (texts: string[]) =>
    texts.map((_t, i) => [0.1 * (i + 1), 0.2, 0.3]),
  ),
  getLocalEmbeddingModel: vi.fn(() => 'test-model'),
  getLocalEmbeddingDims: vi.fn(async () => 3),
}));

import { localEmbed } from '../local-embedding.provider';
import { generateEmbedding, generateBatchEmbeddings } from '../embedding.service';

const mockLocalEmbed = vi.mocked(localEmbed);

describe('W18: local embedding wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateEmbedding uses the local provider when enabled', async () => {
    const res = await generateEmbedding('berapa biaya pembuatan KTP?', {
      taskType: 'RETRIEVAL_QUERY',
      useCache: false,
    });
    expect(mockLocalEmbed).toHaveBeenCalledTimes(1);
    expect(mockLocalEmbed.mock.calls[0]![0]).toEqual(['berapa biaya pembuatan KTP?']);
    expect(res.model).toBe('local:test-model');
    expect(res.dimensions).toBe(3);
    expect(res.values).toHaveLength(3);
  });

  it('generateBatchEmbeddings routes the whole batch locally', async () => {
    const res = await generateBatchEmbeddings(['satu', 'dua'], { useCache: false });
    expect(mockLocalEmbed).toHaveBeenCalledTimes(1);
    expect(mockLocalEmbed.mock.calls[0]![0]).toEqual(['satu', 'dua']);
    expect(res.embeddings).toHaveLength(2);
    expect(res.embeddings[0]!.model).toBe('local:test-model');
    expect(res.embeddings[1]!.values).toHaveLength(3);
  });

  it('blank text still returns a zero vector without calling the model', async () => {
    const res = await generateEmbedding('   ', { useCache: false });
    expect(mockLocalEmbed).not.toHaveBeenCalled();
    expect(res.values.every((v) => v === 0)).toBe(true);
  });
});
