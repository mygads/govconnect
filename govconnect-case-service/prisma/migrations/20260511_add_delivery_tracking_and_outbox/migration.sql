-- Delivery-confirmed lifecycle on complaint + service_request.
-- Populated by the notification/channel service callback once the
-- citizen actually received the status-update message. Makes it
-- possible to tell apart "we wrote DONE to DB" from "warga benar-benar
-- tahu laporannya selesai".

ALTER TABLE "complaints"
  ADD COLUMN IF NOT EXISTS "status_notified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "status_delivered_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_delivery_message_id" TEXT;

ALTER TABLE "service_requests"
  ADD COLUMN IF NOT EXISTS "status_notified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "status_delivered_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_delivery_message_id" TEXT;

-- ==================== EVENT OUTBOX ====================
CREATE TABLE IF NOT EXISTS "event_outbox" (
  "id"             TEXT        NOT NULL,
  "routing_key"    TEXT        NOT NULL,
  "payload_json"   JSONB       NOT NULL,
  "correlation_id" TEXT,
  "entity_type"    TEXT,
  "entity_id"      TEXT,
  "status"         TEXT        NOT NULL DEFAULT 'pending',
  "attempt_count"  INTEGER     NOT NULL DEFAULT 0,
  "last_error"     TEXT,
  "next_retry_at"  TIMESTAMP(3),
  "sent_at"        TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "event_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "event_outbox_status_next_retry_idx"
  ON "event_outbox" ("status", "next_retry_at");

CREATE INDEX IF NOT EXISTS "event_outbox_routing_created_idx"
  ON "event_outbox" ("routing_key", "created_at");

CREATE INDEX IF NOT EXISTS "event_outbox_correlation_idx"
  ON "event_outbox" ("correlation_id");
