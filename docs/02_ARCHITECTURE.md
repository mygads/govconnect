# Arsitektur GovConnect - Detail

## 🏗️ High-Level Architecture
# Arsitektur GovConnect (Redesain)

Dokumen ini menggantikan arsitektur lama dan menyesuaikan kebutuhan layanan desa/kelurahan berbasis WhatsApp + web.

## 🧭 Prinsip Dasar
- **Satu akun = satu desa/kelurahan** (saat ini). Pilihan pada register dikunci.
- **Future**: akun tingkat kecamatan dapat menautkan banyak desa.
- **AI Service stateless** (tanpa database).
- **Satu service = satu database** (PostgreSQL terpisah).
- **Chat history hanya di Channel Service** (maks. 30 pesan per user).

---

## 🏗️ High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│  - WhatsApp Users  - Webchat Widget  - Admin Dashboard           │
└───────────────────────┬───────────────────────┬──────────────────┘
                        │                       │
                        ▼                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      APPLICATION SERVICES                        │
│                                                                  │
│  Channel Service (WA)  ↔  AI Orchestrator  ↔  Case Service        │
│  Notification Service  ←  (Events)                                │
│  Dashboard (Next.js: Admin + Public Form)                          │
└──────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│                        DATA LAYER                                │
│  gc_channel | gc_case | gc_notification | gc_dashboard            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🧩 Service Responsibilities (Redesain)

### 1) Channel Service (WA Channel)
**Domain:** WhatsApp + chat history + webhook

**Responsibilities:**
- Terima webhook WhatsApp
- Simpan chat history max 30 pesan per user
- Publish event ke RabbitMQ
- Kirim outbound message ke WA API
- Simpan konfigurasi channel per desa (1 nomor WA)

**Database:** `gc_channel`
- `messages`, `send_logs`, `channel_accounts`

---

### 2) AI Orchestrator (Stateless)
**Domain:** Intent + flow logic

**Responsibilities:**
- Deteksi intent + entity
- Menentukan flow: knowledge query, layanan, pengaduan, status, history
- Query data via REST ke Case Service & Dashboard Service
- Publish event reply ke Notification Service
- **RAG scoped per desa** melalui `village_id` untuk konteks knowledge & dokumen

**Database:** ❌ Tidak ada

---

### 3) Case Service (Layanan + Pengaduan)
**Domain:** Semua transaksi layanan masyarakat & pengaduan

**Responsibilities:**
- CRUD kategori layanan, layanan, persyaratan
- Public service request (dari form publik)
- Status & history layanan
- CRUD kategori pengaduan & jenis pengaduan
- Kelola laporan masuk, status, update, media penanganan

**Database:** `gc_case`
- `service_categories`, `services`, `service_requirements`, `service_requests`
- `complaint_categories`, `complaint_types`, `complaints`, `complaint_updates`

---

### 4) Notification Service
**Domain:** Outbound message

**Responsibilities:**
- Konsumsi event `govconnect.ai.reply`
- Kirim pesan ke Channel Service
- Log status pengiriman

**Database:** `gc_notification`
- `notification_logs`, `notification_templates`

---

### 5) Dashboard (Next.js)
**Domain:** Admin UI + public form

**Responsibilities:**
- Auth admin & super admin
- Profil desa (data text) → knowledge base
- Sinkronisasi profil desa ke knowledge base dilakukan otomatis saat update
- Upload knowledge file (PDF/DOC/DOCX/TXT)
- Nomor penting per kategori
- Channel settings (token, WA number, webhook URL, toggle)
- Testing knowledge (demo) untuk uji RAG per desa
- Layanan: CRUD kategori/layanan/persyaratan
- Pengaduan: kategori/jenis, urgent alert, detail & update
- Public form: `govconnect.my.id/form/{slug-desa}/{slug-layanan}`
- Input layanan hanya via form web; edit memakai token, pembatalan via WA

**Database:** `gc_dashboard`
- `admin_users`, `admin_sessions`, `activity_logs`
- `villages`, `village_profiles`, `knowledge_categories`, `knowledge_documents`
- `knowledge_chunks`, `important_contact_categories`, `important_contacts`
- **Scope data**: `knowledge_base`, `knowledge_documents`, dan `knowledge_categories` tersaring per `village_id`

