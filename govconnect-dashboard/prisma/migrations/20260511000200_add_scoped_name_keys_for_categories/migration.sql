ALTER TABLE knowledge_categories
  ADD COLUMN IF NOT EXISTS name_key TEXT;

UPDATE knowledge_categories
SET name_key = LOWER(REGEXP_REPLACE(BTRIM(name), '\s+', ' ', 'g'))
WHERE name_key IS NULL OR name_key = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM knowledge_categories
    GROUP BY village_id, name_key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate knowledge category names exist after normalization; resolve collisions before applying migration.';
  END IF;
END $$;

ALTER TABLE knowledge_categories
  ALTER COLUMN name_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_categories_village_id_name_key_key
  ON knowledge_categories (village_id, name_key);

ALTER TABLE important_contact_categories
  ADD COLUMN IF NOT EXISTS name_key TEXT;

UPDATE important_contact_categories
SET name_key = LOWER(REGEXP_REPLACE(BTRIM(name), '\s+', ' ', 'g'))
WHERE name_key IS NULL OR name_key = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM important_contact_categories
    GROUP BY village_id, name_key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate important contact category names exist after normalization; resolve collisions before applying migration.';
  END IF;
END $$;

ALTER TABLE important_contact_categories
  ALTER COLUMN name_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS important_contact_categories_village_id_name_key_key
  ON important_contact_categories (village_id, name_key);
