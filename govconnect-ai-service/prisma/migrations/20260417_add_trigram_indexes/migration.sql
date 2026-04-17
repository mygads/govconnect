-- Fase 1.3: Enable pg_trgm extension for trigram-based fuzzy text search
-- This improves keyword search for Indonesian text with typos and variations

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add GIN trigram indexes for faster LIKE/ILIKE and similarity searches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_vectors_title_trgm 
  ON knowledge_vectors USING gin (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_vectors_content_trgm 
  ON knowledge_vectors USING gin (content gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_vectors_content_trgm 
  ON document_vectors USING gin (content gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_vectors_section_title_trgm 
  ON document_vectors USING gin (section_title gin_trgm_ops);
