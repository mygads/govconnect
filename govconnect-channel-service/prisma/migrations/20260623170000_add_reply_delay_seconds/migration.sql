-- AlterTable
ALTER TABLE "channel_accounts" ADD COLUMN IF NOT EXISTS "reply_delay_seconds" INTEGER NOT NULL DEFAULT 0;
