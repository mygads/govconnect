---
name: govconnect-debugger
description: >
  Skill diagnosis untuk admin/operator GovConnect. Membantu mendiagnosis
  masalah umum: tiket tidak terbuat, jawaban AI kosong/ngawur, KB tidak
  ketemu, billing aneh, webhook tidak masuk. Gunakan saat ada laporan
  masalah dari warga atau anomali di dashboard.
version: 1
---

# GovConnect Debugger Skill

Skill ini memandu diagnosis masalah GovConnect secara sistematis.
Ikuti alur di bawah berdasarkan gejala yang dilaporkan.

## 1. Tiket tidak terbuat padahal warga sudah konfirmasi

**Cek berurutan:**

1. **PIPELINE_MODE**: `echo $PIPELINE_MODE` di ai-service. Harus `on` untuk v2.
   - Jika `off`: konfirmasi G2/G3 hanya jalan di v2.

2. **Turn state**: cek `pipeline_turn_states` untuk user tersebut:
   ```sql
   SELECT stage, slots, expires_at FROM pipeline_turn_states
   WHERE user_id = '<wa_user_id>' AND tenant_id = '<village_id>'
   ORDER BY expires_at DESC LIMIT 1;
   ```
   - Jika `slots.pendingTool` NULL → VERIFY tidak pernah mint pending mutation.
   - Jika `expires_at < now()` → state kedaluwarsa, warga harus mulai ulang.

3. **Audit trail**: cek `pipeline_audit` untuk trace konfirmasi:
   ```sql
   SELECT stage, event, detail FROM pipeline_audit
   WHERE trace_id = '<trace_id>' AND stage = 'VERIFY'
   ORDER BY created_at;
   ```
   - Cari `stale_confirmation_rejected` → tombol diklik 2× atau pendingTool hilang.
   - Cari `confirmation_bound` → seharusnya lanjut ke EXECUTE.

4. **Button ID**: untuk WhatsApp, pastikan `button_id` ter-forward dari channel-service.
   Cek log channel-service untuk `extractInteractiveResponseIdFromMessage`.

## 2. Jawaban AI kosong atau "sistem gangguan"

**Cek berurutan:**

1. **LLM gateway**: cek `ai_generation_logs` untuk trace tersebut:
   ```sql
   SELECT model, finish_reason, response_json FROM ai.ai_generation_logs
   WHERE trace_id = '<trace_id>' ORDER BY created_at;
   ```
   - `finish_reason = 'length'` → respons terpotong, naikkan max_tokens.
   - `tool_calls` ada tapi tidak ter-parse → cek `staged-agent.ts` parseToolCalls.

2. **BUG-008**: jika `empty_llm_output` di log, cek apakah retry/fallback jalan.
   Lihat `ai-gateway.service.ts` — harus ada 1 retry + fallback model.

3. **Wallet**: cek saldo desa:
   ```sql
   SELECT balance_usd, status FROM ai.village_wallets WHERE village_id = '<village_id>';
   ```
   - Jika `balance_usd <= 0` atau `status = 'exhausted'` → AI_BALANCE_HELD, isi saldo.

## 3. KB tidak ketemu / jawaban ngawur

**Cek berurutan:**

1. **Embedding ada**: 
   ```sql
   SELECT COUNT(*) FROM ai.knowledge_vectors
   WHERE village_id = '<village_id>' AND embedding IS NOT NULL;
   ```
   - Jika 0 → dokumen belum di-ingest atau embedding gagal.

2. **Scope**: pastikan `scope` dan `village_id` benar. Dokumen global (`is_global=true`)
   hanya untuk info umum.

3. **Semantic cache**: jika dokumen baru di-publish tapi tidak ketemu,
   cek apakah `semanticCacheInvalidate()` dipanggil. Lihat log untuk
   `[kb-publish]` atau `[document-ingest]`.

4. **BUG-007**: jika jawaban tidak grounded ke KB, cek `answer-policy.service.ts`
   — service-fact claim tanpa grounding harus dipaksa ke KB/canned response.

## 4. Billing aneh / cost melonjak

**Cek berurutan:**

1. **Billing per turn**:
   ```sql
   SELECT COUNT(*), SUM(cost_usd) FROM ai.ai_message_billings
   WHERE village_id = '<village_id>' AND created_at > now() - interval '1 day';
   ```

2. **Anomaly**: jika cost per turn > 3× baseline, cek `cost_anomaly_alerts`:
   ```sql
   SELECT * FROM ai.cost_anomaly_alerts
   WHERE village_id = '<village_id>' ORDER BY created_at DESC LIMIT 5;
   ```

3. **Kill-switch**: jika `ai_kill_switch` aktif, semua LLM call diblokir.
   Cek setting di dashboard atau `village_behavior_configs`.

## 5. Webhook tidak masuk / pesan tidak dibalas

**Cek berurutan:**

1. **Channel health**: `curl http://127.0.0.1:3001/health`
2. **RabbitMQ**: cek queue `govconnect` di management UI (port 15672).
3. **Rate limit**: cek log untuk `rate_limited` atau `quarantined`.
4. **Session**: untuk webchat, pastikan `session_id` diawali `web_`.

## Perintah cepat

```bash
# Cek semua service
for p in 3001 3002 3003 3004 3010; do
  echo "Port $p: $(curl -s -m 2 http://127.0.0.1:$p/health | head -c 30)"
done

# Tail log AI service
tail -f ~/workspace/gc-merge/logs/ai.log | grep -i "error\|fail\|empty"

# Cek PIPELINE_MODE
grep PIPELINE_MODE ~/workspace/gc-merge/govconnect-ai-service/.env
```
