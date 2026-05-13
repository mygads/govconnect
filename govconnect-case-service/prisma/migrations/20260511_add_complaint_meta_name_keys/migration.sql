-- Backfill normalized complaint meta keys and enforce per-scope uniqueness

ALTER TABLE complaint_categories
  ADD COLUMN IF NOT EXISTS name_key TEXT;

ALTER TABLE complaint_types
  ADD COLUMN IF NOT EXISTS name_key TEXT;

UPDATE complaint_categories
SET name_key = LOWER(REGEXP_REPLACE(BTRIM(name), '\s+', ' ', 'g'))
WHERE name_key IS NULL OR name_key = '';

UPDATE complaint_types
SET name_key = LOWER(REGEXP_REPLACE(BTRIM(name), '\s+', ' ', 'g'))
WHERE name_key IS NULL OR name_key = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM complaint_categories
    GROUP BY village_id, name_key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate complaint category names exist after normalization; resolve collisions before applying migration.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM complaint_types
    GROUP BY category_id, name_key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate complaint type names exist after normalization; resolve collisions before applying migration.';
  END IF;
END $$;

ALTER TABLE complaint_categories
  ALTER COLUMN name_key SET NOT NULL;

ALTER TABLE complaint_types
  ALTER COLUMN name_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS complaint_categories_village_id_name_key_key
  ON complaint_categories(village_id, name_key);

CREATE UNIQUE INDEX IF NOT EXISTS complaint_types_category_id_name_key_key
  ON complaint_types(category_id, name_key);

CREATE INDEX IF NOT EXISTS complaint_categories_name_key_idx
  ON complaint_categories(name_key);

CREATE INDEX IF NOT EXISTS complaint_types_name_key_idx
  ON complaint_types(name_key);
