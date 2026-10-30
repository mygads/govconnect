-- A2: village glossary — local terms (Javanese/Sundanese/dialect) mapped to
-- standard Indonesian, normalized BEFORE intent/slot extraction so the
-- deterministic pipeline understands citizens who write in local terms.
--
-- Defensive style: CREATE TABLE IF NOT EXISTS so the migration is re-runnable.
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.
-- Example seeds: prisma/seeds/village-glossary-seed.sql (optional).

CREATE TABLE IF NOT EXISTS pipeline_village_glossaries (
  id            TEXT PRIMARY KEY,
  village_id    TEXT NOT NULL,
  istilah       TEXT NOT NULL,
  bentuk_baku   TEXT NOT NULL,
  contoh        TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_village_glossaries_uq UNIQUE (village_id, istilah)
);

CREATE INDEX IF NOT EXISTS pipeline_village_glossaries_village_idx
  ON pipeline_village_glossaries (village_id);