---

## 🔐 Role Model
- **Desa Admin**: mengelola semua fitur desa.
- **Super Admin**: melihat semua desa, analitik global, dan setting sistem.
- **AI model config**: hanya via ENV (bukan di dashboard).

---

## 🔄 Event & Flow

### Event utama
- `whatsapp.message.received` → AI Orchestrator
- `govconnect.ai.reply` → Notification Service
- `govconnect.service.requested` → Notification Service (opsional)
- `govconnect.complaint.created` → Notification Service

### Flow singkat
1. Warga kirim WA → Channel Service
2. Channel Service publish event
3. AI Orchestrator proses intent
4. Jika perlu data → REST ke Case Service / Dashboard
5. AI publish reply event
6. Notification Service kirim message via Channel Service

---

## 🗄️ Skema Data Inti (Ringkas)

### gc_dashboard
- `villages` (id, name, slug, is_active)
- `village_profiles` (nama, alamat, gmaps_url, short_name, jam_buka_json)
- `knowledge_categories` (default + custom)
- `knowledge_documents` (file metadata)
- `knowledge_chunks` (embedding)
- `important_contact_categories` + `important_contacts`
- `admin_users` (role: super_admin | village_admin)

### gc_case
- `service_categories`, `services`, `service_requirements`, `service_requests`
- `complaint_categories`, `complaint_types`, `complaints`, `complaint_updates`

### gc_channel
- `channel_accounts` (village_id, wa_number, token, webhook_url, enabled_wa, enabled_webchat)
- `messages`, `send_logs`

---

## 🌐 Halaman UI (Bahasa Indonesia)
- **Auth**: Login, Register (desa/kelurahan saja)
- **Profil Desa**
- **Knowledge Base** (kategori + upload file)
- **Nomor Penting**
- **Channel Connect** (WA token, WA number, webhook URL, toggle)
- **Testing Knowledge**
- **Layanan** (kategori, layanan, persyaratan)
- **Daftar Pelayanan** (list request, detail, status)
- **Pengaduan** (list, detail, update + upload foto penanganan)
- **Live Chat & Takeover**
- **Super Admin**: daftar desa, analytics sistem, pengaturan global
- Jam operasional kantor
- Persyaratan dokumen
- Alamat kantor
- Informasi layanan umum
- FAQ

### Cache Statistics

Dashboard AI Analytics menampilkan:
- Cache hit rate
- Cost savings dari cache
- Most cached queries

## 🔐 Security Architecture

### Authentication Flow

```
1. Admin login (username/password)
    ↓
2. Dashboard validates credentials
    ↓
3. Generate JWT token
    ↓
4. Store JWT in cookie
    ↓
5. Subsequent requests with JWT
    ↓
6. Middleware verifies JWT
```

### Internal Service Communication

```
Service A → Service B
    ↓
Add Header: x-internal-api-key
    ↓
Service B validates key
    ↓
Process request
```

## 📈 Scalability

### Horizontal Scaling

Services yang bisa di-scale horizontal:
- ✅ Channel Service (stateless)
- ✅ AI Service (stateless)
- ✅ Case Service (stateless)
- ✅ Notification Service (stateless)
- ⚠️ Dashboard (session management needed)

### Load Balancing

Gunakan orchestrator (Docker Swarm/Kubernetes) untuk load balancing antar instance service.

```yaml
channel-service:
    deploy:
        replicas: 3  # 3 instances
```

## 📊 Monitoring Architecture

### Metrics Collection

```
Application Services
    ↓ (expose /health endpoint)
Prometheus scrapes metrics
    ↓
Store time-series data
    ↓
Grafana queries Prometheus
    ↓
Visualize dashboards
```

### Log Aggregation

```
Application Services
    ↓ (write logs to stdout)
Docker captures logs
    ↓
Promtail collects logs
    ↓
Loki stores logs
    ↓
Grafana queries Loki
    ↓
Search & analyze logs
```
