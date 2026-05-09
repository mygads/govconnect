-- Migration helper: enable pgvector extension for dashboard-related vector columns
-- Run this before applying Prisma migrations that depend on the extension.

CREATE EXTENSION IF NOT EXISTS vector;

-- Optional examples for manual recovery only:
-- ALTER TABLE dashboard.knowledge_base ADD COLUMN IF NOT EXISTS embedding vector(768);
-- ALTER TABLE dashboard.knowledge_base ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(100);
-- ALTER TABLE dashboard.knowledge_base ADD COLUMN IF NOT EXISTS last_embedded_at TIMESTAMP;
-- CREATE INDEX IF NOT EXISTS knowledge_base_embedding_idx
--   ON dashboard.knowledge_base
--   USING hnsw (embedding vector_cosine_ops)
--   WHERE embedding IS NOT NULL;
-- CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
--   ON dashboard.document_chunks
--   USING hnsw (embedding vector_cosine_ops)
--   WHERE embedding IS NOT NULL;
