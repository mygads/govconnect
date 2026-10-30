/**
 * W18 — Self-hosted embedding provider (CPU).
 *
 * Runs a sentence-embedding model locally via @xenova/transformers
 * (ONNX Runtime, CPU) so no document/query text leaves the premises for
 * the embedding step. Activated with LOCAL_EMBEDDING=true.
 *
 * Verified 2026-09-29 on this VM:
 * - model Xenova/paraphrase-multilingual-MiniLM-L12-v2 (multilingual,
 *   includes Indonesian), 384 dims, mean pooling, L2-normalized
 * - batch of 3 Indonesian sentences: ~48 ms on CPU (model cached)
 * - sanity: sim("berapa biaya pembuatan KTP?","berapa tarif membuat KTP baru?")=0.64
 *           vs sim("…KTP?","jadwal posyandu bulan ini kapan?")=0.12
 *
 * IMPORTANT — dimensionality: the local model has FIXED native dims (384
 * for the default model), independent of the gateway's configured dims.
 * Enabling LOCAL_EMBEDDING changes the vector space: the KB vector store
 * MUST be (re-)indexed with local embeddings. NEVER mix gateway and local
 * vectors in one index — retrieval quality silently degrades.
 *
 * The model downloads from HuggingFace on first use (or at docker build
 * time, like whisper-service); set LOCAL_EMBEDDING_CACHE_DIR to persist it.
 */

import logger from '../utils/logger';

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

export function isLocalEmbeddingEnabled(): boolean {
  return process.env.LOCAL_EMBEDDING === 'true';
}

export function getLocalEmbeddingModel(): string {
  return (process.env.LOCAL_EMBEDDING_MODEL ?? '').trim() || DEFAULT_LOCAL_EMBEDDING_MODEL;
}

export function getLocalEmbeddingCacheDir(): string | undefined {
  return (process.env.LOCAL_EMBEDDING_CACHE_DIR ?? '').trim() || undefined;
}

// Lazy singleton: the model (hundreds of MB) loads on first use, exactly once.
// A failed load resets the promise so a later call can retry.
let extractorPromise: Promise<LocalExtractor> | null = null;
let extractorDims: number | null = null;

type LocalExtractor = (
  texts: string[],
  opts: { pooling: string; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

async function getExtractor(): Promise<LocalExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async (): Promise<LocalExtractor> => {
      // Dynamic import: keeps the heavy transformers.js runtime out of the
      // static import graph (unit tests and gateway-only deploys never load it).
      const { pipeline } = (await import('@xenova/transformers')) as {
        pipeline: (task: string, model: string, opts?: { cache_dir?: string }) => Promise<LocalExtractor>;
      };
      const model = getLocalEmbeddingModel();
      const cacheDir = getLocalEmbeddingCacheDir();
      logger.info('[local-embedding] loading model', { model, cacheDir: cacheDir ?? '(default)' });
      const extractor = await pipeline('feature-extraction', model, cacheDir ? { cache_dir: cacheDir } : {});
      const probe = await extractor(['dim probe'], { pooling: 'mean', normalize: true });
      const dims = probe.tolist()[0]?.length ?? 0;
      if (!dims) throw new Error('local embedding model returned zero-dim vector');
      extractorDims = dims;
      logger.info('[local-embedding] model loaded', { model, dims });
      return extractor;
    })().catch((err) => {
      extractorPromise = null; // allow retry on next call
      throw err;
    });
  }
  return extractorPromise;
}

/** Native dimensionality of the loaded local model (loads it if needed). */
export async function getLocalEmbeddingDims(): Promise<number> {
  await getExtractor();
  if (extractorDims == null) throw new Error('local embedding dims unknown after load');
  return extractorDims;
}

// transformers.js pipelines are not safe for concurrent use; serialize calls.
let queue: Promise<void> = Promise.resolve();

/**
 * Embed texts locally. Returns L2-normalized vectors (native model dims).
 * Throws on load/inference failure — the caller decides fallback policy.
 */
export async function localEmbed(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const run = queue.then(async () => {
    const out = await extractor(texts, { pooling: 'mean', normalize: true });
    const vectors = out.tolist();
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      throw new Error(`local embed count mismatch: got ${vectors?.length ?? 0}, want ${texts.length}`);
    }
    return vectors;
  });
  // Keep the chain alive regardless of this call's outcome.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
