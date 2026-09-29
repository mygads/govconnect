-- R10: OTP binding + NIK binding untuk verifikasi identitas L1/L2.
--
-- Arsitektur-final §6: L1 = binding (wa_number, village_id, NIK) via OTP.
-- NIK TIDAK PERNAH disimpan plaintext — hanya token dari PII vault
-- (keputusan NIK vault 29 Sep 2026, UU PDP).
--
-- OTP codes: one-time, hashed, short-lived (5 menit), max 3 percobaan.
-- NIK bindings: satu binding aktif per (tenant, wa_number).

CREATE TABLE IF NOT EXISTS pipeline_otp_codes (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  wa_number   TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'nik_binding',
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_otp_codes_lookup_idx
  ON pipeline_otp_codes (tenant_id, wa_number, purpose, created_at DESC);

-- Hapus kode kedaluwarsa secara berkala (opsional cron).
CREATE INDEX IF NOT EXISTS pipeline_otp_codes_expiry_idx
  ON pipeline_otp_codes (expires_at);

CREATE TABLE IF NOT EXISTS pipeline_nik_bindings (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  wa_number   TEXT NOT NULL,
  -- Token NIK dari PII vault (vaultStoreNik). Plaintext NIK tidak disimpan.
  nik_token   TEXT NOT NULL,
  method      TEXT NOT NULL DEFAULT 'otp',
  verified_by TEXT NOT NULL DEFAULT '',
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Satu binding aktif per (tenant, wa_number).
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_nik_bindings_active_uniq
  ON pipeline_nik_bindings (tenant_id, wa_number)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS pipeline_nik_bindings_tenant_idx
  ON pipeline_nik_bindings (tenant_id);
