-- R13: experiment framework (bucketing deterministik, ramp, gate, kill-switch).
--
-- Defensive style: CREATE TABLE IF NOT EXISTS so the migration is re-runnable.
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.

-- One experiment per row. v1 allows a single ACTIVE ('ramping') experiment
-- per village; the service layer enforces it.
CREATE TABLE IF NOT EXISTS ai.experiments (
  id          TEXT PRIMARY KEY,
  village_id  TEXT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft'
              CONSTRAINT experiments_status_chk
              CHECK (status IN ('draft','ramping','paused','completed','killed')),
  created_by  TEXT NOT NULL DEFAULT 'system',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiments_village_status_idx
  ON ai.experiments (village_id, status);

-- Variants are IMMUTABLE once the experiment leaves 'draft': the service
-- rejects variant writes for non-draft experiments (the `production`
-- pointer always references an immutable version).
CREATE TABLE IF NOT EXISTS ai.experiment_variants (
  id            TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES ai.experiments (id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  is_control    BOOLEAN NOT NULL DEFAULT false,
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT experiment_variants_key_uq UNIQUE (experiment_id, key)
);
CREATE INDEX IF NOT EXISTS experiment_variants_exp_idx
  ON ai.experiment_variants (experiment_id);

-- Ramp history: 1 → 5 → 25 → 100 with gate verdicts. Append-only.
CREATE TABLE IF NOT EXISTS ai.experiment_ramps (
  id            TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES ai.experiments (id) ON DELETE CASCADE,
  pct           INTEGER NOT NULL CONSTRAINT experiment_ramps_pct_chk
                CHECK (pct IN (1, 5, 25, 100)),
  gate_verdict  TEXT,
  gate_detail   JSONB,
  decided_by    TEXT NOT NULL DEFAULT 'system',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiment_ramps_exp_idx
  ON ai.experiment_ramps (experiment_id, created_at DESC);
