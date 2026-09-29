#!/usr/bin/env bash
# R15 — Provisioning tenant baru (desa) untuk GovConnect.
#
# Membuat, secara IDEMPOTENT (aman dijalankan ulang):
#   1. villages (dashboard DB)
#   2. village_behavior_configs dengan default aman (dashboard DB)
#      - PIPELINE_MODE=shadow (WAJIB mulai dari shadow, bukan on — playbook Fase 1)
#      - ai_identity_disclosure=true (default transparan)
#   3. channel_accounts (channel DB) — WA disabled default, webchat enabled
#   4. complaint_categories + complaint_types default (case DB)
#   5. ai_village_wallets dengan saldo awal (ai DB)
#
# Usage:
#   ./scripts/provision-tenant.sh --village-id desa-sukamaju \
#     --name "Desa Sukamaju" --wa-number 6281234567890 \
#     [--timezone Asia/Jakarta] [--initial-balance 10]
#
# Env yang dibutuhkan: PGHOST, PGPORT, PGUSER, PGPASSWORD
# (default: 127.0.0.1:5432, govconnect / dbgovconnect2026)
set -euo pipefail

VILLAGE_ID=""
VILLAGE_NAME=""
WA_NUMBER=""
TIMEZONE="Asia/Jakarta"
INITIAL_BALANCE="10"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --village-id) VILLAGE_ID="$2"; shift 2;;
    --name) VILLAGE_NAME="$2"; shift 2;;
    --wa-number) WA_NUMBER="$2"; shift 2;;
    --timezone) TIMEZONE="$2"; shift 2;;
    --initial-balance) INITIAL_BALANCE="$2"; shift 2;;
    *) echo "Argumen tidak dikenal: $1" >&2; exit 1;;
  esac
done

if [[ -z "$VILLAGE_ID" || -z "$VILLAGE_NAME" ]]; then
  echo "Usage: $0 --village-id <slug> --name <nama> [--wa-number <628..>] [--timezone Asia/Jakarta] [--initial-balance 10]" >&2
  exit 1
fi

# Validasi slug.
if ! [[ "$VILLAGE_ID" =~ ^[a-z0-9-]{3,64}$ ]]; then
  echo "village-id harus slug lowercase [a-z0-9-], 3-64 karakter" >&2
  exit 1
fi

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-govconnect}"
export PGPASSWORD="${PGPASSWORD:-dbgovconnect2026}"

SLUG_UNDERSCORE="${VILLAGE_ID//-/_}"

echo "==> Provisioning tenant: $VILLAGE_ID ($VILLAGE_NAME)"

# ── 1+2. Dashboard DB: villages + behavior config ──────────────────────────
echo "--- dashboard DB: villages + behavior config"
psql -d govconnect_dashboard -v ON_ERROR_STOP=1 <<SQL
INSERT INTO villages (id, name, slug, timezone, is_active, created_at, updated_at)
VALUES ('$VILLAGE_ID', '$VILLAGE_NAME', '$VILLAGE_ID', '$TIMEZONE', true, now(), now())
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, updated_at=now();

-- Default aman per playbook Fase 1: mulai dari shadow, disclosure transparan.
INSERT INTO village_behavior_configs
  (id, village_id, ai_identity_disclosure, ai_persona_name, ai_persona_description, created_at, updated_at)
VALUES
  ('cfg-${SLUG_UNDERSCORE}', '$VILLAGE_ID', true, 'Gana', 'Asisten AI resmi $VILLAGE_NAME', now(), now())
ON CONFLICT (village_id) DO NOTHING;
SQL

# ── 3. Channel DB: channel account ─────────────────────────────────────────
echo "--- channel DB: channel account"
# wa_token placeholder — WAJIB diganti dengan token asli dari provider WA.
WA_TOKEN_PLACEHOLDER="REPLACE_WITH_REAL_WA_TOKEN"
if [[ -n "$WA_NUMBER" ]]; then
  psql -d govconnect_channel -v ON_ERROR_STOP=1 <<SQL
