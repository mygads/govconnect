-- R5: improvement loop — KB proposal store (knowledge suggester).
--
-- AI proposes, human approves (P14). Proposals are reviewable drafts;
-- NOTHING goes live automatically. Approval only flips status; a separate
-- explicit publish step moves content into the KB. There is deliberately
-- no "auto-promote" path in this schema or in code.
--
-- Defensive style: CREATE TABLE IF NOT EXISTS so the migration is re-runnable.
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.

CREATE TABLE IF NOT EXISTS ai.kb_proposals (
  id            TEXT PRIMARY KEY,
  village_id    TEXT NOT NULL,
  type          TEXT NOT NULL,              -- content_gap | data_gap | action_gap
  title         TEXT NOT NULL,
  draft         TEXT NOT NULL,              -- human-readable proposal body (full draft / diff description)
  dedupe_key    TEXT NOT NULL,              -- stable key so the suggester never double-proposes
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | published | withdrawn
  source        JSONB NOT NULL DEFAULT '{}'::jsonb, -- mining signals: counts, sample trace_ids, window
  created_by    TEXT NOT NULL DEFAULT 'suggester',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  CONSTRAINT kb_proposals_type_check
    CHECK (type IN ('content_gap', 'data_gap', 'action_gap')),
  CONSTRAINT kb_proposals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'published', 'withdrawn'))
);

CREATE INDEX IF NOT EXISTS kb_proposals_village_status_idx
  ON ai.kb_proposals (village_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS kb_proposals_dedupe_uidx
  ON ai.kb_proposals (village_id, dedupe_key)
  WHERE status IN ('pending', 'approved');
