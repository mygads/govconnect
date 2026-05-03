ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'village',
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'village',
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE knowledge_base
SET scope = 'village', is_global = FALSE
WHERE scope IS NULL OR is_global IS NULL OR village_id IS NULL;

UPDATE knowledge_documents
SET scope = 'village', is_global = FALSE
WHERE scope IS NULL OR is_global IS NULL OR village_id IS NULL;

CREATE INDEX IF NOT EXISTS knowledge_base_scope_is_global_idx ON knowledge_base(scope, is_global);
CREATE INDEX IF NOT EXISTS knowledge_base_village_scope_global_idx ON knowledge_base(village_id, scope, is_global);
CREATE INDEX IF NOT EXISTS knowledge_documents_scope_is_global_idx ON knowledge_documents(scope, is_global);
CREATE INDEX IF NOT EXISTS knowledge_documents_village_scope_global_idx ON knowledge_documents(village_id, scope, is_global);
