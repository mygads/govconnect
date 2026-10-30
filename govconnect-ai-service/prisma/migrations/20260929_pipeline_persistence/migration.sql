-- Pipeline v2 persistence tables (staged agent).
-- Defensive style: CREATE TABLE IF NOT EXISTS so the migration is re-runnable.
-- All tables are tenant-scoped (tenant_id) for the village -> generic tenant direction.
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.

-- ── 1. Immutable audit trail (append-only) ──────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_audit_events (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id     TEXT NOT NULL,
  trace_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'whatsapp',
  stage         TEXT NOT NULL,
  event         TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS pipeline_audit_events_tenant_trace_idx
  ON pipeline_audit_events (tenant_id, trace_id);
CREATE INDEX IF NOT EXISTS pipeline_audit_events_occurred_idx
  ON pipeline_audit_events (occurred_at);

-- Enforce append-only: reject UPDATE/DELETE at the database level.
CREATE OR REPLACE FUNCTION pipeline_audit_reject_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'pipeline_audit_events is append-only';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pipeline_audit_events_no_mutate') THEN
    CREATE TRIGGER pipeline_audit_events_no_mutate
      BEFORE UPDATE OR DELETE ON pipeline_audit_events
      FOR EACH ROW EXECUTE FUNCTION pipeline_audit_reject_mutation();
  END IF;
END $$;

-- ── 2. Idempotency keys ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_idempotency_keys (
  tenant_id   TEXT NOT NULL,
  idem_key    TEXT NOT NULL,
  response    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, idem_key)
);
CREATE INDEX IF NOT EXISTS pipeline_idempotency_keys_expires_idx
  ON pipeline_idempotency_keys (expires_at);

-- ── 3. Turn/stage state per conversation (TTL) ───────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_turn_states (
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'whatsapp',
  stage       TEXT NOT NULL,
  slots       JSONB NOT NULL DEFAULT '{}'::jsonb,
  assessor_confidences JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, user_id, channel)
);

-- ── 4. Admin takeover sessions (TTL) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_takeovers (
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'whatsapp',
  taken_by    TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  taken_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, user_id, channel)
);

-- ── 5. NIK vault (token -> ciphertext, NEVER plaintext NIK) ──────────────
CREATE TABLE IF NOT EXISTS pipeline_nik_vault (
  token       TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS pipeline_nik_vault_expires_idx
  ON pipeline_nik_vault (expires_at);

-- ── 6. Fallback tickets (never-silent persistence) ───────────────────────
CREATE TABLE IF NOT EXISTS pipeline_fallback_tickets (
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
  ON pipeline_fallback_tickets (tenant_id, status);

-- ── 7. Semantic cache (factual, non-personal answers only) ───────────────
CREATE TABLE IF NOT EXISTS pipeline_semantic_cache (
  cache_key   TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc_version TEXT NOT NULL DEFAULT '',
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS pipeline_semantic_cache_tenant_idx
  ON pipeline_semantic_cache (tenant_id, doc_version);

-- ── 8. Improvement proposals (human-in-the-loop) ─────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_improvement_proposals (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'proposed',
  decided_by  TEXT,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_improvement_proposals_status_idx
  ON pipeline_improvement_proposals (tenant_id, status);

-- ── 9. LAPOR! outbox ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_lapor_outbox (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  complaint_ref TEXT NOT NULL,
  payload       JSONB NOT NULL,
  tracking_id   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_lapor_outbox_status_idx
  ON pipeline_lapor_outbox (status);

-- ── 10. Ingress quarantine ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_ingress_quarantine (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'whatsapp',
  reason      TEXT NOT NULL,
  excerpt     TEXT NOT NULL DEFAULT '',
  reviewed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
