ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "file_hash" TEXT;

CREATE INDEX IF NOT EXISTS "knowledge_documents_village_id_file_hash_idx"
  ON "knowledge_documents"("village_id", "file_hash");

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_documents_village_file_hash_active_unique"
  ON "knowledge_documents"("village_id", "file_hash")
  WHERE "file_hash" IS NOT NULL AND "status" IN ('processing', 'completed');
