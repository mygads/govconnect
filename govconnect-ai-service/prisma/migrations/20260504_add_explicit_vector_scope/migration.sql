ALTER TABLE ai.knowledge_vectors
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'village',
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE ai.document_vectors
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'village',
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE ai.question_variants
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'village',
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE ai.knowledge_vectors
SET scope = 'village', is_global = FALSE
WHERE scope IS NULL OR is_global IS NULL OR village_id IS NULL;

UPDATE ai.document_vectors
SET scope = 'village', is_global = FALSE
WHERE scope IS NULL OR is_global IS NULL OR village_id IS NULL;

UPDATE ai.question_variants
SET scope = 'village', is_global = FALSE
WHERE scope IS NULL OR is_global IS NULL OR village_id IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_vectors_scope_is_global_idx ON ai.knowledge_vectors(scope, is_global);
CREATE INDEX IF NOT EXISTS knowledge_vectors_village_scope_global_idx ON ai.knowledge_vectors(village_id, scope, is_global);
CREATE INDEX IF NOT EXISTS document_vectors_scope_is_global_idx ON ai.document_vectors(scope, is_global);
CREATE INDEX IF NOT EXISTS document_vectors_village_scope_global_idx ON ai.document_vectors(village_id, scope, is_global);
CREATE INDEX IF NOT EXISTS question_variants_scope_is_global_idx ON ai.question_variants(scope, is_global);
CREATE INDEX IF NOT EXISTS question_variants_village_scope_global_idx ON ai.question_variants(village_id, scope, is_global);
