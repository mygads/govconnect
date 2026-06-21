-- CreateTable
CREATE TABLE IF NOT EXISTS "held_messages" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "wa_user_id" TEXT,
    "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP',
    "channel_identifier" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "has_media" BOOLEAN NOT NULL DEFAULT false,
    "media_type" TEXT,
    "media_url" TEXT,
    "media_public_url" TEXT,
    "media_caption" TEXT,
    "media_mime_type" TEXT,
    "media_file_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'held',
    "reason" TEXT NOT NULL DEFAULT 'wallet_exhausted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "held_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "held_messages_message_id_key" ON "held_messages"("message_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "held_messages_village_id_status_created_at_idx" ON "held_messages"("village_id", "status", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "held_messages_village_id_channel_channel_identifier_status_idx" ON "held_messages"("village_id", "channel", "channel_identifier", "status");
