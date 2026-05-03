CREATE SCHEMA IF NOT EXISTS ai;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF to_regclass('ai.knowledge_vectors') IS NULL AND to_regclass('public.knowledge_vectors') IS NOT NULL THEN
    ALTER TABLE public.knowledge_vectors SET SCHEMA ai;
  END IF;

  IF to_regclass('ai.document_vectors') IS NULL AND to_regclass('public.document_vectors') IS NOT NULL THEN
    ALTER TABLE public.document_vectors SET SCHEMA ai;
  END IF;

  IF to_regclass('ai.question_variants') IS NULL AND to_regclass('public.question_variants') IS NOT NULL THEN
    ALTER TABLE public.question_variants SET SCHEMA ai;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_title_trgm
  ON ai.knowledge_vectors USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_content_trgm
  ON ai.knowledge_vectors USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_document_vectors_content_trgm
  ON ai.document_vectors USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_document_vectors_section_title_trgm
  ON ai.document_vectors USING gin (section_title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS knowledge_vectors_embedding_hnsw_idx
  ON ai.knowledge_vectors
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS document_vectors_embedding_hnsw_idx
  ON ai.document_vectors
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
