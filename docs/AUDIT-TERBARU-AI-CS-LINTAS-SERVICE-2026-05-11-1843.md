# Audit Terbaru AI CS Multi-Desa Lintas Service

Waktu audit: 2026-05-11 18:43 WIB

Scope kode saat ini:

- `govconnect-ai-service`
- `govconnect-case-service`
- `govconnect-dashboard`
- `govconnect-channel-service`
- `govconnect-notification-service`
- kandidat dead/redundant code pada dirty worktree saat audit.

Catatan penting:

- Ini audit terbaru berdasarkan kondisi worktree saat ini, bukan audit lama.
- Worktree sedang sangat dirty. Banyak perubahan sudah ada lintas service.
- Audit ini read-only dan tidak mengubah file aplikasi.
- Semua temuan di bawah berbasis bukti kode yang dibaca pada audit ini.

## Ringkasan

Kondisi terbaru sudah jauh lebih kuat dibanding audit awal:

- Complaint metadata admin sudah lebih ketat secara multi-desa.
- Complaint type auto-send nomor penting sudah bergeser ke kontrak `important_contact_category_id` dan divalidasi village-scope.
- `ServiceRequest.village_id` sudah non-null di schema dan ada migration backfill.
- Service request history table sudah ada.
- AI agent sudah punya pre-agent state router yang lebih state-aware.
- Runtime DB-vs-RAG mismatch recording sudah ada dan terhubung ke pipeline utama.
- Answer-policy dan reconciler sudah memperkuat DB-first untuk fakta terstruktur.
- Important-contact lookup sudah melakukan dedupe dan confidence scoring.
- Channel/notification sudah punya delivery tracking, duplicate suppression, takeover handling, dan important-contact auto-send flow.

Namun masih ada gap penting:

- Beberapa route public/internal kemungkinan rusak karena hardening `x-admin-role` pada metadata endpoints.
- Webchat AI reply consumer di channel-service masih menolak reply non-WhatsApp.
- Knowledge-test mode melewati answer-policy dan DB-vs-RAG reconciler.
- Learned/read-tool broadening masih bisa melemahkan DB-first jika retrieval tools masuk dari policy.
- Important-contact duplicate suppression belum global per nomor lintas kategori.
- Service request event notification tidak membawa `result_description`.
- Beberapa fallback legacy dan schema-drift compatibility masih hidup dan perlu dibersihkan setelah verifikasi data.

## Status Implementasi Yang Sudah Terlihat

### AI Agent dan Anti-Hallucination

Sudah ada:

- `govconnect-ai-service/src/services/pre-agent-state-router.service.ts:337-561` memusatkan banyak fast routing dengan confidence, mixed-signal, state-affinity, dan allowed-tool hints.
- `govconnect-ai-service/src/services/pre-agent-state-router.service.ts:882-918` menangani greeting/thanks secara state-aware tanpa memanggil LLM jika aman.
- `govconnect-ai-service/src/services/agent/tool-definitions.ts:20-361` mendefinisikan canonical tool surface.
- `govconnect-ai-service/src/services/agent/tool-executor.ts:118-124` mengelompokkan mutation tools.
- `govconnect-ai-service/src/services/agent/tool-executor.ts:218-244` memblokir mutation tools kecuali `sideEffectMode === 'production'`.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:951-968` melakukan dedupe tool-call signature.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:975-1007` menjalankan read-only tools parallel dan mutation tools serial.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:540-556` text-tool fallback dibatasi pada allowed read-only grounding tool dan mutation ditolak.
- `govconnect-ai-service/src/services/answer-policy.service.ts:281-333` tidak menganggap retrieval gagal/kosong/low-confidence sebagai grounding yang cukup.
- `govconnect-ai-service/src/services/db-rag-reconciler.service.ts:177-426` melakukan post-check jawaban final terhadap DB authoritative values dan rewrite jika mismatch.
- `govconnect-ai-service/src/services/unified-message-processor.service.ts:2184-2229` memasang reconciler di normal agent path setelah answer-policy.
- `govconnect-ai-service/src/services/unified-message-processor.service.ts:1922-1961` juga memasang reconciler untuk response-cache hits.

Sisa risiko:

- `govconnect-ai-service/src/services/unified-message-processor.service.ts:2098` melewati answer-policy saat `sideEffectMode === 'knowledge_test'`.
- `govconnect-ai-service/src/services/unified-message-processor.service.ts:2189` juga melewati DB-vs-RAG reconciler saat `sideEffectMode === 'knowledge_test'`.
- `govconnect-ai-service/src/services/db-rag-reconciler.service.ts:194-204` hanya memverifikasi nomor telepon jika contact/profile tool dipakai.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:564-566` final reply validation bisa terlalu luas karena memblokir kata seperti `ai`, `tool`, `retrieval`, dan `dokumen internal`.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:1302-2011` `selectAllowedTools()` masih sangat panjang, repetitif, dan order-sensitive.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:1977-1988` learned policy memang membatasi mutation, tetapi read tools masih bisa diperluas oleh learned policy jika tidak hard-denied.

