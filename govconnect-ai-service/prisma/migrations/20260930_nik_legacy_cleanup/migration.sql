-- One-time cleanup of legacy plaintext NIK in pipeline_ktp_verifications.
--
-- Background: before the NIK vault (2026-09-29), approved verifications stored
-- the NIK in cleartext inside the `fields` JSONB column (`fields->>'nik'`).
-- Since the vault change, only `fields->>'nik_token'` (vault token) is written.
--
-- Safety rule (per task spec): null out the plaintext ONLY where the NIK is
-- already protected in the vault, i.e. an unexpired vault token exists for the
-- same (village_id, user_id) scope. Scope-level guarantee: the scope's
-- currently-verified NIK lives in the vault, so the historical cleartext copy
-- is redundant. Rows without a valid vault token are LEFT UNTOUCHED so no
-- verified identity data is ever destroyed.
--
-- Uses the `-` JSONB operator to remove just the 'nik' key, preserving the
-- rest of `fields` (nama, alamat, nik_token, ...).
--
-- Idempotent: re-running only affects rows that still have fields->>'nik'.

UPDATE pipeline_ktp_verifications k
SET fields = k.fields - 'nik'
WHERE k.fields ? 'nik'
  AND EXISTS (
    SELECT 1
    FROM pipeline_nik_vault v
    WHERE v.tenant_id = k.village_id || ':' || k.user_id
      AND v.expires_at > now()
  );
