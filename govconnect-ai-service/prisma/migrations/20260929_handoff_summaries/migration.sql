-- A1: handoff summaries — auto-generated context when AI hands a conversation
-- to a human (takeover). Lets village staff understand the situation without
-- reading the whole chat.
--
-- Defensive style: CREATE TABLE IF NOT EXISTS so the migration is re-runnable.
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.

CREATE TABLE IF NOT EXISTS pipeline_handoff_summaries (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'whatsapp',
  taken_by      TEXT NOT NULL DEFAULT '',
  reason        TEXT NOT NULL DEFAULT '',
  summary_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_text  TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_handoff_summaries_lookup_idx
  ON pipeline_handoff_summaries (tenant_id, user_id, created_at DESC);