Rekomendasi prioritas:

1. Aktifkan strict verifier untuk `knowledge_test`, atau buat mode evaluasi yang tetap menjalankan answer-policy dan reconciler tanpa side effect.
2. Jadikan reconciler mem-flag phone number tanpa contact/profile grounding, bukan hanya saat tool dipakai.
3. Pecah `selectAllowedTools()` menjadi intent-policy rules eksplisit dengan final hard-deny enforcement.
4. Persempit final reply internal-term guard agar tidak memblokir FAQ sah tentang AI/GovConnect.
5. Batasi learned read-tool broadening agar retrieval tidak masuk jika DB tool authoritative sudah tersedia atau query tidak punya retrieval cue.

### DB-First dan RAG/KB

Sudah ada:

- `govconnect-ai-service/src/services/knowledge.service.ts:87-91` membatasi `searchKnowledge()` ke curated knowledge.
- `govconnect-ai-service/src/services/knowledge.service.ts:156-160` memisahkan uploaded documents ke `searchDocuments()`.
- `govconnect-ai-service/src/services/agent/tool-executor.ts:896-945` menandai knowledge retrieval sebagai `untrusted_retrieval`.
- `govconnect-ai-service/src/services/agent/tool-executor.ts:967-1016` menandai document retrieval sebagai `untrusted_retrieval`.
- `govconnect-ai-service/src/services/runtime-grounding-mismatch.service.ts:4-12` mencakup mismatch phone, operating hours, office address, service cost/duration/mode/availability/requirements.
- `govconnect-ai-service/src/services/runtime-grounding-mismatch.service.ts:46-75` menyimpan mismatch ke `ai_runtime_grounding_mismatches`.

Sisa risiko:

- `govconnect-ai-service/src/services/knowledge.service.ts:536-622` punya `getRAGContext()` dengan DB-first profile injection, tetapi main agent path lebih banyak memakai `searchKnowledgeWithRAG()` sehingga behavior DB-first tersebar.
- `govconnect-ai-service/src/services/doc-vs-db-pipeline.service.ts` adalah offline/admin pipeline, bukan inline protection untuk setiap jawaban.
- Cache hanya menyimpan tool names, bukan source IDs/hash/version. Bukti: `govconnect-ai-service/src/services/unified-message-processor.service.ts:2231-2242`.

Rekomendasi:

1. Simpan provenance cache: source IDs, updated_at, content hash untuk service/contact/profile/knowledge.
2. Pastikan DB-vs-KB conflict result dipakai runtime untuk structured facts.
3. Jadikan offline doc-vs-db scan sebagai admin task wajib per desa, bukan hanya utility.

### Important Contacts dan Nomor Penting

Sudah ada:

- `govconnect-ai-service/src/services/important-contacts.service.ts:72-85` normalisasi nomor telepon.
- `govconnect-ai-service/src/services/important-contacts.service.ts:93-108` dedupe kontak berdasarkan category dan normalized phone.
- `govconnect-ai-service/src/services/important-contacts.service.ts:130-154` hasil fetch kontak didedupe sebelum dikembalikan.
- `govconnect-ai-service/src/services/agent/tool-executor.ts:754-829` important-contact tool mengembalikan satu top match jika confidence cukup, atau list pendek jika ambigu.
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:299-315` complaint type create menolak auto-send tanpa `important_contact_category_id` dan memvalidasi kategori kontak satu desa.
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:364-377` complaint type update preserve/validate kategori kontak.
- `govconnect-notification-service/src/services/notification.service.ts:114-144` notification service fetch contacts dari dashboard internal route dengan prioritas `category_id`.

Sisa risiko:

- `govconnect-ai-service/src/services/important-contacts.service.ts:102` dedupe key adalah `${category_id}:${normalizedPhone}`, jadi nomor sama lintas kategori tetap bisa muncul dua kali.
- `govconnect-ai-service/src/services/important-contacts.service.ts:517-524` score dinormalisasi dengan `Math.max(maxRaw, 10)`, membuat alias/category fallback raw score 3 hanya menjadi 0.3 dan sulit dianggap confident.
- `govconnect-notification-service/src/services/notification.service.ts:125-134` masih punya legacy fallback by category name.
- `govconnect-dashboard/app/api/internal/important-contacts/route.ts:72-86` masih menerima `category_name` untuk fallback legacy.
- `govconnect-dashboard/app/dashboard/pengaduan/kategori-jenis/page.tsx:148-160` masih ada legacy reconciliation helper.

