# GovConnect Cross-Repo Plan (Pasca Audit 2026-05-11)

Dokumen ini adalah peta aksi setelah audit paralel 4 repo:
`govconnect-ai-service`, `govconnect-case-service`, `govconnect-channel-service`,
`govconnect-notification-service`, plus frontend `govconnect-dashboard`.

Semua item dikelompokkan per repo + gelombang urgensi, dengan file:line
konkret dari audit agar implementasi bisa dilanjutkan siapa saja.

---

## GELOMBANG 1 — Cross-service truth & delivery

### 1a. `govconnect-case-service`

| # | Masalah | File | Fix |
|---|---------|------|-----|
| C1 | Source-of-truth `DONE` di-set sebelum delivery confirmed | `src/controllers/service-catalog.controller.ts:649-659`, `src/services/complaint.service.ts:434-451` | Ubah lifecycle: DONE hanya setelah callback delivery confirmed dari channel/notification |
| C2 | Persistence-delivery atomicity tidak terjamin (no outbox) | `complaint.service.ts:434-451`, `service-catalog.controller.ts:649-676` | Implement transactional outbox + publisher worker idempotent |
| C3 | Error publish inkonsisten antar entity | complaint throw vs service_request swallow | Samakan: persist sukses + outbox accepted = API sukses |
| C4 | Status guard longgar untuk unknown state | `complaint.service.ts:410-413`, `service-catalog.controller.ts:63-67` | Fail-closed untuk status tidak dikenal + migrasi data legacy |
| C5 | Schema pakai `String` bukan Prisma enum | `schema.prisma:33, 180` | Convert ke enum + DB constraint |
| C6 | Endpoint callback delivery tidak ada | routes | Tambah `POST /internal/delivery-callback` |
| C7 | Duplikasi FSM + ownership logic | `complaint.service.ts:154-163, 402-414`, `service-catalog.controller.ts:44-67` | Ekstrak `shared/lifecycle-fsm.ts` |
| C8 | Outbox replay + audit endpoint | — | Tambah `POST /internal/events/outbox/replay`, `GET /internal/events/:correlation_id/status` |

### 1b. `govconnect-channel-service`

| # | Masalah | File | Fix |
|---|---------|------|-----|
| Ch1 | Tidak ada verifikasi kronologi timestamp delivery | `src/services/message.service.ts:467-482` | Validate `sent_at <= delivered_at <= read_at`, reject out-of-order |
| Ch2 | FIFO enforcement hanya retention trim, bukan lock | `message.service.ts:78-81, 250-294` | Implementasi per-conversation outbound lock (Redis atau DB advisory lock) |
| Ch3 | Delivery retry tanpa backoff | `rabbitmq.service.ts:103-134` | Exponential backoff + jitter + max attempts |
| Ch4 | Delivery DLQ domain belum ada | — | Tabel + queue `delivery_dlq` + replay endpoint |
| Ch5 | Status transition FSM belum ketat | `message.service.ts:95-107` | Enforce legal transitions (e.g., `read → failed` blocked) |
| Ch6 | `MESSAGE_SENT` routing key dead code | `config/rabbitmq.ts:6` | Hapus |
| Ch7 | Dual logger confusion | `utils/logger.ts` vs `shared/logger.ts` | Pilih satu, deprecated-tag yang lain |
| Ch8 | Endpoint delivery event terstandar multi-channel | — | `POST /internal/delivery-events` |
| Ch9 | Status lookup single SOT | — | `GET /internal/messages/:message_id/status` |

### 1c. `govconnect-notification-service`

| # | Masalah | File | Fix |
|---|---------|------|-----|
| N1 | **WEBCHAT hard-skip** (user tidak dapat notifikasi apa pun) | `src/services/notification.service.ts:31-56` | Hilangkan skip; kirim ke channel-service in-app / webchat-notification endpoint |
| N2 | Email/SMTP tidak implement | — | Tambah email sender (SMTP/Sendgrid) untuk fallback webchat lifecycle |
| N3 | User preference + opt-out belum ada | `prisma/schema.prisma:15-34` | Tambah `notification_preferences` table + API toggle |
| N4 | Template hardcoded di code | `services/template.service.ts:5-141` | Pertimbangkan pindah ke DB templates dengan village-override |
| N5 | Admin email digest harian belum ada | — | Cron job → digest pending urgent complaints ke admin |
| N6 | Urgent alert default OFF | `services/notification.service.ts:136-186` | Make default-on untuk village yang memiliki `ENABLE_URGENT_WA_ALERT` atau per-village flag |

---

## GELOMBANG 2 — Dashboard UI parity dengan BE

| # | Masalah | File | Fix |
|---|---------|------|-----|
| D1 | Testing page: conversationHistory only, tidak pass pending state | `app/dashboard/testing-knowledge/page.tsx:74`, `app/api/testing-knowledge/route.ts:45-50` | Tambah `pending_state` + `channel` meta di payload |
| D2 | Testing page: reset button tidak clear backend session | `testing-knowledge/page.tsx:150-153` | Tambah button "Reset Session" → call `POST /admin/cache/clear-user` |
| D3 | Testing page: tidak ada golden-set replay | — | Halaman baru `app/dashboard/testing-knowledge/replay/page.tsx` |
| D4 | Cache invalidation: hanya villageId, no intents/scope | `app/dashboard/settings/cache/page.tsx:203`, `app/api/cache/route.ts:48` | UI checkbox: intents multi-select, retrieval toggle, profile toggle |
| D5 | Knowledge inconsistency UI masih pakai endpoint lama | `app/dashboard/knowledge-analytics/page.tsx:572,611,647` | Migrasi ke `/api/knowledge-consistency` + summary |
| D6 | Default workflow knowledge masih delete-oriented | `knowledge-analytics/page.tsx:644-649` | Primary CTA: Resolve/Ignore; delete jadi advanced-only |
| D7 | Service detail tidak kirim `result_description` | `app/dashboard/pelayanan/[id]/page.tsx:346-351` | Tambah textarea + include field |
| D8 | Service list tidak pagination | `app/dashboard/pelayanan/page.tsx:72` | Limit/offset + bulk action |
| D9 | Service detail tidak ada timeline | `pelayanan/[id]/page.tsx:688-807` | Tambah komponen `ServiceTimeline` |
| D10 | Trace Explorer belum ada | — | Halaman baru untuk `ai_tool_execution_traces` chain view |

---

## GELOMBANG 3 — Polish & operational

| # | Masalah | Fix |
|---|---------|-----|
| P1 | Urgent alert monitoring | Dashboard panel: rate of urgent alerts, delivery success rate |
| P2 | Rewrite monitoring (answer-policy, reconciler) | Dashboard panel: rate per day/village |
| P3 | DLQ admin UI | List DLQ messages + replay button |
| P4 | Per-village prompt/feature flag admin | UI untuk toggle features per village |

---

## Urutan eksekusi yang saya sarankan

**Fase A (hari ini):** Cross-service truth — **C1, C2, Ch1, Ch2, N1** (paling menyakiti user sekarang)
**Fase B:** Endpoint consistency — **C6, C7, Ch8, Ch9, C8, Ch4, D5, D7**
**Fase C:** UI parity — **D1, D2, D4, D6, D9, D8**
**Fase D:** Advanced tooling — **D3, D10, P-series**

Tiap fase bisa di-ship independen.
