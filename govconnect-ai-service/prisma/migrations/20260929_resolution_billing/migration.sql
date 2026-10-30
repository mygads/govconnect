-- R9 / §10: per-resolution billing + cost anomaly alerts.
--
-- arsitektur-final §10 mandates: "Wallet: tagih per resolusi terverifikasi —
-- selaras insentif." Previously the wallet was debited per message/turn
-- (reference_type 'ai_message_billing'). From here on, turn finalization only
-- ACCRUES cost (ai_message_billings.status = 'accrued'); the wallet is
-- debited once per verified resolution (reference_type 'ai_resolution')
-- via ai.ai_resolutions. Unresolved turns are never debited: the vendor
-- absorbs that cost, which is exactly the incentive alignment §10 wants
-- (the vendor is paid when value is delivered, not per message).
--
-- "Verified" follows §12's evidence hierarchy: deterministic evidence
-- (DB outcome, tool traces, ticket refs) — never an LLM self-claim.
--
-- ai_cost_anomaly_alerts implements the missing R9 sub-item: spike
-- detection (>3x 7-day baseline, abnormal single turn). Alert-only by
-- design: pausing is an explicit human action via VILLAGE_KILL_SWITCH
-- (see pipeline/kill-switch.ts); the alert payload carries the
-- recommended action.
--
-- Defensive style: CREATE TABLE IF NOT EXISTS so the migration is re-runnable.
-- NOTE: apply with `pnpm db:migrate:deploy` on a host with a live database.

CREATE TABLE IF NOT EXISTS ai.ai_resolutions (
  id                      TEXT PRIMARY KEY,
  village_id              TEXT NOT NULL,
  wa_user_id              TEXT,
  session_id              TEXT,
  channel                 TEXT,
  trace_id                TEXT NOT NULL,
  resolution_type         TEXT NOT NULL,              -- complaint_created | service_request_created | info_answered | status_delivered | handoff_completed | other
  resolution_key          TEXT NOT NULL,              -- idempotency: village_id:type:evidence_ref
  verified                BOOLEAN NOT NULL DEFAULT TRUE,
  verification_evidence_json JSONB,                    -- deterministic evidence: tool names, ticket refs, DB row ids
  billing_group_ids       TEXT[] NOT NULL DEFAULT '{}', -- contributing turns (ai_message_billings.billing_group_id)
  total_actual_cost_usd   DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_adjusted_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_margin_usd        DOUBLE PRECISION NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'pending', -- pending | billed | failed | failed_insufficient_balance | skipped_no_village
  ledger_entry_id         TEXT UNIQUE,
  billed_at               TIMESTAMPTZ,
  error_message           TEXT,
  metadata_json           JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_resolutions_village_key_uidx UNIQUE (village_id, resolution_key)
);

CREATE INDEX IF NOT EXISTS ai_resolutions_village_created_idx
  ON ai.ai_resolutions (village_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_resolutions_status_created_idx
  ON ai.ai_resolutions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_resolutions_trace_idx
  ON ai.ai_resolutions (trace_id);

CREATE TABLE IF NOT EXISTS ai.ai_cost_anomaly_alerts (
  id              TEXT PRIMARY KEY,
  village_id      TEXT NOT NULL,
  alert_type      TEXT NOT NULL,              -- daily_spend_spike | turn_cost_spike
  severity        TEXT NOT NULL,              -- warning | critical
  details_json    JSONB NOT NULL,             -- numbers: today_usd, avg7d_usd, ratio, threshold, recommended_action
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT
);

CREATE INDEX IF NOT EXISTS ai_cost_anomaly_alerts_village_created_idx
  ON ai.ai_cost_anomaly_alerts (village_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_cost_anomaly_alerts_type_created_idx
  ON ai.ai_cost_anomaly_alerts (alert_type, created_at DESC);
