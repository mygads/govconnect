#!/usr/bin/env bash
# AI CS quality test battery for Desa Sanreseng Ade — runs against deployed ai-service.
# Usage: bash ai-cs-test.sh
set -u
KEY="govconnect-internal-api-key-2025"
VID="cml65fa1m0000mj01ee31edeh"
URL="http://localhost:3002/api/testing/chat"

ask() {
  local label="$1"; local msg="$2"; local hist="${3:-[]}"
  echo "===== $label ====="
  echo "Q: $msg"
  curl -s -m 90 -X POST "$URL" \
    -H 'Content-Type: application/json' \
    -H "x-internal-api-key: $KEY" \
    -d "{\"message\":$(jq -Rn --arg m "$msg" '$m'),\"village_id\":\"$VID\",\"conversationHistory\":$hist}" \
  | jq -c '{intent:.data.intent, tools:.data.metadata.toolsUsed, hasKnowledge:.data.metadata.hasKnowledge, resp:.data.response}'
  echo
}

# 1. Greeting / naturalness
ask "greeting" "halo kak"
# 2. Service info (tool: get_service_info)
ask "service-sktm" "cara urus surat keterangan tidak mampu gimana ya"
# 3. Knowledge / RAG (FAQ, jam layanan)
ask "rag-jam" "kantor desa buka jam berapa aja?"
# 4. Emergency contacts (tool: get_emergency_contacts)
ask "emergency" "ada nomor darurat pemadam kebakaran ga?"
# 5. Complaint (tool: complaint flow)
ask "complaint" "saya mau lapor jalan rusak parah di depan rumah, sudah berbulan-bulan"
# 6. Village profile (tool: get_village_profile)
ask "profile" "desa sanreseng ade ini kepala desanya siapa?"
# 7. Out-of-scope / honesty
ask "oos" "tolong buatkan saya puisi cinta dong"
# 8. Ambiguous
ask "ambiguous" "bantu saya dong"
# 9. Multi-service list
ask "service-list" "layanan apa aja yang bisa diurus di desa?"
# 10. Natural follow-up requiring memory
ask "memory-1" "saya mau urus KTP"
echo "(memory-2 uses history)"
ask "memory-2" "berapa lama prosesnya?" '[{"role":"user","content":"saya mau urus KTP"},{"role":"assistant","content":"Untuk mengurus KTP, silakan siapkan KK dan datang ke kantor desa."}]'
