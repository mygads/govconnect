-- P1-7: official versioned migration for ai.question_variants.
--
-- History: the table was created by ad-hoc SQL (the 20230101000000 baseline created
-- it in the default schema; 20260503_fix_ai_vector_schema moved public.question_variants
-- to schema ai; 20260504_add_explicit_vector_scope added scope/is_global columns and
-- indexes). This migration consolidates the final expected structure and is fully
-- IDEMPOTENT: safe on DBs where the table already exists in any of its historical
-- forms, and safe to run twice in a row.
--
-- Column set mirrors prisma/schema.prisma `model question_variants` plus every column
-- touched by the code:
--   - question-variant.service.ts: id, source_id, source_type, village_id,
--     scope, is_global, variant_text, embedding, embedding_model, created_at
--   - vector-db.service.ts: qv.source_id, qv.variant_text, qv.source_type,
--     qv.village_id, qv.scope, qv.is_global, qv.embedding (<=> vector distance)

CREATE SCHEMA IF NOT EXISTS ai;

-- pgvector: repo intent is schema ai (see 20260503_fix_ai_vector_schema).
-- If the extension is installed in another schema (e.g. public on fresh installs),
-- move it before anything references ai.vector.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector' AND n.nspname <> 'ai'
  ) THEN
    ALTER EXTENSION vector SET SCHEMA ai;
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA ai;

-- Legacy guard: table may still sit in public if 20260503 never ran against this DB.
DO $$
BEGIN
  IF to_regclass('ai.question_variants') IS NULL AND to_regclass('public.question_variants') IS NOT NULL THEN
    ALTER TABLE public.question_variants SET SCHEMA ai;
  END IF;
END $$;

-- Full table definition (schema.prisma column order).
CREATE TABLE IF NOT EXISTS ai.question_variants (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL,
  source_type     TEXT NOT NULL DEFAULT 'knowledge', -- 'knowledge' | 'document_chunk'
  village_id      TEXT,
  scope           TEXT NOT NULL DEFAULT 'village',   -- 'village' | 'global'
  is_global       BOOLEAN NOT NULL DEFAULT FALSE,
  variant_text    TEXT NOT NULL,
  embedding       ai.vector(768) NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- Repair path: if the table exists from manual SQL with a subset of columns, add the rest.
ALTER TABLE ai.question_variants
  ADD COLUMN IF NOT EXISTS source_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'knowledge',
  ADD COLUMN IF NOT EXISTS village_id TEXT,
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'village',
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS variant_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

-- pgvector column needs its own conditional block (NOT NULL must not break on
-- pre-existing rows that lack the column).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ai' AND table_name = 'question_variants' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE ai.question_variants ADD COLUMN embedding ai.vector(768);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ai.question_variants WHERE embedding IS NULL) THEN
    ALTER TABLE ai.question_variants ALTER COLUMN embedding SET NOT NULL;
  END IF;
END $$;

-- Indexes expected by schema.prisma / query patterns (names kept stable with the
-- baseline so re-runs never create duplicates).
CREATE INDEX IF NOT EXISTS question_variants_source_id_idx
  ON ai.question_variants (source_id);
CREATE INDEX IF NOT EXISTS question_variants_village_id_idx
  ON ai.question_variants (village_id);
CREATE INDEX IF NOT EXISTS question_variants_scope_is_global_idx
  ON ai.question_variants (scope, is_global);
CREATE INDEX IF NOT EXISTS question_variants_village_scope_global_idx
  ON ai.question_variants (village_id, scope, is_global);
