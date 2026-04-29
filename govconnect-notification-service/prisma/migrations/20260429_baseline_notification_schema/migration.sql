-- Baseline existing notification schema for Prisma migrate deploy.
-- Marked applied on existing local database; fresh databases can apply it normally.

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP', 'WEBCHAT');

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP',
    "channel_identifier" TEXT NOT NULL,
    "wa_user_id" TEXT,
    "village_id" TEXT,
    "message_text" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_msg" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_logs_channel_channel_identifier_idx" ON "notification_logs"("channel", "channel_identifier");

-- CreateIndex
CREATE INDEX "notification_logs_wa_user_id_idx" ON "notification_logs"("wa_user_id");

-- CreateIndex
CREATE INDEX "notification_logs_village_id_idx" ON "notification_logs"("village_id");

-- CreateIndex
CREATE INDEX "notification_logs_status_idx" ON "notification_logs"("status");

-- CreateIndex
CREATE INDEX "notification_logs_notification_type_idx" ON "notification_logs"("notification_type");

-- CreateIndex
CREATE INDEX "notification_logs_sent_at_idx" ON "notification_logs"("sent_at");
