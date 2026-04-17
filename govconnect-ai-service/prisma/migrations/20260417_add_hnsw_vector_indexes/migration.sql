-- Fase 0.8: Add HNSW vector indexes for faster ANN search
-- This replaces sequential scan with approximate nearest neighbor search

-- HNSW index for knowledge_vectors embedding
CREATE INDEX IF NOT EXISTS knowledge_vectors_embedding_hnsw_idx
ON knowledge_vectors
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- HNSW index for document_vectors embedding
CREATE INDEX IF NOT EXISTS document_vectors_embedding_hnsw_idx
ON document_vectors
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
