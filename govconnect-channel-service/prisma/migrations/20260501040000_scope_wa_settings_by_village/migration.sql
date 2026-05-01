ALTER TABLE "wa_settings" ADD COLUMN IF NOT EXISTS "village_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "wa_settings_village_id_key" ON "wa_settings"("village_id");
