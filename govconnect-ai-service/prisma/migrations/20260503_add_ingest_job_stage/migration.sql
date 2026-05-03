ALTER TABLE ai.embedding_jobs
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payload_json JSONB;

CREATE INDEX IF NOT EXISTS embedding_jobs_stage_idx ON ai.embedding_jobs(stage);
CREATE INDEX IF NOT EXISTS embedding_jobs_next_retry_at_idx ON ai.embedding_jobs(next_retry_at);
