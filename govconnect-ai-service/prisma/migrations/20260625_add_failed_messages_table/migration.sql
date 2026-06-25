-- Failed messages table.
--
-- Persists messages that failed AI processing (LLM timeout, rate limit,
-- server error) so they survive redeploy/maintenance. Admin can reprocess
-- via dashboard "Pesan Gagal" page or /admin/failed-messages/retry-all.
--
-- Replaces the in-memory retry queue for durable persistence; the in-memory
-- queue remains as a fast-access cache during active retries.

CREATE TABLE IF NOT EXISTS ai."failed_messages" (
  "id"               TEXT         NOT NULL,
  "village_id"       TEXT,
  "wa_user_id"       TEXT,
  "session_id"       TEXT,
  "channel"          TEXT,
  "original_message" TEXT,
  "message_id"       TEXT,
  "attempts"         INTEGER      NOT NULL DEFAULT 0,
  "max_attempts"     INTEGER      NOT NULL DEFAULT 10,
  "status"           TEXT         NOT NULL DEFAULT 'pending',
  "last_error"       TEXT,
  "first_attempt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_attempt"     TIMESTAMP(3) NOT NULL,
  "resolved_at"      TIMESTAMP(3),

  CONSTRAINT "failed_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "failed_messages_village_status_idx"
  ON ai."failed_messages" (village_id, status);

CREATE INDEX IF NOT EXISTS "failed_messages_status_idx"
  ON ai."failed_messages" (status);
