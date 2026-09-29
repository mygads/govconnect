-- R16: document reminders (H+3, once, idempotent) + broadcast opt-in consent.
--
-- Defensive style: CREATE TABLE IF NOT EXISTS so the migration is re-runnable.
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.

-- One reminder row per (village, ticket, type). The UNIQUE constraint is the
-- idempotency key: concurrent schedules collapse into one row.
CREATE TABLE IF NOT EXISTS pipeline_doc_reminders (
  id              TEXT PRIMARY KEY,
  village_id      TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'whatsapp',
  ticket_ref      TEXT NOT NULL,
  ticket_kind     TEXT NOT NULL DEFAULT 'complaint',
  reminder_type   TEXT NOT NULL DEFAULT 'doc_h3',
  doc_kind        TEXT NOT NULL DEFAULT 'dokumen_pendukung',
  status          TEXT NOT NULL DEFAULT 'pending',
  scheduled_for   TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_doc_reminders_status_chk
    CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  CONSTRAINT pipeline_doc_reminders_uq
    UNIQUE (village_id, ticket_ref, reminder_type)
);

CREATE INDEX IF NOT EXISTS pipeline_doc_reminders_due_idx
  ON pipeline_doc_reminders (status, scheduled_for)
  WHERE status = 'pending';

-- Broadcast consent. Default opt-out: no row, or opt_in=false → never broadcast.
CREATE TABLE IF NOT EXISTS pipeline_broadcast_consents (
  village_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'whatsapp',
  opt_in      BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_broadcast_consents_pk
    PRIMARY KEY (village_id, user_id, channel)
);

CREATE INDEX IF NOT EXISTS pipeline_broadcast_consents_optin_idx
  ON pipeline_broadcast_consents (village_id, channel)
  WHERE opt_in = true;
