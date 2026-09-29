-- W4: Takeover state machine ber-TTL
-- AI_ACTIVE → HANDOFF_PENDING → HUMAN_ACTIVE → NUDGE → auto-handback
--
-- Kolom baru:
--   state: status state machine saat ini
--   last_human_activity_at: kapan manusia terakhir aktif (untuk deteksi NUDGE)
--   nudge_sent_at: kapan nudge dikirim (untuk timing auto-handback)

ALTER TABLE pipeline_takeovers
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'HUMAN_ACTIVE',
  ADD COLUMN IF NOT EXISTS last_human_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nudge_sent_at TIMESTAMPTZ;

-- Backfill: row yang ada dianggap HUMAN_ACTIVE dengan activity = taken_at
UPDATE pipeline_takeovers
SET last_human_activity_at = taken_at
WHERE last_human_activity_at IS NULL;

-- Constraint: state harus salah satu dari 4 nilai valid
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_takeovers_state_check'
  ) THEN
    ALTER TABLE pipeline_takeovers
      ADD CONSTRAINT pipeline_takeovers_state_check
      CHECK (state IN ('HANDOFF_PENDING', 'HUMAN_ACTIVE', 'NUDGE', 'AI_ACTIVE'));
  END IF;
END $$;

-- Index untuk query expiry/nudge yang efisien
CREATE INDEX IF NOT EXISTS idx_takeovers_state_expires
  ON pipeline_takeovers (state, expires_at)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_takeovers_nudge
  ON pipeline_takeovers (state, last_human_activity_at)
  WHERE released_at IS NULL AND state = 'HUMAN_ACTIVE';
