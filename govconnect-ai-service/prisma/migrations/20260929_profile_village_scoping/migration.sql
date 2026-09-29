-- W5 (P0 privacy): scope durable_user_profiles by (village_id, wa_user_id).
--
-- Legacy rows (written before scoping) keep village_id = '' (empty string =
-- unknown village). The service (user-profile.service.ts) reads the scoped key
-- first and falls back to the legacy row, lazily migrating it to the scoped
-- key on the next write and deleting the legacy row. No user data is deleted
-- by this migration.
--
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.
-- Defensive IF EXISTS / IF NOT EXISTS so the migration is re-runnable.

ALTER TABLE "durable_user_profiles"
  ADD COLUMN IF NOT EXISTS "village_id" TEXT NOT NULL DEFAULT '';

ALTER TABLE "durable_user_profiles"
  DROP CONSTRAINT IF EXISTS "durable_user_profiles_pkey";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'durable_user_profiles_pkey'
  ) THEN
    ALTER TABLE "durable_user_profiles"
      ADD CONSTRAINT "durable_user_profiles_pkey" PRIMARY KEY ("village_id", "wa_user_id");
  END IF;
END $$;
