-- Manual KTP verification by village staff (admin).
-- OCR automation is PARKED (user decision 2026-09-29): the pipeline never
-- calls the OCR sidecar automatically; verification is a human act.
--
-- Photo bytes are stored ONLY until the review decision, then wiped
-- (photo_bytes set to NULL) per UU PDP data-minimization/retention.
-- Metadata stays for the audit trail.
--
-- Defensive style: CREATE TABLE IF NOT EXISTS so the migration is re-runnable.
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.

CREATE TABLE IF NOT EXISTS pipeline_ktp_verifications (
  id            TEXT PRIMARY KEY,
  village_id    TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'whatsapp',
  status        TEXT NOT NULL DEFAULT 'pending',
  photo_bytes   BYTEA,
  photo_sha256  TEXT NOT NULL DEFAULT '',
  photo_mime    TEXT NOT NULL DEFAULT 'image/jpeg',
  fields        JSONB NOT NULL DEFAULT '{}',
  reviewed_by   TEXT NOT NULL DEFAULT '',
  reviewed_at   TIMESTAMPTZ,
  reject_reason TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_ktp_verifications_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS pipeline_ktp_verifications_queue_idx
  ON pipeline_ktp_verifications (village_id, status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS pipeline_ktp_verifications_user_idx
  ON pipeline_ktp_verifications (village_id, user_id, created_at DESC);
