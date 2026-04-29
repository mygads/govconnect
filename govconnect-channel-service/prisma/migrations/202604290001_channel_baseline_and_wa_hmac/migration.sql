DO $$
BEGIN
  CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP', 'WEBCHAT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "messages" (
  "id" TEXT NOT NULL,
  "village_id" TEXT NOT NULL,
  "wa_user_id" TEXT,
  "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP',
  "channel_identifier" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "message_text" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "send_logs" (
  "id" TEXT NOT NULL,
  "village_id" TEXT NOT NULL,
  "wa_user_id" TEXT,
  "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP',
  "channel_identifier" TEXT NOT NULL,
  "message_text" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error_msg" TEXT,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "send_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "wa_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "auto_read_messages" BOOLEAN NOT NULL DEFAULT true,
  "typing_indicator" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wa_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "wa_sessions" (
  "id" TEXT NOT NULL,
  "village_id" TEXT NOT NULL,
  "instance_name" TEXT,
  "admin_id" TEXT,
  "wa_token" TEXT NOT NULL,
  "wa_number" TEXT,
  "status" TEXT,
  "wa_support_user_id" TEXT,
  "wa_support_api_key" TEXT,
  "wa_support_session_id" TEXT,
  "webhook_secret" TEXT,
  "last_connected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wa_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "channel_accounts" (
  "id" TEXT NOT NULL,
  "village_id" TEXT NOT NULL,
  "wa_number" TEXT NOT NULL,
  "wa_token" TEXT NOT NULL,
  "webhook_url" TEXT NOT NULL,
  "enabled_wa" BOOLEAN NOT NULL DEFAULT false,
  "enabled_webchat" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "takeover_sessions" (
  "id" TEXT NOT NULL,
  "village_id" TEXT NOT NULL,
  "wa_user_id" TEXT,
  "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP',
  "channel_identifier" TEXT NOT NULL,
  "admin_id" TEXT NOT NULL,
  "admin_name" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "reason" TEXT,
  "enrichment_json" JSONB,
  CONSTRAINT "takeover_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" TEXT NOT NULL,
  "village_id" TEXT NOT NULL,
  "wa_user_id" TEXT,
  "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP',
  "channel_identifier" TEXT NOT NULL,
  "user_name" TEXT,
  "user_phone" TEXT,
  "last_message" TEXT,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unread_count" INTEGER NOT NULL DEFAULT 0,
  "is_takeover" BOOLEAN NOT NULL DEFAULT false,
  "ai_status" TEXT,
  "ai_error_message" TEXT,
  "pending_message_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pending_messages" (
  "id" TEXT NOT NULL,
  "village_id" TEXT NOT NULL,
  "wa_user_id" TEXT,
  "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP',
  "channel_identifier" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "message_text" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "error_msg" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pending_messages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP';
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "channel_identifier" TEXT;
ALTER TABLE "messages" ALTER COLUMN "wa_user_id" DROP NOT NULL;
UPDATE "messages" SET "channel_identifier" = COALESCE("channel_identifier", "wa_user_id", 'unknown') WHERE "channel_identifier" IS NULL;
ALTER TABLE "messages" ALTER COLUMN "channel_identifier" SET NOT NULL;

ALTER TABLE "send_logs" ADD COLUMN IF NOT EXISTS "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP';
ALTER TABLE "send_logs" ADD COLUMN IF NOT EXISTS "channel_identifier" TEXT;
ALTER TABLE "send_logs" ALTER COLUMN "wa_user_id" DROP NOT NULL;
UPDATE "send_logs" SET "channel_identifier" = COALESCE("channel_identifier", "wa_user_id", 'unknown') WHERE "channel_identifier" IS NULL;
ALTER TABLE "send_logs" ALTER COLUMN "channel_identifier" SET NOT NULL;

ALTER TABLE "wa_sessions" ADD COLUMN IF NOT EXISTS "wa_support_user_id" TEXT;
ALTER TABLE "wa_sessions" ADD COLUMN IF NOT EXISTS "wa_support_api_key" TEXT;
ALTER TABLE "wa_sessions" ADD COLUMN IF NOT EXISTS "wa_support_session_id" TEXT;
ALTER TABLE "wa_sessions" ADD COLUMN IF NOT EXISTS "webhook_secret" TEXT;

ALTER TABLE "channel_accounts" ADD COLUMN IF NOT EXISTS "enabled_webchat" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "takeover_sessions" ADD COLUMN IF NOT EXISTS "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP';
ALTER TABLE "takeover_sessions" ADD COLUMN IF NOT EXISTS "channel_identifier" TEXT;
ALTER TABLE "takeover_sessions" ADD COLUMN IF NOT EXISTS "enrichment_json" JSONB;
ALTER TABLE "takeover_sessions" ALTER COLUMN "wa_user_id" DROP NOT NULL;
UPDATE "takeover_sessions" SET "channel_identifier" = COALESCE("channel_identifier", "wa_user_id", 'unknown') WHERE "channel_identifier" IS NULL;
ALTER TABLE "takeover_sessions" ALTER COLUMN "channel_identifier" SET NOT NULL;

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP';
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "channel_identifier" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "ai_status" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "ai_error_message" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "pending_message_id" TEXT;
ALTER TABLE "conversations" ALTER COLUMN "wa_user_id" DROP NOT NULL;
UPDATE "conversations" SET "channel_identifier" = COALESCE("channel_identifier", "wa_user_id", 'unknown') WHERE "channel_identifier" IS NULL;
ALTER TABLE "conversations" ALTER COLUMN "channel_identifier" SET NOT NULL;

ALTER TABLE "pending_messages" ADD COLUMN IF NOT EXISTS "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP';
ALTER TABLE "pending_messages" ADD COLUMN IF NOT EXISTS "channel_identifier" TEXT;
ALTER TABLE "pending_messages" ALTER COLUMN "wa_user_id" DROP NOT NULL;
UPDATE "pending_messages" SET "channel_identifier" = COALESCE("channel_identifier", "wa_user_id", 'unknown') WHERE "channel_identifier" IS NULL;
ALTER TABLE "pending_messages" ALTER COLUMN "channel_identifier" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "messages_message_id_key" ON "messages"("message_id");
CREATE INDEX IF NOT EXISTS "messages_village_id_channel_channel_identifier_timestamp_idx" ON "messages"("village_id", "channel", "channel_identifier", "timestamp");
CREATE INDEX IF NOT EXISTS "messages_channel_channel_identifier_idx" ON "messages"("channel", "channel_identifier");
CREATE INDEX IF NOT EXISTS "messages_direction_idx" ON "messages"("direction");
CREATE INDEX IF NOT EXISTS "messages_message_id_idx" ON "messages"("message_id");

CREATE INDEX IF NOT EXISTS "send_logs_village_id_channel_channel_identifier_idx" ON "send_logs"("village_id", "channel", "channel_identifier");
CREATE INDEX IF NOT EXISTS "send_logs_status_idx" ON "send_logs"("status");
CREATE INDEX IF NOT EXISTS "send_logs_timestamp_idx" ON "send_logs"("timestamp");

CREATE UNIQUE INDEX IF NOT EXISTS "wa_sessions_village_id_key" ON "wa_sessions"("village_id");
CREATE UNIQUE INDEX IF NOT EXISTS "wa_sessions_instance_name_key" ON "wa_sessions"("instance_name");
CREATE INDEX IF NOT EXISTS "wa_sessions_admin_id_idx" ON "wa_sessions"("admin_id");
CREATE INDEX IF NOT EXISTS "wa_sessions_village_id_idx" ON "wa_sessions"("village_id");

CREATE UNIQUE INDEX IF NOT EXISTS "channel_accounts_village_id_key" ON "channel_accounts"("village_id");
CREATE INDEX IF NOT EXISTS "channel_accounts_wa_number_idx" ON "channel_accounts"("wa_number");

CREATE INDEX IF NOT EXISTS "takeover_sessions_village_id_channel_channel_identifier_idx" ON "takeover_sessions"("village_id", "channel", "channel_identifier");
CREATE INDEX IF NOT EXISTS "takeover_sessions_admin_id_idx" ON "takeover_sessions"("admin_id");
CREATE INDEX IF NOT EXISTS "takeover_sessions_started_at_idx" ON "takeover_sessions"("started_at");
CREATE INDEX IF NOT EXISTS "takeover_sessions_village_id_channel_channel_identifier_ended_at_idx" ON "takeover_sessions"("village_id", "channel", "channel_identifier", "ended_at");

CREATE UNIQUE INDEX IF NOT EXISTS "conversations_village_id_channel_channel_identifier_key" ON "conversations"("village_id", "channel", "channel_identifier");
CREATE INDEX IF NOT EXISTS "conversations_village_id_idx" ON "conversations"("village_id");
CREATE INDEX IF NOT EXISTS "conversations_is_takeover_idx" ON "conversations"("is_takeover");
CREATE INDEX IF NOT EXISTS "conversations_last_message_at_idx" ON "conversations"("last_message_at");
CREATE INDEX IF NOT EXISTS "conversations_ai_status_idx" ON "conversations"("ai_status");

CREATE UNIQUE INDEX IF NOT EXISTS "pending_messages_message_id_key" ON "pending_messages"("message_id");
CREATE INDEX IF NOT EXISTS "pending_messages_village_id_channel_channel_identifier_status_idx" ON "pending_messages"("village_id", "channel", "channel_identifier", "status");
CREATE INDEX IF NOT EXISTS "pending_messages_status_created_at_idx" ON "pending_messages"("status", "created_at");
