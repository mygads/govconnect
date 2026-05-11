-- Composite index for knowledge_base queries
CREATE INDEX IF NOT EXISTS idx_knowledge_base_village_active_created ON knowledge_base (village_id, is_active, created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_village_category_active ON knowledge_base (village_id, category_id, is_active);
