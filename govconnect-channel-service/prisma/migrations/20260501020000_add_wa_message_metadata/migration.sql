ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "wa_chat_jid" TEXT,
  ADD COLUMN IF NOT EXISTS "wa_sender_jid" TEXT,
  ADD COLUMN IF NOT EXISTS "wa_sender_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "wa_chat_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "wa_message_type" TEXT,
  ADD COLUMN IF NOT EXISTS "wa_context_info" JSONB,
  ADD COLUMN IF NOT EXISTS "wa_raw_info" JSONB,
  ADD COLUMN IF NOT EXISTS "wa_raw_message" JSONB,
  ADD COLUMN IF NOT EXISTS "quoted_message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "quoted_stanza_id" TEXT,
  ADD COLUMN IF NOT EXISTS "quoted_participant" TEXT,
  ADD COLUMN IF NOT EXISTS "quoted_text" TEXT,
  ADD COLUMN IF NOT EXISTS "quoted_message_json" JSONB,
  ADD COLUMN IF NOT EXISTS "message_kind" TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS "location_latitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "location_longitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "location_name" TEXT,
  ADD COLUMN IF NOT EXISTS "location_address" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_name" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_vcard" TEXT,
  ADD COLUMN IF NOT EXISTS "interactive_payload" JSONB;

CREATE INDEX IF NOT EXISTS "messages_village_id_channel_channel_identifier_message_kind_idx"
  ON "messages"("village_id", "channel", "channel_identifier", "message_kind");

CREATE INDEX IF NOT EXISTS "messages_village_id_channel_channel_identifier_quoted_message_id_idx"
  ON "messages"("village_id", "channel", "channel_identifier", "quoted_message_id");
