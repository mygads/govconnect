-- Identity ladder L0–L2: admin-recorded identity verifications.
-- L0 = anonymous (public info only). L1 = channel-authenticated WA sender.
-- L2 = identity verified by village staff (offline KTP check), recorded here.
-- There is deliberately NO online Dukcapil API verification; verification is
-- an administrative act by perangkat desa.

CREATE TABLE IF NOT EXISTS pipeline_identity_verifications (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'L2',
  verified_by TEXT NOT NULL DEFAULT '',
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active verification per (tenant, user).
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_identity_verifications_active_uniq
  ON pipeline_identity_verifications (tenant_id, user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS pipeline_identity_verifications_tenant_idx
  ON pipeline_identity_verifications (tenant_id);
