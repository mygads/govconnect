ALTER TABLE "ai_golden_set_items" ADD COLUMN IF NOT EXISTS "retrieval_match" BOOLEAN;
ALTER TABLE "ai_golden_set_items" ADD COLUMN IF NOT EXISTS "retrieval_score" DOUBLE PRECISION;
ALTER TABLE "ai_golden_set_items" ADD COLUMN IF NOT EXISTS "retrieval_metrics" JSONB;
