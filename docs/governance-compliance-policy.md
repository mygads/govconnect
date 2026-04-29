# GovConnect Governance, Compliance, and Data Handling Policy

Tanggal: 2026-04-24
Status: implemented baseline policy for product/runtime alignment

## Data Classification

| Kelas | Contoh | Aturan Runtime |
| --- | --- | --- |
| Publik | FAQ, jam layanan, daftar layanan aktif | Boleh masuk prompt dan jawaban warga. |
| Internal | konfigurasi desa, routing eskalasi, metrik operasional | Hanya untuk policy/routing; jangan dibocorkan ke warga. |
| Pribadi | nama, nomor WA, session id, riwayat percakapan | Gunakan hanya untuk layanan warga terkait dan tenant yang sama. |
| Sensitif | dokumen layanan, alamat detail, bukti laporan, sentimen krisis | Minimalkan di log/prompt; hanya kirim ke tool/service yang relevan. |

## Purpose Limitation

- Data warga hanya dipakai untuk: menjawab layanan, membuat/mengecek/memperbarui laporan/layanan, handoff petugas, dan audit insiden.
- Prompt agent hanya boleh menerima context yang relevan dengan pesan saat ini, tenant aktif, dan flow layanan berjalan.
- Data tenant lain dilarang masuk prompt, cache, retrieval, atau dashboard desa.

## Access Control

- Superadmin: konfigurasi global, AI usage, health, village registry.
- Village admin: data desa sendiri, laporan, layanan, livechat, knowledge base desa.
- Internal service: hanya endpoint internal dengan `x-internal-api-key`/service auth.
- Citizen: hanya data miliknya via WA/webchat/session/request token.

## Secret Management

- Provider API keys, gateway credentials, and other runtime secrets must be encrypted at rest before persistence.
- AI provider keys are stored in `ai_providers.api_key_encrypted` using AES-256-GCM and decrypted only while constructing an outbound gateway attempt.
- Provider `default_headers_json` must never carry auth-like headers; runtime code owns `Authorization: Bearer <decrypted-key>`.
- Internal API keys are compared with timing-safe equality and should not be logged, echoed in errors, or included in observability payloads.

## Audit Trail

Aksi sensitif yang wajib diaudit:

- Status change laporan/layanan: OPEN/PROCESS/DONE/CANCELED/REJECT.
- Handoff/takeover start/end, termasuk reason dan enrichment context.
- Cancel/edit oleh warga.
- Reset AI usage/evaluation data.
- Perubahan knowledge/config yang mempengaruhi jawaban agent.

Correlation ID wajib diteruskan melalui HTTP header `x-correlation-id`, RabbitMQ header, dan `_meta.correlation_id` pada payload event.

## Retention & Deletion

- Conversation state: dipertahankan untuk operasional livechat dan dapat dihapus oleh admin lewat fitur delete conversation.
- User profile memory: hanya field yang bermanfaat untuk autofill/context layanan; consent/revoke harus menghapus PII.
- Case memory: mengikuti kebutuhan administrasi laporan/layanan dan kebijakan desa.
- Operational telemetry: token usage, eval, guardrail, dan observability disimpan agregat; jangan simpan isi PII penuh kecuali diperlukan untuk audit.

## Consent / Notice

- Warga harus diberi notice bahwa chat diproses untuk layanan desa, histori percakapan dapat digunakan untuk kesinambungan layanan, dan dapat diteruskan ke petugas saat perlu.
- Untuk data sensitif/dokumen, minta warga hanya mengirim data yang dibutuhkan untuk layanan terkait.

## Incident Response

1. Identifikasi: gunakan correlation ID, tenant id, user/session id, event routing key, dan timestamp.
2. Containment: hentikan flow terkait, matikan notification route atau takeover jika perlu.
3. Assessment: klasifikasikan data terdampak (publik/internal/pribadi/sensitif).
4. Remediation: hapus pesan salah kirim bila memungkinkan, revoke cache/memory, perbaiki policy/router/tool.
5. Notification: eskalasi ke admin desa/superadmin sesuai severity.
6. Regression: tambahkan kasus ke golden-set/noisy/ambiguity/safety suite.

## PII Register per Service

| Service | PII Fields | Notes |
| --- | --- | --- |
| channel-service | `wa_user_id`, `channel_identifier`, `user_name`, `user_phone`, message text/media refs | Source of livechat conversation state. |
| ai-service | user profile memory, conversation summary, token usage `wa_user_id/session_id`, eval traces | Minimize prompt/log PII; use correlation IDs. |
| case-service | reporter fields, service citizen data JSON, complaint/service addresses/docs | Domain source of case memory. |
| notification-service | notification recipient, message text, delivery status | Logs outbound notification status. |
| dashboard | admin identity/session, village profile, knowledge, eval runs | Enforce RBAC tenant isolation. |

## Data Flow Summary

1. Citizen message enters channel-service.
2. Channel-service stores message and publishes message event with correlation ID.
3. AI-service processes with four memory layers and tenant-scoped tools.
4. Case-service mutates reports/service requests when required.
5. Notification-service sends async status updates to WA via channel-service.
6. Dashboard reads tenant-scoped operational state, eval history, and observability.
