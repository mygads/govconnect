-- R12: CSAT surveys after resolved/closed tickets.
--
-- One question, 1-5 scale, sent after the DONE notification is delivered.
-- Rating <= 2 creates a follow-up ticket for the admin (closed loop).
-- Defensive style: CREATE TABLE IF NOT EXISTS so the migration is re-runnable.
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.

CREATE TABLE IF NOT EXISTS ai.csat_surveys (
  id                 TEXT PRIMARY KEY,
  village_id         TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  channel            TEXT NOT NULL DEFAULT 'whatsapp',
  complaint_id       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'sent'
                     CONSTRAINT csat_surveys_status_chk
                     CHECK (status IN ('sent','answered','expired','failed','skipped')),
  rating             SMALLINT
                     CONSTRAINT csat_surveys_rating_chk
                     CHECK (rating BETWEEN 1 AND 5),
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at        TIMESTAMPTZ,
  follow_up_ticket_id TEXT
);

-- One pending survey per complaint (a resolved ticket is surveyed once).
CREATE UNIQUE INDEX IF NOT EXISTS csat_surveys_pending_uq
  ON ai.csat_surveys (village_id, complaint_id)
  WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS csat_surveys_user_idx
  ON ai.csat_surveys (village_id, user_id, status, sent_at DESC);
