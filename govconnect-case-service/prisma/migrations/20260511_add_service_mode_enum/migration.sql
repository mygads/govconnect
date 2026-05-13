-- Normalize legacy service.mode values and enforce a strict enum

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'ServiceMode'
  ) THEN
    CREATE TYPE "ServiceMode" AS ENUM ('ONLINE', 'OFFLINE', 'BOTH');
  END IF;
END $$;

ALTER TABLE services_dynamic
  ALTER COLUMN mode DROP DEFAULT;

UPDATE services_dynamic
SET mode = CASE
  WHEN mode IS NULL THEN 'OFFLINE'
  WHEN BTRIM(LOWER(mode)) = 'online' THEN 'ONLINE'
  WHEN BTRIM(LOWER(mode)) = 'offline' THEN 'OFFLINE'
  WHEN BTRIM(LOWER(mode)) = 'both' THEN 'BOTH'
  ELSE 'OFFLINE'
END;

ALTER TABLE services_dynamic
  ALTER COLUMN mode TYPE "ServiceMode"
  USING (
    CASE
      WHEN mode IS NULL THEN 'OFFLINE'::"ServiceMode"
      WHEN BTRIM(LOWER(mode)) = 'online' THEN 'ONLINE'::"ServiceMode"
      WHEN BTRIM(LOWER(mode)) = 'offline' THEN 'OFFLINE'::"ServiceMode"
      WHEN BTRIM(LOWER(mode)) = 'both' THEN 'BOTH'::"ServiceMode"
      ELSE 'OFFLINE'::"ServiceMode"
    END
  ),
  ALTER COLUMN mode SET DEFAULT 'BOTH',
  ALTER COLUMN mode SET NOT NULL;
