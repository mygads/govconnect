CREATE SCHEMA IF NOT EXISTS ai;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA ai;

DO $$
BEGIN
  IF to_regclass('ai.user_memory_vectors') IS NULL AND to_regclass('public.user_memory_vectors') IS NOT NULL THEN
    ALTER TABLE public.user_memory_vectors SET SCHEMA ai;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS user_memory_vectors_embedding_hnsw_idx
  ON ai.user_memory_vectors
  USING hnsw (embedding ai.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