Rekomendasi:

1. Tambahkan response-level dedupe by normalized phone lintas kategori.
2. Audit data legacy `complaint_types` dengan `important_contact_category_id IS NULL` sebelum menghapus fallback by name.
3. Jika tidak ada legacy rows/logs, hapus bertahap name fallback di notification, internal route, dan UI reconciliation.
4. Pertimbangkan explicit `is_emergency` pada contact category/contact agar emergency tidak ditentukan oleh hints nama/deskripsi.

## Case Service dan Dashboard

### Complaint Metadata dan Multi-Desa

Sudah ada:

- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:23-65` strict admin scoping helper.
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:148-157` list complaint categories scoped by resolved village atau `scope=all` untuk superadmin.
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:261-278` list complaint types scoped by parent category village.
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:164-183` create complaint category memakai scoped write village dan `name_key`.
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:285-329` create complaint type memvalidasi category village dan important contact category.
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:340-392` update complaint type memvalidasi ownership dan contact category.

Sisa risiko:

- `govconnect-dashboard/app/api/public/complaints/categories/route.ts:19-23` public proxy hanya forward internal API key, tidak `x-admin-role`.
- `govconnect-dashboard/app/api/public/complaints/types/route.ts:23-27` sama, hanya internal API key.
- Karena `complaint-meta.controller.ts:23-38` sekarang mewajibkan `x-admin-role`, public category/type lookup berisiko `400` meski sudah membawa `village_id`.

Rekomendasi:

1. Pisahkan public/internal read endpoint atau izinkan internal API-key scoped read tanpa `x-admin-role`.
2. Jangan longgarkan admin route tanpa membedakan public/internal identity.

### Urgent/Emergency Dari DB

Sudah ada:

- `govconnect-case-service/src/services/complaint.service.ts:327-345` urgent complaint enqueue `govconnect.urgent.alert` berdasarkan resolved complaint type.
- `govconnect-dashboard/app/api/settings/notifications/route.ts:96-115` mencoba load urgent complaint type names dari case service dengan `is_urgent=true` dan `village_id`.

Sisa risiko:

- `govconnect-dashboard/app/api/settings/notifications/route.ts:96-105` memanggil case service dengan `getHeaders()` saja, tanpa `x-admin-role`.
- Karena case complaint types sekarang admin-scoped, lookup urgent type names kemungkinan gagal dan fallback ke `[]` di `settings/notifications/route.ts:107-114`.

Rekomendasi:

1. Kirim `x-admin-role` dan `x-village-id` saat lookup urgent types dari dashboard notification settings.
2. Jangan silent fallback ke `[]` tanpa menandai warning di response/log jika case-service menolak.

### Service Categories dan Service Request

Sudah ada:

