ALTER TABLE "notification_logs"
  ADD COLUMN IF NOT EXISTS "message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "reference_number" TEXT,
  ADD COLUMN IF NOT EXISTS "entity_status" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_status" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_error" TEXT;

CREATE INDEX IF NOT EXISTS "notification_logs_message_id_idx"
  ON "notification_logs" ("message_id");

CREATE INDEX IF NOT EXISTS "notification_logs_reference_number_idx"
  ON "notification_logs" ("reference_number");
