-- R6: canary tokens for leak detection (indirect injection / exfiltration).
--
-- A canary token is a honeytoken planted in a village's KB. It must NEVER
-- appear in a user-facing response or in another village's corpus:
-- - outbound scan: response containing a canary → blocked + audited.
-- - ingest scan: document containing another village's canary → rejected.
--
-- Defensive style: CREATE TABLE IF NOT EXISTS so the migration is re-runnable.
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.

CREATE TABLE IF NOT EXISTS ai.canary_tokens (
  id          TEXT PRIMARY KEY,
  village_id  TEXT NOT NULL,
  token       TEXT NOT NULL,
  label       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT canary_tokens_format CHECK (token ~ '^cnry_[a-z0-9]{20}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS canary_tokens_token_uidx
  ON ai.canary_tokens (token);
CREATE INDEX IF NOT EXISTS canary_tokens_village_idx
  ON ai.canary_tokens (village_id);