- `govconnect-case-service/src/controllers/service-catalog.controller.ts:95-110` normalized service category `name_key` dan duplicate detection.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:253-274` create service category menulis `name_key`.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:285-318` update service category memperbarui `name_key`.
- `govconnect-case-service/prisma/migrations/20260511003000_add_service_category_name_keys/migration.sql:5-31` menambah `name_key`, backfill duplicate-safe, dan unique index `(village_id, name_key)`.
- `govconnect-case-service/prisma/migrations/20260511002000_require_service_request_village_id/migration.sql:1-19` backfill `service_requests.village_id` dari `services_dynamic.village_id` dan set `NOT NULL`.
- `govconnect-case-service/prisma/migrations/20260511004000_add_service_request_updates/migration.sql:3-32` menambah `service_request_updates`.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:1207-1246` status/detail update menulis immutable history rows.

Sisa risiko:

- `govconnect-case-service/src/controllers/service-catalog.controller.ts:1207-1246` membuat history row untuk setiap PATCH, termasuk non-status update. Ini bisa benar sebagai audit umum, tapi consumer harus menangani `old_status/new_status = null`.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:1248-1264` status update event menyertakan `result_file_url` dan `result_file_name`, tetapi tidak `result_description` meskipun field diterima di `service-catalog.controller.ts:1180`.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:823-826` service request list menerima `village_id` query/header tetapi tidak memvalidasi admin role seperti metadata routes.

Rekomendasi:

1. Tambahkan `result_description` ke outbox status update payload.
2. Pastikan API consumer service request history membedakan status transition vs field audit.
3. Selaraskan service request admin list dengan admin role/village session semantics, atau dokumentasikan bahwa dashboard proxy adalah enforcement boundary.

### Dashboard UI/API Consistency

Sisa risiko:

- `govconnect-dashboard/app/api/complaints/types/route.ts:180-186` superadmin create dengan `send_important_contacts=true` tidak bisa validate contact category karena route hanya resolve jika `session.admin.village_id` ada.
- `govconnect-dashboard/app/api/complaints/types/[id]/route.ts:61-67` update punya gap yang sama.
- `govconnect-dashboard/app/api/complaints/types/route.ts:98-146` fallback raw SQL mengembalikan `NULL::text AS important_contact_category_id`, sehingga ID baru hilang saat fallback dipakai.
- `govconnect-dashboard/app/api/public/complaints/route.ts:66-68` masih mewajibkan legacy `kategori` walaupun sudah menerima `type_id/category_id`.
- `govconnect-dashboard/app/api/settings/notifications/route.ts:23-28` notification settings hanya village-admin dan tidak mendukung superadmin selected village.

Rekomendasi:

1. Untuk superadmin complaint type write, resolve village dari selected category sebelum validasi important contact category.
2. Update fallback raw SQL agar memilih `t.important_contact_category_id` jika kolom ada.
3. Public complaint create sebaiknya bisa submit dengan `type_id` tanpa legacy `kategori`, lalu backend derive label dari DB.
4. Jika superadmin perlu manage notification settings, tambahkan selected village scope.

## Channel dan Notification Service

### Delivery, Duplicate, dan Takeover

Sudah ada:

- `govconnect-channel-service/src/controllers/webhook.controller.ts:394-419` menangani provider delivery webhook dan forward ke notification-service `/internal/delivery-status`.
- `govconnect-notification-service/src/services/notification.service.ts:240-276` apply delivery updates ke `notificationLog` dan forward callback status update ke case-service.
- `govconnect-channel-service/src/controllers/webhook.controller.ts:828-834` drop duplicate inbound provider message.
- `govconnect-channel-service/src/controllers/webhook.controller.ts:750-814` message action/reaction check duplicate provider dan synthetic system activity ID.
- `govconnect-channel-service/src/controllers/webhook.controller.ts:982-994` takeover mode skip AI processing dan cancel pending batch retry.
- `govconnect-channel-service/src/services/rabbitmq.service.ts:469-485` suppress AI replies jika takeover aktif setelah user message dikirim ke AI.

Sisa risiko:

- `govconnect-channel-service/src/services/rabbitmq.service.ts:428-433` `startConsumingAIReply` throw jika target channel bukan `WHATSAPP`, meskipun resolver mendukung `WEBCHAT`.
- `govconnect-notification-service/src/services/notification.service.ts:254-263` delivery callback hanya update `provider_status` untuk delivered/read, sedangkan `notificationLog.status` tetap `sent` kecuali failed.
- `govconnect-channel-service/src/controllers/webhook.controller.ts:75-80` delivery ID extraction mungkin melewatkan nested receipt message IDs.
- `govconnect-channel-service/src/services/rabbitmq.service.ts:488-653` WhatsApp send terjadi sebelum beberapa post-send work dan ack. Error setelah provider send bisa memicu retry dan duplikasi outbound AI reply.
- `govconnect-channel-service/src/services/rabbitmq.service.ts:570-605` contact vCards dari AI reply dikirim tetapi tidak dipersist ke local outgoing message.

Rekomendasi:

1. Implement webchat AI reply delivery path di channel-service atau route non-WA reply ke webchat sender.
2. Update `notificationLog.status` ke delivered/read saat delivery callback sukses.
3. Perluas message ID extraction untuk nested receipt payload actual provider.
4. Setelah provider send sukses, guard semua post-send side effects agar tidak throw sampai retry RabbitMQ.
5. Persist provider IDs untuk vCard/contact messages agar livechat dan delivery tracking lengkap.

### Auto-Send Important Contacts dan Urgent Alerts

Sudah ada:

- `govconnect-case-service/src/services/complaint.service.ts:301-318` enqueue `complaint_important_contacts` dengan `important_contact_category_id`.
- `govconnect-notification-service/src/services/notification.service.ts:182-201` duplicate suppression untuk important-contact notifications.
- `govconnect-notification-service/src/services/notification.service.ts:203-221` jika contacts kosong, log `skipped` dan tidak kirim pesan kosong.
- `govconnect-notification-service/src/services/notification.service.ts:514-569` urgent-alert handling dengan fallback admin number dan DB audit logging.

Sisa risiko:

- `govconnect-notification-service/src/services/notification.service.ts:161-180` menganggap `skipped` sebagai completed, sehingga setelah konfigurasi kontak diperbaiki auto-send tidak otomatis retry.
- `govconnect-notification-service/src/services/notification.service.ts:224-237` auto-send important contacts mengirim satu text message, bukan vCard/contact cards.
- `govconnect-notification-service/src/services/notification.service.ts:510-560` urgent alert auto-send gated oleh `ENABLE_URGENT_WA_ALERT=true`, default bisa hanya `skipped`.
- `govconnect-channel-service/src/services/rabbitmq.service.ts:937-942` SSE urgent/status event payload minim dan memaksa dashboard refetch.

Rekomendasi:

1. Bedakan `skipped_no_contacts` dari completed final, atau sediakan manual retry setelah admin memperbaiki kategori kontak.
2. Jika requirement adalah kirim contact card, tambahkan vCard path untuk complaint important-contact auto-send.
3. Tampilkan status urgent auto-send gate jelas di UI dan log.
4. Tambahkan metadata event SSE yang cukup atau dokumentasikan refetch-only contract.

## Dead/Redundant Code Terbaru

High-confidence:

- `govconnect-dashboard/app/dashboard/settings/cache/page.tsx:67-69` helper `getApiErrorMessage()` tidak dipakai setelah migrasi ke `fetchApi`.

Medium-high compatibility cleanup setelah verifikasi DB/log:

- `govconnect-notification-service/src/services/notification.service.ts:124-134` legacy important-contact category-name fallback.
- `govconnect-dashboard/app/api/internal/important-contacts/route.ts:72-86` support `category_name` fallback.
- `govconnect-dashboard/lib/important-contact-categories.ts:41` helper legacy category lookup.
- `govconnect-dashboard/app/dashboard/pengaduan/kategori-jenis/page.tsx:148-160` legacy UI reconciliation.

Suspicious/stale fallback:

- `govconnect-dashboard/app/api/complaints/types/route.ts:121-122` raw fallback returns `NULL::text AS important_contact_category_id` meski sistem terbaru sudah ID-first.

Stale comment/path:

- `govconnect-case-service/src/services/complaint.service.ts:351-353` komentar lama bahwa `COMPLAINT_CREATED` tidak dipublish. Active publish path tampak sudah tidak ada, tetapi string `complaint_created` masih dipakai untuk livechat/dashboard/tool outcome dan tidak boleh dihapus tanpa audit terpisah.

Unknown tenant sentinel masih ada dan perlu klasifikasi, bukan langsung hapus:

- `govconnect-ai-service/src/services/case-client.service.ts:931`
- `govconnect-ai-service/src/services/token-usage.service.ts:934`
- `govconnect-ai-service/src/services/token-usage.service.ts:951`
- `govconnect-channel-service/src/services/wa.service.ts:1689`
- `govconnect-channel-service/src/services/spam-guard.service.ts:148-156`

## Prioritas Fix Berikutnya

1. Perbaiki public/internal complaint category/type read yang berpotensi gagal karena `x-admin-role` wajib.
2. Perbaiki dashboard notification settings urgent type lookup agar mengirim admin role/village headers.
3. Perbaiki channel-service WEBCHAT AI reply consumer yang saat ini throw untuk non-WA.
4. Aktifkan answer-policy/reconciler di `knowledge_test` atau strict eval verifier.
5. Update notification delivery callback agar `notificationLog.status` ikut delivered/read.
6. Tambahkan global dedupe nomor kontak lintas kategori.
7. Tambahkan `result_description` ke service request status outbox payload.
8. Redaksi field sensitif seperti `deskripsi`, form/edit URL, alamat, dan RT/RW dari mutation audit/memory.
9. Perbaiki dashboard complaint type superadmin auto-send category validation.
10. Bersihkan dead/redundant code high-confidence setelah type-check dan DB/log verification.

## Kesimpulan

Sistem terbaru sudah bergerak ke arah AI CS multi-desa yang lebih aman dan lebih manusiawi: DB-first, village-scoped, tool-based, dan punya runtime grounding. Risiko terbesar sekarang bukan lagi tidak adanya mekanisme, melainkan edge-case integrasi lintas service dan guard yang terlalu ketat/terlalu longgar di jalur tertentu.

Fokus berikutnya sebaiknya bukan menambah regex intent lagi, tetapi merapikan policy layer:

- route identity public/internal/admin yang eksplisit,
- final hard-deny tool policy,
- strict eval/knowledge-test verifier,
- provenance cache,
- dedupe kontak global,
- dan delivery/retry semantics yang tidak menggandakan pesan warga.
