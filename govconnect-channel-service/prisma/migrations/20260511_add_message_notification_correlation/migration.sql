ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "reference_number" TEXT,
  ADD COLUMN IF NOT EXISTS "notification_type" TEXT,
  ADD COLUMN IF NOT EXISTS "entity_status" TEXT;

CREATE INDEX IF NOT EXISTS "messages_reference_number_idx"
  ON "messages" ("reference_number");

CREATE INDEX IF NOT EXISTS "messages_notification_type_entity_status_idx"
  ON "messages" ("notification_type", "entity_status");

ALTER TABLE "send_logs"
  ADD COLUMN IF NOT EXISTS "reference_number" TEXT,
  ADD COLUMN IF NOT EXISTS "notification_type" TEXT,
  ADD COLUMN IF NOT EXISTS "entity_status" TEXT;

CREATE INDEX IF NOT EXISTS "send_logs_reference_number_idx"
  ON "send_logs" ("reference_number");

CREATE INDEX IF NOT EXISTS "send_logs_notification_type_entity_status_idx"
  ON "send_logs" ("notification_type", "entity_status");
