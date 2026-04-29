-- Fase 1.6: Add embedding_status and embedding_error to knowledge_base for observable lifecycle
ALTER TABLE "knowledge_base" ADD COLUMN IF NOT EXISTS "embedding_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "knowledge_base" ADD COLUMN IF NOT EXISTS "embedding_error" TEXT;

-- Backfill: mark entries that already have embeddings as completed
UPDATE "knowledge_base" SET "embedding_status" = 'completed' WHERE "last_embedded_at" IS NOT NULL;
