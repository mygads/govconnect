-- W15: DB-backed media intake registry for SHA-256/pHash dedup.
-- Dedup rule: same (village_id, user_id, sha256) within 24h => duplicate.
-- Survives process restarts and works across replicas (in-process Maps are L1 only).

CREATE TABLE IF NOT EXISTS ai.media_registry (
  id            TEXT PRIMARY KEY,
  village_id    TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  phash         TEXT,
  message_id    TEXT,
  media_kind    TEXT NOT NULL DEFAULT 'unknown', -- 'photo' | 'document' | 'unknown'
  bytes         BIGINT,
  exif_stripped BOOLEAN NOT NULL DEFAULT FALSE,
  redaction     TEXT NOT NULL DEFAULT 'degraded', -- 'done' | 'degraded' | 'not_applicable'
  admin_only    BOOLEAN NOT NULL DEFAULT FALSE,   -- KTP/identity docs: admin eyes only
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_registry_dedup_idx
  ON ai.media_registry (village_id, user_id, sha256, created_at DESC);

CREATE INDEX IF NOT EXISTS media_registry_phash_idx
  ON ai.media_registry (village_id, user_id, phash)
  WHERE phash IS NOT NULL;
