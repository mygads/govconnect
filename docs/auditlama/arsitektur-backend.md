# Arsitektur Backend GovConnect — Dokumentasi Teknis Lengkap

> **Dokumen ini dihasilkan dari analisis source code langsung**, bukan dari dokumentasi lama.
> Terakhir diperbarui: 17 April 2026

---

## Daftar Isi

1. [Gambaran Umum Arsitektur](#1-gambaran-umum-arsitektur)
2. [Infrastruktur & Deployment](#2-infrastruktur--deployment)
3. [Alur Pesan End-to-End](#3-alur-pesan-end-to-end)
4. [Channel Service (Port 3001)](#4-channel-service-port-3001)
5. [AI Orchestrator Service (Port 3002)](#5-ai-orchestrator-service-port-3002)
6. [Case Service (Port 3003)](#6-case-service-port-3003)
7. [Notification Service (Port 3004)](#7-notification-service-port-3004)
8. [Dashboard (Port 3000)](#8-dashboard-port-3000)
9. [RabbitMQ — Event-Driven Architecture](#9-rabbitmq--event-driven-architecture)
10. [Pipeline RAG (Retrieval-Augmented Generation)](#10-pipeline-rag-retrieval-augmented-generation)
11. [Sistem Intent & NLU](#11-sistem-intent--nlu)
12. [Prompt Engineering & Adaptive Prompt](#12-prompt-engineering--adaptive-prompt)
13. [Anti-Hallucination & Quality Control](#13-anti-hallucination--quality-control)
14. [AI Gateway 4-Lane Architecture](#14-ai-gateway-4-lane-architecture)
15. [Manajemen Case: Complaint & Service Request](#15-manajemen-case-complaint--service-request)
16. [User Profile & Spam Guard](#16-user-profile--spam-guard)
17. [Caching Strategy](#17-caching-strategy)
18. [Database Schema per Service](#18-database-schema-per-service)
19. [Keamanan & Temuan Audit](#19-keamanan--temuan-audit)
20. [Analytics & Token Usage](#20-analytics--token-usage)
21. [Dashboard Frontend — Flow Data & Analitik](#21-dashboard-frontend--flow-data--analitik)

---

## 1. Gambaran Umum Arsitektur

GovConnect adalah platform layanan pemerintah desa berbasis WhatsApp + Webchat dengan AI orchestrator. Arsitektur menggunakan **5 microservice** dengan prinsip **1 service = 1 database** (PostgreSQL).

```
┌─────────────────────────────────────────────────────────────────────┐
│                      PENGGUNA (WhatsApp / Webchat)                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SERVICE 1: CHANNEL SERVICE (Express.js, Port 3001)                  │
│  DB: gc_channel_db                                                   │
│  ─ Webhook WhatsApp (Genfity WA Provider)                            │
│  ─ Chat history FIFO 30 pesan/user                                   │
│  ─ Session WA per desa (1 nomor = 1 desa)                            │
│  ─ Live Chat & Admin Takeover                                        │
│  ─ Media upload                                                      │
└───────────────────┬──────────────────────────────────────────────────┘
                    │  RabbitMQ: whatsapp.message.received
                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SERVICE 2: AI ORCHESTRATOR (Express.js, Port 3002)                  │
│  DB: ai_service_db (vector DB + token usage + session state)         │
│  ─ Intent detection (Micro-NLU + Full LLM)                          │
│  ─ RAG: Hybrid Search (Vector + Keyword + Rerank)                    │
│  ─ Adaptive prompt composition                                       │
│  ─ Anti-hallucination validation                                     │
│  ─ REST call ke Case Service & Dashboard                             │
└───────────────────┬──────────────────────────────────────────────────┘
                    │  RabbitMQ: govconnect.ai.reply
                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SERVICE 1: CHANNEL SERVICE                                          │
│  ─ Simpan reply (direction=OUT, source=AI)                           │
│  ─ Kirim ke WhatsApp via WA Provider                                 │
│  ─ Update conversation & send_logs                                   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  SERVICE 3: CASE SERVICE (Express.js, Port 3003)                     │
│  DB: gc_case_db                                                      │
│  ─ CRUD Pengaduan (complaints) & Layanan (service_requests)          │
│  ─ Katalog layanan & tipe pengaduan per desa                         │
│  ─ Status workflow: OPEN → PROCESS → DONE / CANCELED / REJECT        │
│  ─ Soft delete & history user                                        │
└───────────────────┬──────────────────────────────────────────────────┘
                    │  RabbitMQ: govconnect.status.updated, dll.
                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SERVICE 4: NOTIFICATION SERVICE (Express.js, Port 3004)             │
│  DB: gc_notification_db                                              │
│  ─ Konsumer event dari Case Service                                  │
│  ─ Template notifikasi (status update, urgent alert)                 │
│  ─ Kirim via Channel Service POST /internal/send                     │
│  ─ Log semua notifikasi (audit trail)                                │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  SERVICE 5: DASHBOARD (Next.js 14+, Port 3000)                       │
│  DB: gc_dashboard_db                                                 │
│  ─ Admin UI (profil desa, knowledge base, nomor penting)             │
│  ─ Public form (layanan online)                                      │
│  ─ Internal API untuk AI Service & Channel Service                   │
└──────────────────────────────────────────────────────────────────────┘
```

**Tech Stack:**
- Backend: Express.js 5.x (Node.js)
- Dashboard: Next.js 14+ (App Router)
- Database: PostgreSQL + pgvector (untuk AI)
- ORM: Prisma
- Message Broker: RabbitMQ (topic exchange)
- AI Gateway: OpenAI-compatible (4 lane: LLM, EMBED, RAG, RERANK)
- Object Storage: S3-compatible
- Monitoring: Prometheus metrics
- Circuit Breaker: Opossum

---

## 2. Infrastruktur & Deployment

### Docker Compose

Semua 5 service berjalan sebagai container Docker dalam 2 network:
- `govconnect-network` — komunikasi antar service
- `infra-network` — akses ke RabbitMQ, PostgreSQL, dll.

| Service | Container | Port | Memory Limit |
|---------|-----------|------|--------------|
| Channel Service | govconnect-channel-service | 3001 | 512 MB |
| AI Orchestrator | govconnect-ai-service | 3002 | **1 GB** |
| Case Service | govconnect-case-service | 3003 | 512 MB |
| Notification Service | govconnect-notification-service | 3004 | 512 MB |
| Dashboard | govconnect-dashboard | 3000 | 512 MB |

**Volumes:**
- `gc-channel-uploads` → `/app/uploads` (media WhatsApp)
- `gc-ai-uploads` → `/app/uploads` (dokumen knowledge)
- `gc-ai-data` → `/app/data` (data lokal AI)

**Health Check:** Semua service memiliki health check endpoint (`/health`) dengan interval 30 detik.

---

## 3. Alur Pesan End-to-End

### 3.1 Alur Pesan Masuk (WhatsApp → AI → Response)

```
User mengirim pesan via WhatsApp
         │
         ▼
[1] Genfity WA Provider mengirim webhook
         │
         ▼
[2] Channel Service: POST /webhook/whatsapp
    ├── Validasi: signature, bukan group/broadcast/status
    ├── Filter: hanya pesan PRIVATE
    ├── Ekstrak: wa_user_id dari JID, teks pesan
    ├── Cek duplikat message_id
    ├── Simpan ke tabel `messages` (direction=IN, source=WA_WEBHOOK)
    ├── Enforce FIFO 30 (hapus pesan tertua jika >30)
    ├── Update `conversations` (last_message, unread_count++)
    ├── Cek takeover:
    │   ├── JIKA aktif → skip AI, route ke Live Chat dashboard
    │   └── JIKA tidak → set ai_status=queued
    └── Publish RabbitMQ: `whatsapp.message.received`
         │  Payload: {village_id, wa_user_id, channel, message_text, history[30]}
         ▼
[3] AI Orchestrator: consume `whatsapp.message.received`
    ├── Spam detection (pola berulang, URL, konten dewasa)
    ├── Rate limit check (MAX_REPORTS_PER_DAY=5, COOLDOWN=30s)
    ├── Kirim typing indicator ke Channel Service
    ├── Unified Message Processor:
    │   ├── Step 0: Input length guard (maks 4000 karakter)
    │   ├── Step 1: Spam check (pola spam, URL, konten dewasa)
    │   ├── Step 2: Pending state checks (konfirmasi nama/alamat/form/darurat)
    │   ├── Step 3: Fast intent classification (Micro-NLU <8 detik)
    │   ├── Step 4: Response cache check
    │   ├── Step 5: Entity pre-extraction (nama, telp, alamat, RT/RW, ID laporan)
    │   ├── Step 6: RAG retrieval (jika butuh knowledge)
    │   ├── Step 7: Full LLM processing (adaptive prompt + structured JSON output)
    │   ├── Step 8: Anti-hallucination validation
    │   ├── Step 9: External service calls (Case Service jika perlu buat laporan)
    │   └── Step 10: Post-processing (format respons, update profil user)
    └── Publish RabbitMQ: `govconnect.ai.reply`
         │  Payload: {village_id, wa_user_id, channel, reply_text, contacts[], intent}
         ▼
[4] Channel Service: consume `govconnect.ai.reply`
    ├── Simpan ke `messages` (direction=OUT, source=AI)
    ├── Kirim ke WhatsApp via WA Provider
    ├── Simpan ke `send_logs` (status=sent/failed)
    └── Update `conversations` (ai_status=null)
         │
         ▼
[5] User menerima balasan di WhatsApp
```

### 3.2 Alur Webchat

Webchat berbeda — tidak melalui RabbitMQ, melainkan **synchronous REST**:

```
Browser → POST /api/webchat (AI Service langsung)
    ├── Message batching (tunggu 3 detik untuk pesan tambahan)
    ├── Takeover detection (skip AI jika admin sedang reply)
    ├── Proses sama dengan WhatsApp (Unified Message Processor)
    ├── Sync ke Channel Service untuk Live Chat dashboard
    ├── Timeout 25 detik per request
    └── Return response langsung ke browser
```

### 3.3 Alur Status Update (Admin → User)

```
Admin ubah status di Dashboard
         │
         ▼
Dashboard → PATCH Case Service /laporan/:id/status
    ├── Update status di DB (OPEN→PROCESS→DONE/CANCELED/REJECT)
    ├── Buat record complaint_updates (timeline)
    └── Publish RabbitMQ: `govconnect.status.updated`
         │
         ▼
Notification Service consume event
    ├── Build template notifikasi berdasarkan status
    ├── Kirim ke user via Channel Service POST /internal/send
    └── Log ke notification_logs
```

---

## 4. Channel Service (Port 3001)

### 4.1 Tanggung Jawab
- Terima webhook WhatsApp dari Genfity WA Provider
- Simpan semua pesan masuk/keluar (FIFO 30 per user per channel)
- Kelola session WhatsApp per desa (1 nomor WA = 1 desa)
- Live Chat dashboard (admin bisa ambil alih percakapan)
- Media upload & storage
- Kirim pesan keluar via WA Provider

### 4.2 Database Tables

| Tabel | Fungsi |
|-------|--------|
| `messages` | Semua pesan IN/OUT, FIFO 30 per user. Field: village_id, wa_user_id, channel (WHATSAPP\|WEBCHAT), direction (IN\|OUT), source (WA_WEBHOOK\|AI\|SYSTEM\|ADMIN) |
| `send_logs` | Log pengiriman pesan keluar (status: sent/failed) |
| `channel_accounts` | Konfigurasi channel per desa (wa_number, enabled_wa, enabled_webchat) |
| `wa_sessions` | State session WA per desa (instance_name, wa_token, status, wa_number) |
| `wa_settings` | Pengaturan global (auto_read_messages, typing_indicator) |
| `takeover_sessions` | Record admin takeover (admin_id, started_at, ended_at=null saat aktif) |
| `conversations` | Summary percakapan untuk Live Chat (user_name, last_message, unread_count, is_takeover, ai_status) |
| `pending_messages` | Antrian pesan untuk batching/retry |

### 4.3 FIFO 30 Enforcement
- Setiap user/channel hanya menyimpan 30 pesan terbaru
- Optimasi: pengecekan dijalankan setiap 5 pesan (bukan setiap pesan)
- Single SQL DELETE untuk hapus pesan tertua di atas threshold
- Mencegah tabel membengkak sekaligus menyediakan konteks segar untuk AI

### 4.4 Takeover (Admin Live Chat)
1. Admin panggil `POST /internal/takeover/:wa_user_id` → buat record takeover
2. `conversations.is_takeover = true`, `ai_status = null`
3. Pesan masuk skip AI, diarahkan ke dashboard Live Chat
4. Admin kirim pesan langsung via `POST /internal/conversations/:wa_user_id/send`
5. Admin akhiri: `DELETE /internal/takeover/:wa_user_id` → set `ended_at`, `is_takeover=false`
6. AI diaktifkan kembali untuk pesan berikutnya

### 4.5 Session WhatsApp
- 1 session per desa (mapping 1-to-1)
- Alur: buat session → tampilkan QR → scan → ambil nomor WA → konfigurasi webhook
- Status sync via health check dashboard
- Jika session expire, admin scan ulang QR

### 4.6 Endpoint Utama

**Webhook:**
- `POST /webhook/whatsapp` — Terima pesan masuk dari WA Provider

**Internal (antar service):**
- `GET /internal/messages` — Ambil history pesan (limit 30)
- `POST /internal/send` — Kirim pesan WhatsApp
- `POST /internal/typing` — Kirim typing indicator
- `POST /internal/takeover/:wa_user_id` — Mulai takeover
- `DELETE /internal/takeover/:wa_user_id` — Akhiri takeover
- `GET /internal/conversations` — Daftar percakapan (Live Chat)
- `GET /internal/channel-accounts/:village_id` — Konfigurasi channel desa
- `POST /internal/whatsapp/session` — Buat session WA baru
- `GET /internal/whatsapp/qr` — Ambil QR code
- `POST /internal/media/upload` — Upload file media

---

## 5. AI Orchestrator Service (Port 3002)

### 5.1 Prinsip Desain
- **Sebagian besar stateless** — tidak menyimpan data bisnis
- **Pengecualian**: tabel `ai_token_usage` (analitik, fire-and-forget write), `knowledge_vectors`, `document_vectors` (vector DB), `conversation_sessions` (pending state), `rate_limit_blacklist`
- Semua workload AI melalui **AI Gateway OpenAI-compatible** dengan 4 lane terpisah
- Komunikasi ke service lain via REST dan RabbitMQ

### 5.2 Unified Message Processor

Ini adalah **inti pemrosesan AI** — satu fungsi orchestrator yang memproses setiap pesan:

```typescript
processUnifiedMessage(input: ProcessMessageInput): Promise<ProcessMessageResult>
```

**Input:**
```typescript
{
  userId: string        // wa_user_id atau session_id webchat
  message: string       // Teks pesan user
  channel: 'whatsapp' | 'webchat'
  conversationHistory?: Array<{role: 'user'|'assistant', content: string}>
  mediaUrl?: string     // URL foto/dokumen jika ada
  villageId?: string    // Multi-tenancy
}
```

**Output:**
```typescript
{
  success: boolean
  response: string              // Teks balasan untuk user
  guidanceText?: string         // Teks panduan tambahan
  intent: string                // Intent yang terdeteksi
  contacts?: Array<{name, phone}>  // Kontak penting jika relevan
  metadata: {
    processingTimeMs: number
    model?: string
    hasKnowledge: boolean
    knowledgeConfidence?: number
    sentiment?: string
    traceId: string
  }
}
```

**Pipeline dalam Unified Message Processor:**

| Step | Proses | Detail |
|------|--------|--------|
| 0 | Input Length Guard | Maks 4000 karakter (`MAX_INPUT_LENGTH`), tolak pesan terlalu panjang |
| 1 | Spam Check | `isSpamMessage()` — cek pola spam (URL, konten dewasa, karakter berulang) |
| 2 | Pending State Checks | Cek multiple pending states: konfirmasi nama, form layanan online, pengaduan darurat, konfirmasi alamat |
| 3 | Fast Intent Classification | Micro-NLU (<8 detik): tipe pesan, kebutuhan RAG, kategori pengaduan |
| 4 | Response Cache Check | Cek apakah ada respons ter-cache untuk pesan serupa |
| 5 | Entity Pre-extraction | Ekstrak entitas tanpa LLM: nama, telepon, alamat, RT/RW, nomor laporan (LAP-xxx), nomor layanan (LAY-xxx) |
| 6 | RAG Retrieval | Jika butuh knowledge → jalankan Hybrid RAG Pipeline |
| 7 | Full LLM Processing | Bangun adaptive prompt, kirim ke LLM, parse JSON output terstruktur |
| 8 | Anti-hallucination | Validasi respons: deteksi link palsu, data fiktif, cross-ref dengan knowledge |
| 9 | External Service Calls | Panggil Case Service jika perlu (buat laporan, cek status, dll.) |
| 10 | Post-processing | Format untuk channel, update profil user, catat analytics |

### 5.3 Decomposed Handlers

Setiap jenis case ditangani oleh handler terpisah:

| Handler | Fungsi |
|---------|--------|
| `complaint-handler.ts` | Buat pengaduan, update pengaduan, minta pembatalan |
| `service-handler.ts` | Info layanan, buat permohonan layanan |
| `status-handler.ts` | Cek status (LAP-xxx / LAY-xxx) |
| `knowledge-handler.ts` | Jawab pertanyaan dari knowledge base |

### 5.4 Endpoint AI Service

**Chat Processing:**
- `POST /api/webchat` — Proses pesan webchat (rate limit: 15 msg/min)
- `GET /api/webchat/:session_id` — Ambil history session webchat
- `DELETE /api/webchat/:session_id` — Hapus session

**Knowledge Management:**
- `POST /api/knowledge` — Tambah knowledge + generate embedding
- `PUT /api/knowledge/:id` — Update knowledge (re-embed)
- `DELETE /api/knowledge/:id` — Hapus knowledge vector
- `POST /api/knowledge/embed-all` — Bulk embed semua knowledge dari Dashboard
- `POST /api/knowledge/status` — Cek status embedding untuk batch ID

**Unified Search:**
- `POST /api/search` — Combined vector search (knowledge + dokumen)
  - Parameter: `topK` (default 5), `minScore` (default 0.7), `categories`, `sourceTypes` ['knowledge', 'document'], `villageId`

**Document Upload:**
- `POST /api/upload/document` — Upload & proses dokumen (PDF, DOCX, DOC, PPTX, TXT, MD, CSV)
  - Pipeline: Parse → AI Smart Chunking → Batch Embedding → S3 Upload → Vector Store
  - Maks 10 MB per file

**Processing Status (SSE):**
- `GET /api/status/stream/:userId` — Server-Sent Events untuk real-time progress
- `GET /api/status/:userId` — Status saat ini (stage, progress %, estimasi waktu)

**Admin:**
- `POST /admin/cache/clear-all` — Bersihkan semua cache
- `GET /admin/failed-messages` — Daftar pesan gagal
- `POST /admin/failed-messages/:messageId/retry` — Retry pesan gagal
- `POST /admin/nlu/complaint-type-match` — Match kategori pengaduan ke tipe sistem

**Analytics:**
- `GET /stats/token-usage/summary` — Ringkasan penggunaan token
- `GET /stats/token-usage/by-period` — Per hari/minggu/bulan
- `GET /stats/token-usage/by-model` — Per model AI
- `GET /stats/token-usage/by-village` — Per desa
- `GET /stats/analytics/intents` — Distribusi intent
- `GET /stats/analytics/flow` — Pola alur percakapan
- `GET /stats/analytics/knowledge` — Statistik knowledge base
- `GET /stats/golden-set` — Evaluasi golden set (quality benchmark)

**Testing:**
- `POST /api/testing/ping` — Ping semua lane AI gateway
- `POST /api/testing/chat` — Test chat processing

---

## 6. Case Service (Port 3003)

### 6.1 Tanggung Jawab
- CRUD pengaduan (complaints) & permohonan layanan (service_requests)
- Katalog layanan per desa (dynamic form fields)
- Status workflow & timeline update
- Deduplication (cegah laporan ganda)
- Type resolution via Micro-LLM (matching kategori ke tipe)
- History user

### 6.2 Status Workflow

```
                   ┌─────────────┐
                   │    OPEN     │ ← Status awal
                   └──────┬──────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │ PROCESS  │ │ CANCELED │ │  REJECT  │
       └────┬─────┘ └──────────┘ └──────────┘
            │
            ▼
       ┌──────────┐
       │   DONE   │
       └──────────┘
```

- **OPEN** → Status awal saat dibuat
- **PROCESS** → Admin mulai menangani
- **DONE** → Selesai ditangani (bisa ada result_file_url)
- **CANCELED** → Dibatalkan oleh user atau admin
- **REJECT** → Ditolak oleh admin

### 6.3 Complaint (Pengaduan)

**Membuat Pengaduan (dari AI Service):**
1. AI Service panggil `POST /laporan/create`
2. **Deduplication**: cek user + kategori yang sama dalam 24 jam (similarity threshold: 70% overall, 60% alamat, 70% deskripsi, hanya cek complaint aktif) → tolak jika duplikat
3. **Type Resolution**: jika `type_id` tidak disediakan, gunakan Micro-LLM untuk semantic matching kategori user terhadap daftar `complaint_types` di DB
   - Confidence >50% → auto-assign
   - Confidence <50% → fallback ke "Lainnya"
4. **Flag dari tipe**: `is_urgent`, `require_address`, `send_important_contacts`
5. Buat record dengan status=OPEN
6. Generate `complaint_id` unik (format: `LAP-YYYYMMDD-XXX`, contoh: `LAP-20260417-001`)
7. Publish event `govconnect.complaint.created`
8. Jika `is_urgent=true` → publish juga `govconnect.urgent.alert`

**Data Pengaduan:**
```
complaint_id, wa_user_id, channel, channel_identifier, kategori, 
category_id, type_id, deskripsi (10-1000 char), alamat, rt_rw, 
foto_url (single/array), is_urgent, require_address, reporter_name, 
reporter_phone, village_id, status, admin_notes
```

### 6.4 Service Request (Permohonan Layanan)

**Penting**: Layanan **tidak boleh** dibuat via chat. User hanya bisa mendapatkan info & link formulir via chat, lalu mengisi form di website/dashboard.

**Alur:**
1. User tanya via chat → AI beri info persyaratan + link formulir online
2. User isi form online → `POST /service-requests`
3. Generate `request_number` (format: `LAY-YYYYMMDD-XXX`, contoh: `LAY-20260417-001`)
4. Generate `edit_token` (berlaku 48 jam) untuk user edit data
5. Admin proses dan update status

**Service Catalog:**
- `service_categories` — Grup layanan per desa
- `services_dynamic` — Item layanan (nama, slug, mode: online/offline/both)
- `service_requirements` — Field form dinamis (file, text, textarea, select, radio, date, number)
  - Setiap field: label, field_type, is_required, options_json, help_text, order_index

### 6.5 Complaint Types & Categories

Hierarki 2 level per desa:
```
complaint_categories (per village_id)
  └── complaint_types (per category)
        ├── name
        ├── is_urgent (bool)
        ├── require_address (bool)
        ├── send_important_contacts (bool)
        └── important_contact_category (untuk auto-send kontak terkait)
```

### 6.6 Endpoint Utama

**Pengaduan:**
- `POST /laporan/create` — Buat pengaduan
- `GET /laporan` — List pengaduan (filter: status, kategori, village_id, wa_user_id)
- `GET /laporan/:id` — Detail pengaduan
- `POST /laporan/:id/check` — Cek status + validasi kepemilikan
- `PATCH /laporan/:id/status` — Update status (admin)
- `POST /laporan/:id/cancel` — Batalkan (user)
- `PATCH /laporan/:id/by-user` — Update data (user)

**Layanan:**
- `GET /services` — Katalog layanan
- `GET /services/by-slug?slug=xxx` — Cari layanan by slug
- `GET /services/:id/requirements` — Form fields layanan
- `POST /service-requests` — Buat permohonan layanan
- `GET /service-requests/by-token?token=xxx` — Akses via edit token (public)
- `PATCH /service-requests/:id/by-token` — Update via edit token (public)
- `PATCH /service-requests/:id/status` — Update status (admin)

**History:**
- `GET /user/:wa_user_id/history` — Semua pengaduan + layanan user

**Statistik:**
- `GET /statistics/overview` — Ringkasan per desa (count per status)

---

## 7. Notification Service (Port 3004)

### 7.1 Tanggung Jawab
- Consumer event dari Case Service (async via RabbitMQ)
- Build template notifikasi berdasarkan event type
- Kirim notifikasi WhatsApp via Channel Service
- Log semua notifikasi untuk audit trail

### 7.2 Event yang Di-consume

| Event (Routing Key) | Aksi | Template |
|---------------------|------|----------|
| `govconnect.status.updated` | Kirim notifikasi status ke user | Template per status: PROCESS, DONE, CANCELED, REJECT |
| `govconnect.service.requested` | Konfirmasi permohonan layanan | "🎫 Permohonan Layanan Diterima — No: LAY-xxx" |
| `govconnect.urgent.alert` | Alert ke admin WA (jika ENABLE_URGENT_WA_ALERT=true) | "🚨 LAPORAN DARURAT 🚨 — [detail]" |

**Catatan:** `govconnect.ai.reply` **TIDAK** di-consume oleh Notification Service — Channel Service langsung mengirim reply AI ke user. Jika Notification juga mengirim, user akan menerima 2 pesan.

### 7.3 Send Flow

```
Event masuk via RabbitMQ
    ├── Route ke handler berdasarkan routing_key
    ├── Build message dari template
    ├── Cek channel:
    │   ├── WEBCHAT → skip (log as "skipped", tidak ada push notification)
    │   └── WHATSAPP → kirim via Circuit Breaker
    │       └── POST Channel Service /internal/send
    │           ├── Retry 3x dengan exponential backoff
    │           └── Circuit breaker: track failures/successes
    └── Log ke notification_logs (status: sent/failed/skipped)
```

### 7.4 Template Notifikasi

| Status | Emoji | Pesan |
|--------|-------|-------|
| PROCESS | 🔄 | "Laporan *ID* sedang ditangani" |
| DONE | ✅ | "Laporan *ID* telah selesai ditangani. [admin_notes] [result_file_url]" |
| CANCELED | 🔴 | "Laporan *ID* dibatalkan" |
| REJECT | ❌ | "Laporan *ID* ditolak" |
| URGENT | 🚨 | "LAPORAN DARURAT — [detail lengkap] — Mohon segera ditindaklanjuti!" |

### 7.5 Database

Hanya 1 tabel: `notification_logs`
- id, channel, channel_identifier, wa_user_id, village_id, message_text, notification_type (ai_reply\|complaint_created\|service_requested\|status_updated\|urgent_alert), status (sent\|failed\|skipped), error_msg, sent_at

---

## 8. Dashboard (Port 3000)

### 8.1 Tanggung Jawab
- Admin UI: profil desa, knowledge base, nomor penting, katalog layanan
- Public form untuk permohonan layanan online
- Internal API yang digunakan oleh AI Service dan Channel Service

### 8.2 Internal API (untuk service lain)

Semua menggunakan header `x-internal-api-key`.

| Endpoint | Method | Consumer | Fungsi |
|----------|--------|----------|--------|
| `/api/internal/knowledge` | GET/POST | AI Service | Fetch knowledge entries untuk embedding & RAG |
| `/api/internal/knowledge/categories` | GET | AI Service | Daftar kategori knowledge per desa |
| `/api/internal/knowledge/gaps` | POST | AI Service | Catat pertanyaan yang tidak bisa dijawab |
| `/api/internal/knowledge/conflicts` | POST/GET | AI Service | Catat & list konflik data antar sumber |
| `/api/internal/village-profile` | GET | AI Service | Profil desa (nama, alamat, gmaps, jam operasional) |
| `/api/internal/documents` | GET/POST/PUT | AI Service | Manajemen dokumen untuk embedding |
| `/api/internal/documents/[id]/chunks` | GET/POST | AI Service | Chunk dokumen |
| `/api/internal/important-contacts` | GET | AI Service | Nomor penting per desa (per kategori) |
| `/api/internal/settings` | GET/POST | AI Service | Pengaturan sistem |

### 8.3 Database Tables (Relevan)

**Knowledge:**
- `knowledge_base` — id, title, content, category, keywords[], is_active, priority, village_id
- `knowledge_categories` — id, village_id, name, is_default
- `knowledge_documents` — id, filename, file_url, status, total_chunks, village_id, category_id
- `document_chunks` — id, document_id, chunk_index, content, page_number, section_title
- `knowledge_gaps` — Pertanyaan yang tidak terjawab (query_hash deduplicated, hit_count)
- `knowledge_conflicts` — Konflik data antar sumber (auto_resolved flag)

**Village:**
- `villages` — id, name, slug, is_active
- `village_profiles` — village_id, name, address, gmaps_url, operating_hours (JSON)
- `important_contact_categories` — per village
- `important_contacts` — per category (name, phone, description)

### 8.4 Flow Data untuk Analytics di Dashboard

Dashboard mengambil data analytics dari beberapa sumber:

1. **Token Usage** → REST call ke AI Service: `GET /stats/token-usage/*`
2. **Intent Distribution** → REST call ke AI Service: `GET /stats/analytics/intents`
3. **Statistik Pengaduan/Layanan** → REST call ke Case Service: `GET /statistics/overview`
4. **Percakapan Live Chat** → REST call ke Channel Service: `GET /internal/conversations`
5. **Knowledge Gaps** → Dari DB dashboard sendiri: tabel `knowledge_gaps`
6. **Knowledge Conflicts** → Dari DB dashboard sendiri: tabel `knowledge_conflicts`

**Data yang sudah diproses:** Token usage, intent analytics, flow analytics, category stats
**Data yang belum diproses (raw):** Knowledge gaps belum ada auto-resolution, conflict detection masih manual review di dashboard

---

## 9. RabbitMQ — Event-Driven Architecture

### 9.1 Konfigurasi

| Parameter | Nilai |
|-----------|-------|
| Exchange | `govconnect.events` |
| Exchange Type | `topic` |
| Durable | Yes |
| Prefetch (AI) | 5 (proses 5 pesan concurrent) |

### 9.2 Event Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXCHANGE: govconnect.events                    │
│                         (topic, durable)                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     │                       │                       │
     ▼                       ▼                       ▼
┌─────────────┐  ┌────────────────────┐  ┌───────────────────────┐
│ AI Service  │  │ Channel Service    │  │ Notification Service  │
│ Queue:      │  │ Queues:            │  │ Queue:                │
│ ai-service. │  │ channel-service.   │  │ notification-service. │
│ whatsapp.   │  │ ai.reply           │  │ events.#              │
│ message.#   │  │ channel-service.   │  │                       │
│             │  │ ai.error           │  │ Consumes:             │
│ Consumes:   │  │ channel-service.   │  │ ─ status.updated      │
│ ─ whatsapp. │  │ message.status     │  │ ─ service.requested   │
│   message.  │  │                    │  │ ─ urgent.alert        │
│   received  │  │ Consumes:          │  │ ─ complaint.created   │
│             │  │ ─ ai.reply         │  │   (legacy, disabled)  │
│ Publishes:  │  │ ─ ai.error         │  │                       │
│ ─ ai.reply  │  │ ─ message.status   │  └───────────────────────┘
│ ─ ai.error  │  │                    │
│ ─ message.  │  │ Publishes:         │
│   status    │  │ ─ whatsapp.message │
│             │  │   .received        │
└─────────────┘  │ ─ whatsapp.message │
                 │   .sent            │
                 └────────────────────┘

CASE SERVICE publishes:
─ govconnect.complaint.created
─ govconnect.service.requested
─ govconnect.status.updated
─ govconnect.urgent.alert
```

### 9.3 Retry & Error Handling (AI Service)

**Layer 1: Publish Retry Queue**
- Untuk publish RabbitMQ yang gagal
- Max 5 retry, delay 5 detik antar retry
- Fire-and-forget jika semua retry habis

**Layer 2: AI Message Retry Queue**
- Untuk pesan yang gagal diproses AI (LLM/RAG error)
- Cron setiap 10 menit (bukan immediate)
- Max 10 retry
- Setelah max → simpan ke failed messages (admin dashboard)

**Layer 3: Failed Messages Storage**
- Max 1000 pesan tersimpan
- Admin bisa retry manual via `POST /admin/failed-messages/:id/retry`
- Status tracking: 'failed' | 'retrying' | 'resolved'

### 9.4 Connection Management
- Exponential backoff reconnection (base 1s, max 30s, jitter 30%)
- Infinite retry attempts
- Graceful shutdown support

---

## 10. Pipeline RAG (Retrieval-Augmented Generation)

### 10.1 Arsitektur Hybrid RAG

GovConnect menggunakan **three-tier hybrid search** dengan 4 fase:

```
User Query
    │
    ▼
[FASE 1] Query Intent Classification
    ├── Regex pre-filter (greeting, konfirmasi → skip RAG)
    ├── Micro-LLM intent: 'skip' | 'required' | 'optional'
    └── Spam detection (30+ char berulang, URL, konten dewasa)
    │
    ▼
[FASE 2] Query Expansion (via RAG Lane)
    ├── Micro-LLM expand query dengan 3-5 sinonim
    ├── Prompt: "Kamu adalah query expander untuk pencarian dokumen
    │           layanan pemerintah Indonesia..."
    ├── Model: RAG lane (flash-lite model)
    ├── Temperature: 0.2, maxTokens: 150
    ├── Cache: TTL 15 menit, max 200 entries
    └── Fallback: query asli jika gagal
    │   Contoh: "cara bikin KTP" → "cara bikin KTP kartu tanda
    │           penduduk identitas pembuatan prosedur persyaratan"
    ▼
[FASE 3] Hybrid Search (Vector + Keyword + RRF)
    ├── Vector Search (pgvector):
    │   ├── Generate embedding dari expanded query
    │   ├── Cosine similarity via operator <=>
    │   ├── Search tabel: knowledge_vectors + document_vectors
    │   └── Filter: village_id, min_score, categories
    │
    ├── Keyword Search (BM25-style):
    │   ├── Term frequency scoring: log(1 + match_count)
    │   ├── Exact phrase match bonus: +3.0
    │   └── Partial phrase match (consecutive words): +1.5
    │
    └── Reciprocal Rank Fusion (RRF):
        ├── Formula: score = (vectorRRF × 0.6) + (keywordRRF × 0.4)
        ├── RRF per item: 1 / (k + rank), k=60
        └── Fetch candidates: max(topK × 2, ragLLMRerankMaxCandidates)
    │
    ▼
[FASE 4] LLM-Based Reranking
    ├── Jika RERANK_ENABLED=true:
    │   ├── Kirim query + top candidates ke Reranker model
    │   ├── Model: cohere/rerank-3-turbo (via RERANK lane)
    │   ├── Return normalized relevance scores (0-1)
    │   ├── Soft threshold: max(minScore × 0.75, 0.2)
    │   └── Fallback ke RRF jika reranker gagal
    └── Jika disabled: gunakan RRF scoring
    │
    ▼
[POST-PROCESSING]
    ├── Deduplication (Jaccard similarity):
    │   ├── ≥70% overlap → hapus duplikat skor rendah
    │   ├── 35-69% overlap → tandai sebagai conflict group
    │   └── <35% → tidak terkait, pertahankan keduanya
    │
    ├── Soft Boosting:
    │   ├── Quality score boost: quality_score × 0.03
    │   └── Category match boost: +0.02 jika NLU match
    │
    ├── DB-First Override (untuk query profil desa):
    │   ├── Fetch profil dari Dashboard API
    │   ├── Prepend "=== DATA RESMI DARI DATABASE ==="
    │   └── Auto-resolve conflicts (DB = authoritative)
    │
    └── Context Compression:
        ├── Max 5000 karakter
        ├── Split per sentence boundary
        ├── Conflict markers: ⚠️ jika ada data bertentangan
        └── Format: "[KATEGORI] Title\nContent\n..."
```

### 10.2 Parameter Konfigurasi RAG

| Parameter | Nilai Default | Keterangan |
|-----------|---------------|------------|
| `DEFAULT_TOP_K` | 8 | Ambil lebih banyak untuk dedup pass |
| `DEFAULT_MIN_SCORE` | 0.65 | Baseline cosine similarity |
| `MIN_EFFECTIVE_SCORE` | 0.45 | Floor threshold (cegah cascade) |
| `MAX_CONTEXT_LENGTH` | 5000 | Maks karakter konteks untuk LLM |
| `DEFAULT_RERANK_MIN_SCORE` | 0.2 | Floor confidence reranker |
| `RAG_RETRIEVAL_CACHE_TTL` | 300s (5 min, configurable) | Cache TTL untuk hasil retrieval |
| `RAG_LLM_RERANK_MAX_CANDIDATES` | 12 | Maks kandidat untuk reranking |
| `EMBED_DIMENSIONS` | 768 | Dimensi embedding vector |

### 10.3 Vector Database

**Storage:** PostgreSQL + ekstensi pgvector

**Tabel `knowledge_vectors`:**
- id (sama dengan ID di dashboard.knowledge_base)
- village_id, title, content, category, keywords[]
- embedding: `vector(768)` — cosine similarity
- quality_score (default 1.0), usage_count, retrieval_count, last_retrieved

**Tabel `document_vectors`:**
- document_id → referensi ke dashboard.knowledge_documents
- chunk_index, content, section_title, page_number
- embedding: `vector(768)`

**SQL Query (simplified):**
```sql
SELECT id, content, title, category,
       1 - (embedding <=> query_embedding::vector) as similarity
FROM knowledge_vectors
WHERE 1 - (embedding <=> query_embedding::vector) >= min_score
  AND (village_id = ? OR village_id IS NULL)
ORDER BY similarity DESC
LIMIT top_k
```

### 10.4 Knowledge Embedding Pipeline

```
Dashboard admin menambah/edit knowledge
    │
    ▼
Dashboard → POST AI Service /api/knowledge
    ├── Teks pendek (<1500 char) → single embedding
    └── Teks panjang (>1500 char) → AI Smart Chunking:
        ├── LLM membaca seluruh dokumen
        ├── Tentukan split boundary optimal
        ├── Assign judul per chunk
        ├── Assign kategori per chunk
        └── Fallback ke semantic chunking jika AI gagal
    │
    ▼
Generate embedding per chunk via EMBED lane
    │
    ▼
Simpan ke knowledge_vectors / document_vectors (pgvector)
```

### 10.5 Document Processing Pipeline

**Format Didukung:** PDF, DOCX, DOC, PPTX, PPT, TXT, MD, CSV

**Library Parser:**
- PDF → `pdf.js-extract`
- DOCX → `mammoth`
- DOC → `word-extractor`
- PPTX/PPT → `officeparser`
- TXT/MD/CSV → direct read

**Alur:**
1. Upload file (max 10 MB) via `POST /api/upload/document`
2. Parse konten teks dari file
3. AI Smart Chunking (LLM determine split points, titles, categories)
4. Fallback: Semantic Chunking (sentence boundary based)
5. Generate batch embeddings untuk semua chunks
6. Upload original file ke S3
7. Simpan chunk vectors ke `document_vectors`

### 10.6 Knowledge Gap Tracking

Ketika AI tidak bisa menjawab pertanyaan user:
- Query dikirim ke Dashboard: `POST /api/internal/knowledge/gaps`
- Deduplicated by SHA-256 hash dari normalized query
- `hit_count` increment jika query serupa terulang
- Admin bisa review di dashboard dan menambah knowledge yang belum ada

### 10.7 Knowledge Conflict Detection

Ketika RAG menemukan data bertentangan dari sumber berbeda:
- Conflict dilaporkan ke Dashboard: `POST /api/internal/knowledge/conflicts`
- Deduplicated by order-independent hash dari pair sumber
- Status: open → resolved/auto_resolved/ignored
- Auto-resolved jika data DB (profil desa) di-inject sebagai authoritative

---

## 11. Sistem Intent & NLU

### 11.1 Daftar Intent (17 Jenis)

| Intent | Deskripsi | Handling |
|--------|-----------|----------|
| `GREETING` | Sapaan (halo, hai, assalamualaikum) | Fast path → template response |
| `THANKS` | Ucapan terima kasih | Fast path → template |
| `FAREWELL` | Perpisahan (dah gaada, udah cukup) | Fast path → template |
| `CONFIRMATION` | Ya, iya, oke, lanjut, setuju | Lanjutkan flow pending |
| `REJECTION` | Tidak, gak, batal, jangan | Cancel flow pending |
| `CREATE_COMPLAINT` | Mau lapor masalah/pengaduan | → complaint-handler: kumpulkan data → Case Service |
| `UPDATE_COMPLAINT` | Update data pengaduan existing | → complaint-handler: update |
| `CANCEL_COMPLAINT` | Batalkan pengaduan | → complaint-handler: cancel |
| `CREATE_SERVICE_REQUEST` | Mau buat/urus layanan/surat | → service-handler: beri info + link form |
| `UPDATE_SERVICE_REQUEST` | Update permohonan layanan | → service-handler: beri edit token link |
| `CANCEL_SERVICE_REQUEST` | Batalkan permohonan layanan | → Case Service cancel |
| `SERVICE_INFO` | Tanya syarat/prosedur/biaya layanan | → service-handler: ambil requirements dari DB |
| `CHECK_STATUS` | Cek status laporan/layanan (LAP-xxx/LAY-xxx) | → status-handler: query Case Service |
| `HISTORY` | Riwayat semua laporan/layanan | → Case Service user history |
| `KNOWLEDGE_QUERY` | Pertanyaan tentang desa (jam buka, lokasi, dll) | → RAG retrieval + LLM |
| `QUESTION` | Pertanyaan umum | → RAG + LLM |
| `UNKNOWN` | Tidak terklasifikasi | → LLM dengan full context |

### 11.2 Two-Layer Intent Detection

**Layer 1: Micro-NLU Classifiers (Cepat, <8 detik kumulatif)**

Fungsi-fungsi classifier ringan yang menggunakan pattern matching + Micro-LLM:

| Classifier | Fungsi |
|-----------|--------|
| `classifyGreeting(message)` | Deteksi sapaan (regex + LLM fallback) |
| `classifyFarewell(message)` | Deteksi perpisahan |
| `classifyConfirmation(message)` | Ya/tidak + konteks (ConfirmationResult) |
| `classifyKnowledgeSubtype(query)` | Sub-klasifikasi: time/location/requirement/process/catalog |
| `extractNameViaNLU(message)` | Ekstrak nama orang dari teks |
| `matchServiceSlug(query, villageId)` | Match query ke slug layanan |
| `matchComplaintType(kategori, types)` | Match kategori ke tipe pengaduan (semantic) |
| `analyzeAddress(text)` | Analisis alamat (lengkap/tidak, ada RT/RW) |
| `matchContactQuery(query, contacts)` | Match query ke kontak penting |
| `classifyUpdateIntent(message)` | Klasifikasi: update lokasi/deskripsi/lainnya |
| `validateResponseAgainstKnowledge(response, items)` | Validasi respons terhadap knowledge |

**Layer 2: Full LLM (via AI Gateway)**

Untuk intent kompleks yang tidak bisa diselesaikan Micro-NLU:
- System prompt + conversation history + knowledge context
- Output: structured JSON dengan intent, confidence, fields, reply_text
- Model: LLM lane (configurable, misal `openai/gpt-4o-mini`)

### 11.3 Pattern Matching (Fallback Regex)

Digunakan sebagai fallback jika LLM tidak tersedia:

**GREETING:** `halo|hai|hi|hello|hey|selamat (pagi|siang|sore|malam)|assalamualaikum|permisi`

**CONFIRMATION:** `ya|iya|oke|ok|okay|baik|siap|betul|benar|lanjut|setuju|sudah|udah|cukup`

**REJECTION:** `tidak|nggak|gak|ga|enggak|no|nope|jangan|batal|cancel|belum`

**CREATE_COMPLAINT:** `mau lapor(kan)|ada masalah|keluhan|aduan|komplain` + infrastruktur spesifik: jalan rusak, lampu mati, sampah menumpuk, banjir

**SERVICE_INFO:** `syarat|persyaratan|prosedur|biaya|cara buat|proses`

**CHECK_STATUS:** `cek|check|status|perkembangan|progress` + regex: `\bLAP-\d{8}-\d{3}\b` (pengaduan) atau `\bLAY-\d{8}-\d{3}\b` (layanan)

**KNOWLEDGE_QUERY:** `jam buka|tutup|operasional|dimana|lokasi|alamat|syarat|dokumen|berkas|bagaimana|gimana cara|prosedur|layanan apa saja`

### 11.4 Unified Classification Result

```typescript
{
  intent: IntentType           // Salah satu dari 17 intent
  confidence: number           // 0.5 - 1.0
  needsRAG: boolean            // Apakah butuh knowledge retrieval
  categories?: string[]        // Kategori pengaduan jika relevan
  entities: {
    name?: string
    phone?: string
    address?: string
    rt_rw?: string
    complaint_id?: string      // LAP-xxx
    service_id?: string        // LAY-xxx
  }
}
```

---

## 12. Prompt Engineering & Adaptive Prompt

### 12.1 Persona AI: "Gana"

AI menggunakan persona **Gana** — petugas desa yang ramah, menggunakan bahasa Indonesia campuran formal/informal.

### 12.2 Modular Prompt Blocks

Prompt dibangun secara **modular** — hanya block yang relevan dengan intent yang disertakan:

| Block | Token Est. | Isi |
|-------|-----------|-----|
| `PROMPT_CORE` | ~350 | Identitas Gana, waktu WIB, aturan bahasa, safety rules, multi-tenancy |
| `PROMPT_RULES_FAREWELL` | ~80 | Bedakan farewell vs thanks |
| `PROMPT_RULES_SERVICE` | ~250 | Layanan hanya via form website, tidak via chat |
| `PROMPT_RULES_COMPLAINT` | ~60 | Pengaduan via chat, foto max 5 |
| `PROMPT_RULES_STATUS` | ~120 | Label status (OPEN→Menunggu, PROCESS→Sedang, DONE→Selesai, dll.) |
| `PROMPT_RULES_CANCEL` | ~20 | Selalu minta konfirmasi sebelum cancel |
| `PROMPT_RULES_KNOWLEDGE` | ~50 | Format jadwal, tampilkan semua item (jangan "dll") |
| `SYSTEM_PROMPT_PART2` | ~100 | Konteks tambahan (history, profil user) |
| `SYSTEM_PROMPT_PART2_5` | ~50 | Konteks knowledge base |
| `PART3_INTENT_HEADER` | ~30 | Definisi intent |
| `PART3_SERVICE_INTENTS` | ~100 | Intent layanan detail |
| `PART3_COMPLAINT_INTENTS` | ~100 | Intent pengaduan detail |
| `PART3_GENERAL_INTENTS` | ~80 | CHECK_STATUS, HISTORY, KNOWLEDGE_QUERY |
| `PART3_CATEGORIES` | Dynamic | Kategori pengaduan dari DB (per desa) |
| `PART3_INTENT_FALLBACK` | ~30 | Fallback handling |
| `CASES_GREETING_CORE` | ~80 | Contoh kasus greeting |
| `CASES_EDGE` | ~60 | Edge cases |
| `CASES_KNOWLEDGE` | ~80 | Contoh kasus knowledge |
| `CASES_SERVICE` | ~80 | Contoh kasus layanan |
| `CASES_COMPLAINT` | ~80 | Contoh kasus pengaduan |
| `CASES_STATUS` | ~60 | Contoh kasus cek status |

### 12.3 Adaptive Composition

Berdasarkan focus intent yang terdeteksi di Step 1, hanya block relevan yang dimasukkan:

| Focus | Blocks yang Disertakan |
|-------|----------------------|
| `greeting` | CORE + FAREWELL_RULES + CASES_GREETING_CORE + general intents |
| `complaint` | CORE + FAREWELL + COMPLAINT + CANCEL + STATUS + categories + CASES_COMPLAINT |
| `service` | CORE + SERVICE + CANCEL + STATUS + service catalog + CASES_SERVICE |
| `knowledge` | CORE + KNOWLEDGE + catalog + CASES_KNOWLEDGE |
| `status` | CORE + STATUS + CASES_STATUS |
| `cancel` | CORE + CANCEL + STATUS |
| `full` | Semua blocks |

**Penghematan token:** ~40-60% dibanding prompt monolitik.

### 12.4 Output Schema (Required JSON dari LLM)

```json
{
  "intent": "CREATE_COMPLAINT",
  "confidence": 0.95,
  "fields": {
    "kategori": "Jalan Rusak",
    "alamat": "Jl. Merdeka RT 02 RW 03",
    "deskripsi": "Jalan berlubang besar di depan kantor pos",
    "rt_rw": "02/03",
    "service_id": null,
    "request_number": null,
    "complaint_id": null
  },
  "reply_text": "Baik Pak/Bu, laporan tentang jalan rusak di Jl. Merdeka RT 02/03 akan segera kami proses...",
  "guidance_text": "",
  "needs_knowledge": false
}
```

### 12.5 Aturan Penting dalam Prompt

1. **Jangan ngarang data** — Jika tidak ada di knowledge base, katakan belum tersedia
2. **Multi-tenancy** — Setiap respons hanya mengacu pada data desa terkait
3. **Bedakan "lapor" (pengaduan) vs "daftar" (layanan)** — Pengaduan via chat, layanan via form
4. **Data resmi DB selalu otoritatif** — Profil desa, nomor kontak dari DB = prioritas tertinggi
5. **Jangan tampilkan "dll"** — Selalu tampilkan semua item lengkap

---

## 13. Anti-Hallucination & Quality Control

### 13.1 Deteksi Halusinasi

Sistem mendeteksi pola-pola halusinasi umum:

| Pattern | Contoh | Aksi |
|---------|--------|------|
| Link palsu | `[link formulir]`, `[website]`, `[cek status online]` | Strip dari respons |
| Nomor telepon fiktif | Nomor yang tidak ada di knowledge base | Flag + re-check |
| Alamat fiktif | Alamat yang tidak ada di profil desa | Flag + re-check |
| Formulir online fiktif | "formulir pengaduan secara online" (padahal tidak ada) | Strip + perbaiki |
| Cost/biaya palsu | Menyebut biaya yang tidak ada di DB | Flag |

### 13.2 Anti-Hallucination Pipeline

```
Respons dari LLM
    │
    ▼
detectHallucinationSignals(response)
    ├── Cek link palsu (regex bracket patterns)
    ├── Cek nomor telepon (cross-ref dengan knowledge)
    ├── Cek alamat (cross-ref dengan profil desa)
    ├── Cek ada knowledge dalam konteks?
    └── Return: { hasFakeLinks, hasUnverifiedPhones, hasUnverifiedAddress, ... }
    │
    ▼
needsAntiHallucinationRetry()?
    ├── JIKA ya → tambahkan instruksi anti-hallucination ke prompt, retry LLM
    └── JIKA tidak → lanjut
    │
    ▼
sanitizeFakeLinks(response)
    └── Hapus semua bracket patterns dari respons final
```

### 13.3 JSON Repair

Ketika LLM menghasilkan JSON terpotong/rusak:
1. **Standard parse** → `JSON.parse()`
2. **Bracket completion** → Tambahkan `}` atau `]` yang hilang
3. **Field extraction via regex** → Bangun objek baru dari field yang diekstrak

**⚠️ Temuan Audit (Temuan 24):** Strategi ke-3 berisiko menggabungkan data dari percobaan berbeda. Respons yang diperbaiki sebaiknya ditandai dan dilog.

### 13.4 Response Validation Against Knowledge

```typescript
validateResponseAgainstKnowledge(response, knowledgeItems)
```
- Cross-check fakta dalam respons terhadap item knowledge yang diambil
- Return: apakah respons konsisten dengan sumber

### 13.5 Golden Set Evaluation

Sistem benchmark kualitas AI:
- **Golden Set**: Kumpulan test case dengan expected intent, fields, response
- **Evaluasi**: `POST /stats/golden-set/run` → jalankan semua test case
- **Metrics**: Intent accuracy, field extraction accuracy, response appropriateness, execution time
- Digunakan setelah perubahan prompt atau model untuk memastikan tidak ada regresi

---

## 14. AI Gateway 4-Lane Architecture

### 14.1 Konsep

AI Service menggunakan **4 lane gateway** yang masing-masing independen — bisa menggunakan provider dan model berbeda:

```
┌──────────────────────────────────────────────────────────┐
│                    AI GATEWAY (OpenAI-compatible)          │
│                                                           │
│  ┌───────────┐  ┌──────────┐  ┌─────────┐  ┌──────────┐ │
│  │  LANE 1   │  │  LANE 2  │  │ LANE 3  │  │  LANE 4  │ │
│  │   LLM     │  │  EMBED   │  │   RAG   │  │ RERANK   │ │
│  │           │  │          │  │         │  │          │ │
│  │ Chat      │  │ Embedding│  │ Query   │  │ Reranker │ │
│  │ Completion│  │ Generate │  │ Rewrite │  │ Model    │ │
│  │           │  │          │  │         │  │          │ │
│  │ gpt-4o-   │  │ text-    │  │ flash-  │  │ rerank-  │ │
│  │ mini      │  │ embed-3  │  │ lite    │  │ 3-turbo  │ │
│  └───────────┘  └──────────┘  └─────────┘  └──────────┘ │
│                                                           │
│  Provider: openrouter | sumopod | vercel | cloudflare     │
│  API Key Rotation: round-robin, fallback on 429           │
│  OpenRouter: site URL, app name, provider order           │
└──────────────────────────────────────────────────────────┘
```

### 14.2 Konfigurasi per Lane

| Lane | ENV Prefix | Fungsi | Default Model | Temperature |
|------|-----------|--------|---------------|-------------|
| LLM | `LLM_*` | Chat completions (NLU utama) | Configurable | 0.3 |
| EMBED | `EMBED_*` | Generate embedding vectors | text-embedding-3-small | - |
| RAG | `RAG_*` | Query expansion/rewrite | Flash-lite model | 0.2 |
| RERANK | `RERANK_*` | Reranking hasil retrieval | cohere/rerank-3-turbo | - |

### 14.3 API Key Rotation

- Mendukung multiple API keys (comma-separated di ENV)
- Rotasi round-robin per request
- Automatic fallback ke key berikutnya saat 429 (rate limit)
- Usage tracking per key per menit

### 14.4 Provider Support

| Provider | API Compatible | Fitur Khusus |
|----------|---------------|--------------|
| OpenRouter | ✅ OpenAI | Provider order, ZDR mode, app name header |
| Sumopod | ✅ OpenAI | - |
| Vercel | ✅ OpenAI | - |
| Cloudflare | ✅ OpenAI | - |
| Direct | ✅ OpenAI | Langsung ke provider (Google, OpenAI, dll.) |

### 14.5 Layer Types (untuk Token Usage Tracking)

| Layer Type | Keterangan |
|-----------|-----------|
| `full_nlu` | Full LLM processing (main chat) |
| `micro_nlu` | Micro-LLM classifiers |
| `embedding` | Embedding generation |
| `rag_expand` | Query expansion/rewrite |
| `rerank` | Reranking |

---

## 15. Manajemen Case: Complaint & Service Request

### 15.1 Alur Pengaduan via Chat (End-to-End)

```
User: "Saya mau lapor jalan rusak di depan kantor pos RT 02/03"
    │
    ▼
[NLU] Intent: CREATE_COMPLAINT
      Fields: {kategori: "Jalan Rusak", alamat: "depan kantor pos", rt_rw: "02/03"}
    │
    ▼
[AI] Cek kelengkapan data:
     ✓ kategori: "Jalan Rusak"
     ✓ alamat: "depan kantor pos"
     ✓ rt_rw: "02/03"
     ✗ deskripsi: belum detail
    │
    ▼
[AI] Reply: "Baik Pak/Bu, bisa jelaskan lebih detail masalahnya?"
    │
    ▼
User: "Jalan berlubang besar, sudah beberapa bulan, berbahaya untuk pengendara"
    │
    ▼
[AI] Semua field lengkap → panggil Case Service:
     POST /laporan/create
     {kategori: "Jalan Rusak", deskripsi: "Jalan berlubang besar...",
      alamat: "depan kantor pos", rt_rw: "02/03", village_id: "...",
      wa_user_id: "628xxx", channel: "WHATSAPP"}
    │
    ▼
[Case Service]
     ├── Dedup check: tidak ada duplikat
     ├── Type resolution: "Jalan Rusak" → complaint_type "Infrastruktur - Jalan"
     ├── Generate ID: "LAP-20260417-001"
     ├── Status: OPEN
     └── Publish: govconnect.complaint.created
    │
    ▼
[AI] Reply: "✅ Laporan berhasil dibuat!
     Nomor Laporan: LAP-20260417-001
     Kategori: Jalan Rusak
     Lokasi: Depan kantor pos RT 02/03
     
     Kami akan segera menindaklanjuti. Bapak/Ibu bisa cek status
     dengan mengirim nomor laporan kapan saja."
    │
    ▼
[Notification Service] (consume govconnect.complaint.created)
     └── Kirim konfirmasi via WA (jika event masih aktif)
```

### 15.2 Alur Permohonan Layanan

```
User: "Saya mau urus surat keterangan domisili"
    │
    ▼
[NLU] Intent: CREATE_SERVICE_REQUEST (atau SERVICE_INFO)
[AI]  Match slug: "surat-keterangan-domisili"
      Ambil requirements dari Case Service
    │
    ▼
[AI] Reply: "Untuk Surat Keterangan Domisili, berikut persyaratannya:
     1. KTP asli
     2. KK asli
     3. Surat pengantar RT/RW
     
     📋 Silakan isi formulir online di:
     https://govconnect.my.id/layanan/surat-keterangan-domisili
     
     Setelah mengisi, Anda akan mendapat nomor permohonan."
```

**PENTING:** Layanan **tidak bisa** dibuat via chat. AI hanya memberikan info persyaratan dan link formulir. User harus mengisi form online di Dashboard.

### 15.3 Cek Status

```
User: "Cek status LAP-20260417-001"
    │
    ▼
[NLU] Intent: CHECK_STATUS, extract complaint_id: "LAP-20260417-001"
[AI]  Panggil Case Service: GET /laporan/LAP-20260417-001/check
    │
    ▼
[AI] Reply: "📋 Status Laporan LAP-20260417-001:
     Status: 🔄 Sedang Diproses
     Kategori: Jalan Rusak
     Tanggal Lapor: 17 April 2026
     
     Laporan Anda sedang ditangani oleh petugas."
```

### 15.4 Important Contacts Auto-Send

Jika tipe pengaduan memiliki `send_important_contacts=true` dan `important_contact_category` terisi:
- AI otomatis mengambil kontak dari Dashboard API
- Menyertakan nomor kontak relevan dalam respons (misal: nomor Damkar untuk laporan kebakaran)

---

## 16. User Profile & Spam Guard

### 16.1 User Profile (In-Memory + Encrypted)

AI Service menyimpan profil user secara in-memory (bukan DB) dengan enkripsi:

```typescript
{
  name?: string           // Dipelajari dari pesan
  phone?: string
  defaultAddress?: string // Alamat yang sering dipakai
  interactionHistory: Array<{intent, success, timestamp}>
  serviceUsage: string[]  // Service IDs yang pernah digunakan
}
```

- `learnFromMessage()` — Ekstrak nama/alamat dari pesan secara otomatis
- `recordInteraction()` — Catat setiap interaksi (intent, berhasil/gagal)
- `saveDefaultAddress()` — Simpan alamat default untuk pre-fill
- `getProfileContext()` — Generate konteks profil untuk LLM prompt
- Enkripsi menggunakan `PROFILE_ENCRYPTION_KEY`

### 16.2 Spam Guard

**Multi-layer spam protection:**

1. **Spam Pattern Detection** (pre-processing):
   - 30+ karakter berulang
   - Hanya simbol (tanpa huruf/angka)
   - URL (http, https, bit.ly, dll.)
   - Konten dewasa (viagra, casino, poker, judi, togel, xxx, porn)
- Spam CTA (click here, klik disini, download now, claim now)
    - Scam phrases (menang jutaan, hadiah milyar, transfer sekarang, bonus besar)
    - Judi/slot (slot, togel, judi)

2. **Bubble Chat Suppression** (in-flight tracking):
   - Track pesan yang sedang diproses per user+village
   - Jika user kirim pesan baru saat yang lama masih diproses → tandai lama sebagai `superseded`
   - Hanya respons untuk pesan terakhir yang dikirim (cegah spam response)
   - Cleanup otomatis setiap 5 menit

3. **Identical Message Banning**:
   - Max 5 pesan identik berturut-turut (configurable via `SPAM_GUARD_MAX_IDENTICAL`)
   - Ban duration: 60 detik (`SPAM_GUARD_BAN_DURATION_MS`)
   - Setelah limit → reject pesan

4. **Rate Flood Protection**:
   - Max 10 pesan per 10 detik (`SPAM_RATE_MAX_MESSAGES` / `SPAM_RATE_WINDOW_MS`)

5. **Rate Limiter (Laporan)**:
   - `MAX_REPORTS_PER_DAY`: 5 (default)
   - `COOLDOWN_SECONDS`: 30 (default)
   - `AUTO_BLACKLIST_VIOLATIONS`: 10 → auto-blacklist setelah 10 pelanggaran
   - Blacklist: manual add/remove via admin API
   - Blacklist bisa expire (`expiresInDays`)

### 16.3 Text Normalizer

Normalisasi teks Bahasa Indonesia sebelum processing:
- Koreksi typo umum: "ga" → "tidak", "gk" → "tidak"
- Handle bahasa informal/slang
- **⚠️ Temuan Audit (Temuan 30):** Berpotensi mengubah makna dalam edge case tertentu

---

## 17. Caching Strategy

### 17.1 Ringkasan Cache

| Cache | Lokasi | TTL | Max Size | Tipe |
|-------|--------|-----|----------|------|
| Retrieval Cache | AI Service | 5 menit (configurable) | 500 entries | LRU + TTL |
| Query Expansion Cache | AI Service | 15 menit | 200 entries | Map + TTL |
| Village Profile Cache | AI Service | 15 menit | **Tak terbatas** ⚠️ | Map + lazy TTL |
| Service Catalog Cache | AI Service | - | **Tak terbatas** ⚠️ | Map |
| Response Cache | AI Service | - | - | Map + hash |
| Conversation Summary Cache | AI Service | 10 menit | 200 entries/userId | Map + hash |
| API Key Usage Cache | AI Service | Flush setiap 30 detik | **Tak terbatas** ⚠️ | Object |

**⚠️ = Temuan audit terbuka** — beberapa cache menggunakan Map biasa tanpa batas ukuran.

---

## 18. Database Schema per Service

### 18.1 AI Service DB (`ai_service_db`)

| Tabel | Fungsi |
|-------|--------|
| `knowledge_vectors` | Vector embedding knowledge base (pgvector) |
| `document_vectors` | Vector embedding chunk dokumen (pgvector) |
| `embedding_jobs` | Antrian job embedding (status: pending/processing/completed/failed) |
| `ai_token_usage` | Log penggunaan token per model/layer/village |
| `conversation_sessions` | Pending conversation state (TTL-based) |
| `rate_limit_blacklist` | Daftar blacklist rate limiter |

### 18.2 Channel Service DB (`gc_channel_db`)

| Tabel | Fungsi |
|-------|--------|
| `messages` | Semua pesan IN/OUT (FIFO 30) |
| `send_logs` | Log pengiriman pesan keluar |
| `channel_accounts` | Konfigurasi channel per desa |
| `wa_sessions` | State session WA per desa |
| `wa_settings` | Pengaturan global WA |
| `takeover_sessions` | Record admin takeover |
| `conversations` | Summary percakapan (Live Chat) |
| `pending_messages` | Antrian pesan untuk batching/retry |

### 18.3 Case Service DB (`gc_case_db`)

| Tabel | Fungsi |
|-------|--------|
| `complaints` | Record pengaduan (soft delete) |
| `complaint_categories` | Grup kategori pengaduan per desa |
| `complaint_types` | Tipe spesifik per kategori (is_urgent, require_address, send_important_contacts) |
| `complaint_updates` | Timeline update status + admin notes |
| `service_categories` | Grup layanan per desa |
| `services_dynamic` | Katalog layanan (nama, slug, mode, form fields) |
| `service_requirements` | Field form dinamis per layanan |
| `service_requests` | Record permohonan layanan (soft delete, edit token) |

### 18.4 Notification Service DB (`gc_notification_db`)

| Tabel | Fungsi |
|-------|--------|
| `notification_logs` | Audit trail semua notifikasi (sent/failed/skipped) |

### 18.5 Dashboard DB (`gc_dashboard_db`)

| Tabel | Fungsi |
|-------|--------|
| `admin_users` | Akun admin |
| `villages` | Data desa |
| `village_profiles` | Profil desa (alamat, jam operasional) |
| `knowledge_base` | Konten knowledge base |
| `knowledge_categories` | Kategori knowledge per desa |
| `knowledge_documents` | Dokumen yang di-upload |
| `document_chunks` | Chunk dokumen (untuk review) |
| `knowledge_gaps` | Pertanyaan yang tidak terjawab |
| `knowledge_conflicts` | Konflik data antar sumber |
| `important_contact_categories` | Kategori kontak penting per desa |
| `important_contacts` | Nomor kontak penting |

---

## 19. Keamanan & Temuan Audit

### 19.1 Mekanisme Keamanan yang Sudah Ada

| Fitur | Status | Detail |
|-------|--------|--------|
| Internal API Key Auth | ✅ | Header `x-internal-api-key` untuk semua endpoint internal |
| Helmet.js | ✅ | Security headers (tapi CSP belum dikonfigurasi eksplisit) |
| CORS | ✅ | Configurable allowed origins |
| Rate Limiting | ✅ | Per-user rate limit + auto-blacklist |
| Input Sanitization | ✅ | `sanitizeUserInput()` max 1000 karakter per pesan |
| Webhook Signature Validation | ✅ | Validasi signature dari WA Provider |
| Soft Delete | ✅ | Data tidak dihapus permanen |
| Circuit Breaker | ✅ | Notification → Channel Service |
| Spam Guard | ✅ | Multi-layer spam detection |
| Anti-Hallucination | ✅ | Deteksi + sanitasi link/data palsu |
| Profile Encryption | ✅ | PII user di-encrypt di memory |

### 19.2 Temuan Audit Keamanan (dari Analisis Source Code)

#### Keparahan MENENGAH

| # | Temuan | Service | Jenis |
|---|--------|---------|-------|
| 13 | Village Profile Cache (`Map`) tumbuh tak terbatas | AI | Manajemen Memori |
| 14 | `usageCache` API Key Manager tumbuh antar siklus flush | AI | Manajemen Memori |
| 17 | **File upload dapat diakses tanpa autentikasi** — `/uploads/documents` (AI) dan `/uploads` (Channel) serve static tanpa auth. Siapa pun yang tahu URL bisa akses dokumen KB desa dan media WA. **Relevansi hukum: UU PDP Pasal 35; PP PSTE Pasal 24** | AI, Channel | Keamanan — Kontrol Akses |
| 18 | Map `statusCallbacks` (SSE) tumbuh tanpa batas — entri kosong tidak dihapus | AI | Kebocoran Memori |
| 19 | **Error handler global membocorkan `err.message` ke client** — bisa mengandung path file, nama kolom SQL, nama dependency | AI | Keamanan — Kebocoran Informasi |
| 20 | **Tidak ada batas ukuran body JSON** di AI Service (`express.json()` tanpa `limit`) — potensi DoS | AI | Keamanan — DoS |
| 21 | **Total prompt size tidak dicek terhadap context window** sebelum kirim ke LLM — potensi error/biaya berlebih | AI | Keandalan / Biaya |
| 24 | `repairTruncatedJson` bisa hasilkan data tidak valid — menggabungkan field dari percobaan berbeda | AI | Keandalan |
| 25 | **CSP belum dikonfigurasi eksplisit** — default Helmet bisa terlalu longgar | AI | Keamanan — Header HTTP |
| 29 | Cache katalog service (`Map`) tumbuh tanpa batas di multi-desa | AI | Keandalan |
| 30 | Normalisasi teks berpotensi mengubah makna pesan tertentu | AI | Keandalan |

#### Keparahan RENDAH

| # | Temuan | Service | Jenis |
|---|--------|---------|-------|
| 31 | **Perbandingan API key rentan timing attack** — menggunakan `===` bukan `crypto.timingSafeEqual()` | Case, AI | Keamanan |
| 35 | **AI Service punya ketergantungan DB yang tidak terdokumentasi** — `ai_token_usage` via Prisma (kontradiksi dengan klaim "stateless") | AI | Dokumentasi |
| 37 | **Tidak ada correlation ID antar service** — log independen per service, sulit trace satu request user | Semua | Observabilitas |
| 38 | **Tidak ada degradasi saat LLM mati total** — hanya fallback generik, tidak ada antrian untuk proses ulang | AI | Keandalan |

### 19.3 Rekomendasi Prioritas Tinggi

1. **Autentikasi file upload** (Temuan 17) — Ganti `express.static()` dengan route handler terautentikasi atau signed URL
2. **Batas body JSON** (Temuan 20) — `express.json({ limit: '2mb' })`
3. **Sembunyikan error detail di production** (Temuan 19) — Hanya tampilkan generic message
4. **CSP eksplisit** (Temuan 25) — Konfigurasi Content-Security-Policy
5. **Timing-safe API key comparison** (Temuan 31) — Gunakan `crypto.timingSafeEqual()`

---

## 20. Analytics & Token Usage

### 20.1 Token Usage Tracking

Setiap panggilan ke AI Gateway dicatat di tabel `ai_token_usage`:

```
model, input_tokens, output_tokens, total_tokens, cost_usd,
layer_type (full_nlu|micro_nlu|embedding|rag_expand|rerank),
call_type (main_chat|anti_hallucination_retry|complaint_type_match|...),
village_id, wa_user_id, session_id, channel, intent,
success, duration_ms, key_source, key_id, key_tier
```

### 20.2 Analytics Endpoints

| Endpoint | Data |
|----------|------|
| `/stats/token-usage/summary` | Total token, biaya, jumlah call |
| `/stats/token-usage/by-period` | Per hari/minggu/bulan |
| `/stats/token-usage/by-period-layer` | Per periode per layer (LLM/embed/RAG/rerank) |
| `/stats/token-usage/by-model` | Per model AI |
| `/stats/token-usage/by-village` | Per desa |
| `/stats/token-usage/layer-breakdown` | Distribusi per layer type |
| `/stats/token-usage/avg-per-chat` | Rata-rata token per percakapan |
| `/stats/token-usage/responses-by-village` | Jumlah respons per desa |
| `/stats/token-usage/village-model-detail` | Detail model per desa |
| `/stats/token-usage/by-source` | Per sumber (gateway lane) |
| `/stats/analytics/intents` | Distribusi intent |
| `/stats/analytics/flow` | Pola alur percakapan |
| `/stats/analytics/categories` | Penggunaan per kategori |
| `/stats/analytics/knowledge` | Statistik knowledge (retrieval count, gaps, conflicts) |
| `/stats/models` | Model yang digunakan + performance |

### 20.3 Prometheus Metrics

AI Service mengekspor metrics Prometheus (via `prom-client`):
- Request duration
- Error rates
- RabbitMQ queue depth
- Cache hit rates
- Circuit breaker states

---

## 21. Dashboard Frontend — Flow Data & Analitik

### 21.1 Bagaimana Dashboard Mengambil Data

Dashboard (Next.js) mengambil data dari berbagai service via REST:

| Data | Sumber | Endpoint |
|------|--------|----------|
| Token Usage & AI Analytics | AI Service (3002) | `GET /stats/token-usage/*`, `GET /stats/analytics/*` |
| Statistik Pengaduan & Layanan | Case Service (3003) | `GET /statistics/overview` |
| Daftar Percakapan (Live Chat) | Channel Service (3001) | `GET /internal/conversations` |
| Status Session WA | Channel Service (3001) | `GET /internal/whatsapp/status` |
| Knowledge Gaps | Dashboard DB sendiri | Tabel `knowledge_gaps` |
| Knowledge Conflicts | Dashboard DB sendiri | Tabel `knowledge_conflicts` |
| Profil Desa & Knowledge Base | Dashboard DB sendiri | Tabel `villages`, `knowledge_base`, dll. |

### 21.2 Status Pengolahan Data

| Fitur | Status | Keterangan |
|-------|--------|------------|
| Token Usage Analytics | ✅ Diproses | Aggregasi per periode, model, village, layer |
| Intent Distribution | ✅ Diproses | Distribusi dan tren intent |
| Conversation Flow | ✅ Diproses | Pola alur percakapan |
| Complaint Statistics | ✅ Diproses | Count per status, per village |
| Knowledge Gap Auto-resolution | ❌ Manual | Admin harus review dan tambah KB manual |
| Knowledge Conflict Resolution | ⚠️ Semi-auto | Auto-resolved jika DB data di-inject, sisanya manual |
| Live Chat Messages | ✅ Real-time | Via REST polling ke Channel Service |
| WA Session Status | ✅ Real-time | Polling ke Channel Service |

### 21.3 Gambar/Media di Dashboard

- **Upload media dari admin** → Channel Service `POST /internal/media/upload` → disimpan di volume `gc-channel-uploads`
- **Upload dokumen KB** → AI Service `POST /api/upload/document` → S3 + vector embedding
- **Foto pengaduan** → URL disimpan di `complaints.foto_url` (bisa single URL atau JSON array)
- **Hasil layanan (file)** → `service_requests.result_file_url` + `result_file_name`

**⚠️ Temuan 17:** Semua file yang di-upload (media WA, dokumen KB) bisa diakses tanpa autentikasi karena di-serve sebagai static file.

---

## Lampiran: Daftar Lengkap Environment Variables

### Required (Service Tidak Bisa Start)
```bash
RABBITMQ_URL=amqp://user:password@rabbitmq:5672/govconnect
CHANNEL_SERVICE_URL=http://channel-service:3001
CASE_SERVICE_URL=http://case-service:3003
INTERNAL_API_KEY=your-secret-key
DATABASE_URL_CHANNEL=postgresql://...
DATABASE_URL_AI=postgresql://...
DATABASE_URL_CASE=postgresql://...
DATABASE_URL_NOTIFICATION=postgresql://...
DATABASE_URL_DASHBOARD=postgresql://...
```

### AI Gateway — LLM Lane
```bash
LLM_PROVIDER=openrouter
LLM_API_KEY=sk-...              # atau LLM_GATEWAY_API_KEYS (comma-separated)
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o-mini
LLM_TEMPERATURE=0.3
LLM_MAX_TOKENS=3072
LLM_TIMEOUT_MS=30000
```

### AI Gateway — Embedding Lane
```bash
EMBED_PROVIDER=openrouter
EMBED_API_KEY=sk-...
EMBED_BASE_URL=https://openrouter.ai/api/v1
EMBED_MODEL=openai/text-embedding-3-small
EMBED_DIMENSIONS=768
EMBED_TIMEOUT_MS=30000
```

### AI Gateway — RAG Lane
```bash
RAG_PROVIDER=openrouter
RAG_API_KEY=sk-...
RAG_BASE_URL=https://openrouter.ai/api/v1
RAG_REWRITE_MODEL=openai/gpt-4o-mini
RAG_QUERY_REWRITE_TIMEOUT_MS=10000
```

### AI Gateway — Reranker Lane
```bash
RERANK_PROVIDER=openrouter
RERANK_API_KEY=sk-...
RERANK_BASE_URL=https://openrouter.ai/api/v1
RERANK_MODEL=cohere/rerank-3-turbo
RERANK_ENABLED=true
RERANK_TIMEOUT_MS=30000
RERANK_TOP_N=5
```

### OpenRouter Specific
```bash
OPENROUTER_SITE_URL=https://govconnect.my.id
OPENROUTER_APP_NAME=GovConnect
OPENROUTER_PROVIDER_ORDER=OpenAI,Anthropic,Google
OPENROUTER_ALLOW_FALLBACKS=true
OPENROUTER_ZDR_ONLY=false
```

### Rate Limiting & Spam
```bash
RATE_LIMIT_ENABLED=true
MAX_REPORTS_PER_DAY=5
COOLDOWN_SECONDS=30
AUTO_BLACKLIST_VIOLATIONS=10
```

### RAG & Caching
```bash
RAG_ENABLE_RETRIEVAL_CACHE=true
RAG_RETRIEVAL_CACHE_TTL_SECONDS=300
RAG_LLM_RERANK_MAX_CANDIDATES=12
```

### Object Storage
```bash
AWS_S3_BUCKET=govconnect-documents
AWS_S3_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

### Lainnya
```bash
PORT=3002
NODE_ENV=production
DASHBOARD_SERVICE_URL=http://dashboard:3000
MAX_HISTORY_MESSAGES=30
ALLOWED_ORIGINS=http://localhost:3000,https://govconnect.my.id
PROFILE_ENCRYPTION_KEY=your-encryption-key
TESTING_MODE=false
ENABLE_URGENT_WA_ALERT=false
```
