-- Add scoped normalized keys for service categories.
-- Duplicate legacy rows are kept but receive a deterministic suffix so the
-- unique constraint can be added without deleting data.

ALTER TABLE "service_categories" ADD COLUMN IF NOT EXISTS "name_key" TEXT;

WITH normalized AS (
  SELECT
    "id",
    lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')) AS base_key,
    row_number() OVER (
      PARTITION BY "village_id", lower(regexp_replace(btrim("name"), '\s+', ' ', 'g'))
      ORDER BY "created_at", "id"
    ) AS duplicate_rank
  FROM "service_categories"
)
UPDATE "service_categories" AS sc
SET "name_key" = CASE
  WHEN normalized.duplicate_rank = 1 THEN normalized.base_key
  ELSE normalized.base_key || '-' || normalized.duplicate_rank::text
END
FROM normalized
WHERE sc."id" = normalized."id";

ALTER TABLE "service_categories" ALTER COLUMN "name_key" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "service_categories_village_id_name_key_key"
  ON "service_categories"("village_id", "name_key");

CREATE INDEX IF NOT EXISTS "service_categories_name_key_idx"
  ON "service_categories"("name_key");
