-- Broadcast drafts: 2-step approval (drafter != approver) before send.
CREATE TABLE IF NOT EXISTS broadcast_drafts (
  id          TEXT PRIMARY KEY,
  village_id  TEXT NOT NULL,
  message     TEXT NOT NULL,
  recipients  TEXT[] NOT NULL DEFAULT '{}',
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL DEFAULT 'draft',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  reject_note TEXT,
  sent_at     TIMESTAMPTZ,
  send_result JSONB
);

CREATE INDEX IF NOT EXISTS broadcast_drafts_village_status_idx
  ON broadcast_drafts (village_id, status);
CREATE INDEX IF NOT EXISTS broadcast_drafts_village_created_idx
  ON broadcast_drafts (village_id, created_at DESC);
