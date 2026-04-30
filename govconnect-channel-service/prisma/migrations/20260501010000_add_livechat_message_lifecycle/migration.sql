ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "delivery_status" TEXT,
  ADD COLUMN IF NOT EXISTS "sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "status_error" TEXT,
  ADD COLUMN IF NOT EXISTS "admin_read_at" TIMESTAMP(3);

UPDATE "messages"
SET "delivery_status" = CASE
  WHEN "direction" = 'IN' THEN 'received'
  WHEN "direction" = 'OUT' THEN 'sent'
  ELSE "delivery_status"
END
WHERE "delivery_status" IS NULL;

CREATE INDEX IF NOT EXISTS "messages_village_id_channel_channel_identifier_delivery_status_idx"
  ON "messages"("village_id", "channel", "channel_identifier", "delivery_status");
