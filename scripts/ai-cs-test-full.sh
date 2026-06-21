#!/usr/bin/env bash
# Comprehensive AI CS quality battery for Desa Sanreseng Ade.
# Uses the REAL webchat endpoint with persistent sessions so multi-turn
# memory + active-service state are exercised (knowledge_test mode skips those).
set -u
KEY="govconnect-internal-api-key-2025"
VID="cml65fa1m0000mj01ee31edeh"
WURL="http://localhost:3002/api/webchat"

say() {
  local sess="$1"; local msg="$2"
  curl -s -m 90 -X POST "$WURL" \
    -H 'Content-Type: application/json' -H "x-internal-api-key: $KEY" \
    -d "{\"message\":$(jq -Rn --arg m "$msg" '$m'),\"village_id\":\"$VID\",\"session_id\":\"$sess\"}" \
    | jq -c '{intent, resp:.response}'
}

sess() { echo "web_qa_$(date +%s)_$RANDOM"; }

echo "########## A. Single-turn correctness ##########"
S=$(sess); echo "[A1 greeting]"; say "$S" "assalamualaikum pak"
S=$(sess); echo "[A2 sktm syarat]"; say "$S" "syarat bikin surat keterangan tidak mampu apa aja"
S=$(sess); echo "[A3 jam buka]"; say "$S" "kantor desa buka jam berapa"
S=$(sess); echo "[A4 list layanan]"; say "$S" "ada layanan surat apa saja di desa"
S=$(sess); echo "[A5 kontak penting]"; say "$S" "minta nomor puskesmas dong"
S=$(sess); echo "[A6 out-of-scope]"; say "$S" "berapa 25 x 4?"
S=$(sess); echo "[A7 alamat desa]"; say "$S" "alamat kantor desa di mana"

echo "########## B. Multi-turn memory + context ##########"
S=$(sess)
echo "[B1 t1 service]"; say "$S" "saya mau urus surat keterangan usaha"
sleep 1; echo "[B1 t2 followup syarat]"; say "$S" "syaratnya apa aja?"
sleep 1; echo "[B1 t3 followup prosedur]"; say "$S" "kalau cara ngurusnya gimana?"

S=$(sess)
echo "[B2 t1 sktm]"; say "$S" "info surat keterangan tidak mampu dong"
sleep 1; echo "[B2 t2 switch jam]"; say "$S" "oh iya, kantornya buka jam berapa ya?"
sleep 1; echo "[B2 t3 back to service]"; say "$S" "balik ke surat tadi, butuh berkas apa?"

echo "########## C. Naturalness / tone ##########"
S=$(sess); echo "[C1 marah]"; say "$S" "kesel banget pelayanan lama amat!! kapan kelar surat saya"
S=$(sess); echo "[C2 bingung]"; say "$S" "saya gaptek pak ga ngerti caranya gimana"
S=$(sess); echo "[C3 terima kasih]"; say "$S" "makasih banyak ya pak sangat membantu"

echo "########## DONE ##########"
