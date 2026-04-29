-- AI provider health tracking for smart routing & cooldown.
CREATE TABLE IF NOT EXISTS "ai_provider_health" (
  "provider_id"          TEXT NOT NULL,
  "lane_type"            TEXT NOT NULL,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "demoted_until"        TIMESTAMP(3),
  "last_success_at"      TIMESTAMP(3),
  "last_failure_at"      TIMESTAMP(3),
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_provider_health_pkey" PRIMARY KEY ("provider_id", "lane_type")
);

CREATE INDEX IF NOT EXISTS "ai_provider_health_demoted_until_idx" ON "ai_provider_health" ("demoted_until");

-- Foreign key (skip cascade delete to keep history if provider purged).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_health_provider_fkey'
  ) THEN
    ALTER TABLE "ai_provider_health"
      ADD CONSTRAINT "ai_provider_health_provider_fkey"
      FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- Optional priority columns for ai_models / ai_providers. Used by smart routing
-- to order fallback attempts when multiple models exist for the same lane.
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "ai_providers" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 100;
