-- Fix: pipeline_fallback_tickets was created in public schema by 20260929_pipeline_persistence,
-- but Prisma model expects it in ai schema (@@schema("ai")).
-- Move the table to ai schema if it exists in public, otherwise create it in ai.

DO $$
BEGIN
  -- If table exists in public schema, move it to ai schema
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pipeline_fallback_tickets') THEN
    ALTER TABLE public.pipeline_fallback_tickets SET SCHEMA ai;
  END IF;
END $$;

-- Ensure table exists in ai schema (idempotent)
CREATE TABLE IF NOT EXISTS ai.pipeline_fallback_tickets (
  ticket_id   TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'whatsapp',
  stage       TEXT NOT NULL,
  reason      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_fallback_tickets_tenant_status_idx
  ON ai.pipeline_fallback_tickets (tenant_id, status);
