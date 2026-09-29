-- R4: village-scoped SKILL.md store (Agent Skills, progressive disclosure).
--
-- Level 1 (index: slug/title/description) is injected into the prompt;
-- Level 2 (full content_md) is loaded on demand via the load_skill tool.
-- Skills are built INACTIVE and require explicit human activation —
-- no auto-promote, consistent with P14.
--
-- Defensive style: CREATE TABLE IF NOT EXISTS so the migration is re-runnable.
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.

CREATE TABLE IF NOT EXISTS ai.village_skills (
  id                 TEXT PRIMARY KEY,
  village_id         TEXT NOT NULL,
  slug               TEXT NOT NULL,              -- e.g. 'sktm'
  title              TEXT NOT NULL,
  description        TEXT NOT NULL,              -- one-liner shown in the prompt index (L1)
  triggers           JSONB NOT NULL DEFAULT '[]'::jsonb, -- keywords hinting this skill
  content_md         TEXT NOT NULL,              -- full SKILL.md body (L2)
  source_document_id TEXT,                       -- R3-routed document this was built from
  version            INT NOT NULL DEFAULT 1,
  is_active          BOOLEAN NOT NULL DEFAULT FALSE,
  created_by         TEXT NOT NULL DEFAULT 'admin',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT village_skills_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS village_skills_village_slug_uidx
  ON ai.village_skills (village_id, slug);
CREATE INDEX IF NOT EXISTS village_skills_village_active_idx
  ON ai.village_skills (village_id, is_active);
