-- Baseline DB-backed AI provider runtime config tables before health/probe migrations.

CREATE TABLE IF NOT EXISTS "ai_providers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "provider_kind" TEXT NOT NULL DEFAULT 'openai_compatible',
  "base_url" TEXT NOT NULL,
  "api_key_encrypted" TEXT,
  "default_headers_json" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_slug_key" ON "ai_providers"("slug");
CREATE INDEX IF NOT EXISTS "ai_providers_is_active_idx" ON "ai_providers"("is_active");

CREATE TABLE IF NOT EXISTS "ai_models" (
  "id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "lane_type" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "upstream_model_name" TEXT NOT NULL,
  "endpoint_path" TEXT,
  "actual_pricing_type" TEXT NOT NULL DEFAULT 'per_million_tokens',
  "actual_fixed_price_usd" DOUBLE PRECISION,
  "actual_input_price_per_million_usd" DOUBLE PRECISION,
  "actual_output_price_per_million_usd" DOUBLE PRECISION,
  "adjusted_pricing_type" TEXT NOT NULL DEFAULT 'per_million_tokens',
  "adjusted_fixed_price_usd" DOUBLE PRECISION,
  "adjusted_input_price_per_million_usd" DOUBLE PRECISION,
  "adjusted_output_price_per_million_usd" DOUBLE PRECISION,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "is_publicly_selectable" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_models_provider_id_idx" ON "ai_models"("provider_id");
CREATE INDEX IF NOT EXISTS "ai_models_lane_type_idx" ON "ai_models"("lane_type");
CREATE INDEX IF NOT EXISTS "ai_models_is_active_idx" ON "ai_models"("is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_models_provider_id_lane_type_upstream_model_name_key" ON "ai_models"("provider_id", "lane_type", "upstream_model_name");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_models_provider_id_fkey') THEN
    ALTER TABLE "ai_models"
      ADD CONSTRAINT "ai_models_provider_id_fkey"
      FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ai_lane_assignments" (
  "id" TEXT NOT NULL,
  "lane_type" TEXT NOT NULL,
  "primary_model_id" TEXT NOT NULL,
  "fallback_model_id" TEXT,
  "village_id" TEXT,
  "is_global_default" BOOLEAN NOT NULL DEFAULT true,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_lane_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_lane_assignments_lane_type_idx" ON "ai_lane_assignments"("lane_type");
CREATE INDEX IF NOT EXISTS "ai_lane_assignments_village_id_idx" ON "ai_lane_assignments"("village_id");
CREATE INDEX IF NOT EXISTS "ai_lane_assignments_is_global_default_idx" ON "ai_lane_assignments"("is_global_default");
CREATE INDEX IF NOT EXISTS "ai_lane_assignments_is_active_idx" ON "ai_lane_assignments"("is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_lane_assignments_lane_type_village_id_is_global_default_key" ON "ai_lane_assignments"("lane_type", "village_id", "is_global_default");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_lane_assignments_one_global_default_per_lane_idx"
  ON "ai_lane_assignments"("lane_type")
  WHERE "village_id" IS NULL AND "is_global_default" = true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_lane_assignments_primary_model_id_fkey') THEN
    ALTER TABLE "ai_lane_assignments"
      ADD CONSTRAINT "ai_lane_assignments_primary_model_id_fkey"
      FOREIGN KEY ("primary_model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_lane_assignments_fallback_model_id_fkey') THEN
    ALTER TABLE "ai_lane_assignments"
      ADD CONSTRAINT "ai_lane_assignments_fallback_model_id_fkey"
      FOREIGN KEY ("fallback_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ai_provider_health" (
  "provider_id" TEXT NOT NULL,
  "lane_type" TEXT NOT NULL,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "demoted_until" TIMESTAMP(3),
  "last_success_at" TIMESTAMP(3),
  "last_failure_at" TIMESTAMP(3),
  "probe_in_flight_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_provider_health_pkey" PRIMARY KEY ("provider_id", "lane_type")
);

CREATE INDEX IF NOT EXISTS "ai_provider_health_demoted_until_idx" ON "ai_provider_health"("demoted_until");
CREATE INDEX IF NOT EXISTS "ai_provider_health_probe_in_flight_until_idx" ON "ai_provider_health"("probe_in_flight_until");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_health_provider_fkey') THEN
    ALTER TABLE "ai_provider_health"
      ADD CONSTRAINT "ai_provider_health_provider_fkey"
      FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
