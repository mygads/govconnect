/**
 * Tests for the REAL local-embedding provider module (no mocks).
 *
 * - Pure config helpers: always run, no model download.
 * - Slow test (real model load + Indonesian embedding): opt-in only via
 *   LOCAL_EMBEDDING_SLOW_TEST=1, mirroring whisper-service's slow marker.
 *   The default model downloads ~470 MB from HuggingFace on first use.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  isLocalEmbeddingEnabled,
  getLocalEmbeddingModel,
  getLocalEmbeddingCacheDir,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
} from '../local-embedding.provider';

const saved: Record<string, string | undefined> = {
  LOCAL_EMBEDDING: process.env.LOCAL_EMBEDDING,
  LOCAL_EMBEDDING_MODEL: process.env.LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_CACHE_DIR: process.env.LOCAL_EMBEDDING_CACHE_DIR,
};

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('local-embedding provider config (pure)', () => {
  it('isLocalEmbeddingEnabled reads the flag strictly', () => {
    delete process.env.LOCAL_EMBEDDING;
    expect(isLocalEmbeddingEnabled()).toBe(false);
    process.env.LOCAL_EMBEDDING = 'true';
    expect(isLocalEmbeddingEnabled()).toBe(true);
    process.env.LOCAL_EMBEDDING = '1';
    expect(isLocalEmbeddingEnabled()).toBe(false);
  });

  it('getLocalEmbeddingModel defaults to the multilingual model', () => {
    delete process.env.LOCAL_EMBEDDING_MODEL;
    expect(getLocalEmbeddingModel()).toBe(DEFAULT_LOCAL_EMBEDDING_MODEL);
    expect(DEFAULT_LOCAL_EMBEDDING_MODEL).toContain('multilingual');
    process.env.LOCAL_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
    expect(getLocalEmbeddingModel()).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('getLocalEmbeddingCacheDir is undefined unless set', () => {
    delete process.env.LOCAL_EMBEDDING_CACHE_DIR;
    expect(getLocalEmbeddingCacheDir()).toBeUndefined();
    process.env.LOCAL_EMBEDDING_CACHE_DIR = '/models/embeddings';
    expect(getLocalEmbeddingCacheDir()).toBe('/models/embeddings');
  });
});

const runSlow = process.env.LOCAL_EMBEDDING_SLOW_TEST === '1';

describe('local-embedding provider (slow, opt-in)', () => {
  (runSlow ? it : it.skip)(
    'loads the real model and embeds Indonesian with sensible ordering',
    async () => {
      const { localEmbed, getLocalEmbeddingDims } = await import(
        '../local-embedding.provider'
      );
      const dims = await getLocalEmbeddingDims();
      expect(dims).toBe(384);
      const [vec] = await localEmbed(['berapa biaya pembuatan KTP?']);
      expect(vec).toHaveLength(384);
      const norm = Math.sqrt(vec!.reduce((s, v) => s + v * v, 0));
      expect(norm).toBeCloseTo(1, 3);
    },
    300000,
  );
});