INSERT INTO channel_accounts
  (id, village_id, wa_number, wa_token, webhook_url, enabled_wa, enabled_webchat, created_at, updated_at)
VALUES
  ('ca_${SLUG_UNDERSCORE}', '$VILLAGE_ID', '$WA_NUMBER', '$WA_TOKEN_PLACEHOLDER', '', false, true, now(), now())
ON CONFLICT (id) DO NOTHING;
SQL
  echo "    WA dinonaktifkan default (enabled_wa=false); aktifkan setelah verifikasi webhook (playbook Fase 1.4)."
  echo "    PERHATIAN: wa_token masih placeholder — ganti dengan token asli provider WA."
else
  echo "    (wa-number tidak diberikan — channel account dilewati)"
fi

# ── 4. Case DB: kategori + tipe pengaduan default ───────────────────────────
echo "--- case DB: complaint categories + types"
psql -d govconnect_case -v ON_ERROR_STOP=1 <<SQL
INSERT INTO cases.complaint_categories (id, village_id, name, name_key, is_active, created_at, updated_at)
VALUES
  ('cat-infra-${SLUG_UNDERSCORE}', '$VILLAGE_ID', 'Infrastruktur', 'infrastruktur', true, now(), now()),
  ('cat-admin-${SLUG_UNDERSCORE}', '$VILLAGE_ID', 'Administrasi', 'administrasi', true, now(), now()),
  ('cat-sosial-${SLUG_UNDERSCORE}', '$VILLAGE_ID', 'Sosial', 'sosial', true, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO cases.complaint_types
  (id, category_id, name, name_key, description, is_urgent, require_address, send_important_contacts, created_at, updated_at)
VALUES
  ('type-jalan-${SLUG_UNDERSCORE}', 'cat-infra-${SLUG_UNDERSCORE}', 'Jalan Rusak', 'jalan_rusak',
   'Jalan berlubang, rusak, atau tidak layak', false, true, false, now(), now()),
  ('type-lampu-${SLUG_UNDERSCORE}', 'cat-infra-${SLUG_UNDERSCORE}', 'Lampu Jalan Mati', 'lampu_jalan_mati',
   'Penerangan jalan umum tidak berfungsi', false, true, false, now(), now()),
  ('type-sampah-${SLUG_UNDERSCORE}', 'cat-infra-${SLUG_UNDERSCORE}', 'Sampah Menumpuk', 'sampah_menumpuk',
   'Sampah tidak diangkut atau menumpuk', false, true, false, now(), now()),
  ('type-bansos-${SLUG_UNDERSCORE}', 'cat-sosial-${SLUG_UNDERSCORE}', 'Bansos', 'bansos',
   'Bantuan sosial / BLT', false, false, false, now(), now())
ON CONFLICT (id) DO NOTHING;
SQL

# ── 5. AI DB: wallet awal ──────────────────────────────────────────────────
echo "--- ai DB: village wallet"
psql -d govconnect -v ON_ERROR_STOP=1 <<SQL
INSERT INTO ai.ai_village_wallets
  (id, village_id, balance_usd, warning_threshold_usd, status, last_topup_at, created_at, updated_at)
VALUES
  ('wallet-${SLUG_UNDERSCORE}', '$VILLAGE_ID', $INITIAL_BALANCE, 2, 'active', now(), now(), now())
ON CONFLICT (village_id) DO NOTHING;
SQL

echo ""
echo "==> Selesai. Ringkasan:"
echo "    village_id      : $VILLAGE_ID"
echo "    PIPELINE_MODE   : shadow (ubah ke 'on' setelah playbook Fase 1-4 lolos)"
echo "    WA              : disabled default — verifikasi webhook dulu"
echo "    Webchat         : enabled"
echo "    Wallet awal     : USD $INITIAL_BALANCE"
echo ""
echo "Langkah berikut (playbook): verifikasi webhook, uji isolasi tenant,"
echo "lalu naikkan PIPELINE_MODE secara bertahap (shadow -> on)."
