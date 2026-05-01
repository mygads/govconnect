ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "profile_name" TEXT,
  ADD COLUMN IF NOT EXISTS "profile_avatar_url" TEXT,
  ADD COLUMN IF NOT EXISTS "profile_is_whatsapp" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "profile_raw" JSONB,
  ADD COLUMN IF NOT EXISTS "profile_synced_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "wa_activity_logs" (
  "id" TEXT NOT NULL,
  "village_id" TEXT NOT NULL,
  "session_id" TEXT,
  "wa_user_id" TEXT,
  "channel_identifier" TEXT,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "status" TEXT,
  "message" TEXT NOT NULL,
  "provider_event" TEXT,
  "provider_message_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wa_activity_logs_village_id_created_at_idx" ON "wa_activity_logs"("village_id", "created_at");
CREATE INDEX IF NOT EXISTS "wa_activity_logs_village_id_type_created_at_idx" ON "wa_activity_logs"("village_id", "type", "created_at");
CREATE INDEX IF NOT EXISTS "wa_activity_logs_severity_idx" ON "wa_activity_logs"("severity");
