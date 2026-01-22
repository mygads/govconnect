# DOKUMENTASI SISTEM GOVCONNECT

## 1. Ringkasan Sistem

### 1.1 Fungsi Utama

GovConnect adalah platform digital berbasis Microservices Architecture yang mengintegrasikan layanan pemerintahan kelurahan dengan masyarakat melalui WhatsApp. Sistem menerapkan Enterprise Application Integration (EAI) dengan komunikasi synchronous (REST API) dan asynchronous (Message Broker).

### 1.2 Tujuan Bisnis

1. Digitalisasi layanan kelurahan sehingga warga dapat mengakses layanan tanpa datang ke kantor.
2. Otomasi proses melalui AI yang mengidentifikasi intent dan membuat laporan otomatis.
3. Komunikasi real-time melalui integrasi WhatsApp.
4. Monitoring dan analytics melalui dashboard admin.
5. Skalabilitas melalui arsitektur microservices.

### 1.3 Tipe Pengguna

Berdasarkan dokumentasi terdapat dua tipe pengguna:

1. **Warga** - mengakses sistem melalui WhatsApp untuk membuat laporan, cek status, bertanya informasi, dan melakukan reservasi layanan.
2. **Admin** - mengakses sistem melalui Dashboard web untuk mengelola laporan, knowledge base, live chat takeover, dan monitoring.

### 1.4 Batasan Sistem

1. Sistem hanya dapat diakses warga melalui WhatsApp (tidak ada portal web untuk warga).
2. Layanan reservasi bersifat fixed dan tidak dapat ditambah atau dihapus oleh admin, hanya dapat diaktifkan atau dinonaktifkan.
3. AI menggunakan Google Gemini sebagai LLM provider tunggal.
4. Sistem bergantung pada WhatsApp Business API eksternal (api-wa.genfity.com).

---

## 2. Arsitektur Sistem

### 2.1 Arsitektur yang Terdokumentasi

Sistem menggunakan arsitektur berlapis (layered architecture) dengan lima layer:

1. **External Layer** - WhatsApp Users dan Admin Browser.
2. **API Gateway Layer** - Traefik sebagai reverse proxy dengan load balancing, SSL termination, service discovery, dan health checks.
3. **Application Layer** - Lima microservices (Channel, AI, Case, Notification, Dashboard).
4. **Data Layer** - PostgreSQL 17 dengan pgvector dan RabbitMQ sebagai message broker.
5. **Observability Layer** - Prometheus, Grafana, dan Loki dengan Promtail.

### 2.2 Komponen Utama

| Service              | Port | Database        | Domain                                       |
| -------------------- | ---- | --------------- | -------------------------------------------- |
| Channel Service      | 3001 | gc_channel      | WhatsApp Gateway, Message handling, Takeover |
| AI Service           | 3002 | gc_ai           | AI Orchestration, Intent detection, RAG      |
| Case Service         | 3003 | gc_case         | Complaint management, Ticketing              |
| Notification Service | 3004 | gc_notification | Notification delivery                        |
| Dashboard            | 3000 | gc_dashboard    | Admin panel, Monitoring, Knowledge base      |

Komponen infrastruktur:

| Component     | Port          | Fungsi                   |
| ------------- | ------------- | ------------------------ |
| PostgreSQL 17 | 5432          | Database dengan pgvector |
| RabbitMQ      | 5672, 15672   | Message Broker           |
| Traefik       | 80, 443, 8080 | API Gateway              |
| Prometheus    | 9090          | Metrics collection       |
| Grafana       | 3300          | Monitoring dashboard     |
| Loki          | 3101          | Centralized logging      |

### 2.3 Relasi Antar Komponen

1. Channel Service menerima webhook dari WhatsApp API dan mempublikasikan event ke RabbitMQ.
2. AI Service mengkonsumsi event dari RabbitMQ, melakukan intent detection, dan memanggil Case Service via REST API.
3. AI Service mempublikasikan reply ke RabbitMQ yang dikonsumsi oleh Channel Service.
4. Channel Service mengirim pesan ke WhatsApp API.
5. Dashboard berkomunikasi dengan semua services melalui REST API.

### 2.4 Alur Komunikasi

**Synchronous (REST API):**

- Dashboard ke semua services
- AI Service ke Case Service
- AI Service ke Channel Service
- Channel Service ke WhatsApp API

**Asynchronous (RabbitMQ):**

- Channel Service ke AI Service (routing key: whatsapp.message.received)
- AI Service ke Channel Service (routing key: govconnect.ai.reply, govconnect.ai.error)
- AI Service ke Notification Service (routing key: notification.send)

### 2.5 Alasan Teknis Arsitektur

Arsitektur dipilih untuk memenuhi requirement tugas EAI:

1. Microservices untuk clear domain separation.
2. Database per service untuk menghindari shared database.
3. Dual communication pattern (sync dan async) sesuai kebutuhan use case.
4. Docker untuk containerization dan service discovery.

---

## 3. Struktur Docs dan Penjelasan

### 3.1 Struktur Folder

```
docs/
├── 01_OVERVIEW.md
├── 02_ARCHITECTURE.md
├── 03_SYSTEM_DOCUMENTATION.md
├── 04_BUSINESS_FLOW.md
├── 05_RESERVATION_SYSTEM.md
├── 07_EAI_MAPPING.md
└── openapi/
    └── openapi.yaml
```

### 3.2 Fungsi Setiap File

| File                       | Fungsi                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 01_OVERVIEW.md             | Gambaran umum sistem, tujuan, komponen utama, teknologi stack, dan struktur folder project                                    |
| 02_ARCHITECTURE.md         | Detail arsitektur teknis, layer diagram, service responsibilities, docker architecture, security, scalability, dan monitoring |
| 03_SYSTEM_DOCUMENTATION.md | Dokumentasi sistem lengkap hasil sintesis dari semua dokumen                                                                  |
| 04_BUSINESS_FLOW.md        | Skenario bisnis utama dengan sequence diagram, demo commands, data flow diagram, dan error handling                           |
| 05_RESERVATION_SYSTEM.md   | Spesifikasi sistem reservasi layanan pemerintahan, daftar layanan, flow reservasi, status, dan API endpoints                  |
| 07_EAI_MAPPING.md          | Mapping implementasi ke requirement tugas EAI dengan scoring, bukti implementasi, dan skenario demo                           |
| openapi/openapi.yaml       | Spesifikasi OpenAPI 3.0 untuk dokumentasi API semua services                                                                  |

### 3.3 Pola Dokumentasi

Dokumentasi menggunakan pola:

1. Penomoran file dengan prefix angka untuk urutan pembacaan.
2. Markdown dengan diagram ASCII art untuk visualisasi.
3. Tabel untuk data terstruktur.
4. Code snippets untuk contoh implementasi.
5. OpenAPI specification untuk dokumentasi API formal.

### 3.4 Alasan Struktur

Struktur ini memudahkan pemahaman karena:

1. Urutan numerik mengarahkan pembaca dari overview ke detail.
2. Pemisahan dokumen berdasarkan concern (arsitektur, flow, mapping requirement).
3. OpenAPI terpisah dalam subfolder untuk maintainability.

---

## 4. Alur Bisnis

### 4.1 Skenario A: Warga Membuat Laporan (Asynchronous)

1. Warga mengirim pesan WhatsApp dengan deskripsi laporan.
2. WhatsApp API mengirim webhook ke Channel Service (POST /webhook/whatsapp).
3. Channel Service memvalidasi payload, menyimpan ke gc_channel.messages, dan mempublikasikan ke RabbitMQ dengan routing key whatsapp.message.received.
4. AI Service mengkonsumsi message dari queue dan memanggil Gemini AI untuk intent detection.
5. AI Service mendeteksi intent CREATE_COMPLAINT dan mengekstrak data (kategori, alamat, deskripsi).
6. AI Service memanggil Case Service via REST API (POST /internal/complaints) dengan header x-internal-api-key.
7. Case Service men-generate complaint ID (format: LAP-YYYYMMDD-XXX), menyimpan ke gc_case.complaints, dan mengembalikan data complaint.
8. AI Service men-generate reply message dan mempublikasikan ke RabbitMQ dengan routing key govconnect.ai.reply.
9. Channel Service mengkonsumsi reply dari queue, memanggil WhatsApp API untuk mengirim pesan, dan menyimpan ke gc_channel.messages.
10. Warga menerima konfirmasi laporan via WhatsApp.

### 4.2 Skenario B: Warga Cek Status Laporan (Synchronous)

1. Warga mengirim pesan WhatsApp dengan nomor laporan.
2. Channel Service menerima webhook dan mempublikasikan ke RabbitMQ.
3. AI Service mengkonsumsi dan mendeteksi intent CHECK_STATUS, mengekstrak complaint_id.
4. AI Service memanggil Case Service via REST API (GET /internal/complaints/:id).
5. Case Service mengembalikan data complaint dengan status terkini.
6. AI Service memformat response dan mempublikasikan reply.
7. Channel Service mengirim ke WhatsApp API.
8. Warga menerima informasi status.

### 4.3 Skenario C: Warga Bertanya Informasi (Knowledge Query / RAG)

1. Warga mengirim pertanyaan via WhatsApp.
2. AI Service mendeteksi intent KNOWLEDGE_QUERY.
3. AI Service men-generate embedding dari query dan melakukan vector search di gc_ai.knowledge_vectors.
4. AI Service meretrieve relevant documents dan mengkombinasikan dengan LLM untuk generate answer.
5. Reply dikirim ke warga via Channel Service.

### 4.4 Skenario D: Admin Takeover (Live Chat)

1. Admin membuka Dashboard dan memilih conversation.
2. Admin mengklik takeover, Dashboard memanggil Channel Service (POST /internal/takeover/:id/start).
3. Channel Service mengeset takeover status = true dan menyimpan ke gc_channel.takeover_sessions.
4. Pesan baru dari warga tidak diteruskan ke AI, langsung ditampilkan di Dashboard.
5. Admin mengirim reply manual melalui Dashboard.
6. Setelah selesai, admin mengakhiri takeover (POST /internal/takeover/:id/end).
7. Pesan selanjutnya kembali diproses oleh AI.

### 4.5 Skenario E: Reservasi Layanan

1. Warga mengirim pesan untuk reservasi layanan tertentu.
2. AI Service mendeteksi intent CREATE_RESERVATION dan service_code.
3. AI Service menanyakan data umum secara berurutan (nama_lengkap, nik, alamat, no_hp).
4. AI Service menanyakan pertanyaan tambahan sesuai layanan.
5. AI Service menanyakan tanggal dan jam kedatangan.
6. Setelah konfirmasi, sistem membuat reservasi dengan nomor RSV-YYYYMMDD-XXX.
7. Warga menerima konfirmasi dan persyaratan dokumen.

---

## 5. Tech Stack

### 5.1 Backend

| Stack         | Fungsi                                   |
| ------------- | ---------------------------------------- |
| Node.js v23   | Runtime environment                      |
| TypeScript    | Programming language untuk type safety   |
| Express.js    | Web framework untuk REST API             |
| Prisma        | ORM untuk database access                |
| PostgreSQL 17 | Relational database                      |
| pgvector      | Extension untuk vector search (RAG)      |
| RabbitMQ      | Message broker untuk async communication |

### 5.2 Frontend (Dashboard)

| Stack        | Fungsi                      |
| ------------ | --------------------------- |
| Next.js 16   | React framework dengan SSR  |
| React 19     | UI library                  |
| TypeScript   | Type-safe development       |
| Tailwind CSS | Utility-first CSS framework |
| Radix UI     | Component library           |

### 5.3 AI/ML

| Stack                   | Fungsi                                             |
| ----------------------- | -------------------------------------------------- |
| Google Gemini 2.5 Flash | LLM untuk intent detection dan response generation |
| pgvector                | Vector database untuk RAG                          |

### 5.4 Infrastructure

| Stack           | Fungsi                        |
| --------------- | ----------------------------- |
| Docker          | Containerization              |
| Docker Compose  | Local orchestration           |
| Traefik         | API Gateway dan reverse proxy |
| Prometheus      | Metrics collection            |
| Grafana         | Monitoring visualization      |
| Loki + Promtail | Centralized logging           |

### 5.5 Alasan Pemilihan

Arsitektur dipilih untuk memenuhi requirement tugas EAI (microservices, database per service, dual communication pattern, docker).

---

## 6. Dokumentasi API

### 6.1 Informasi Umum

| Item                   | Value                        |
| ---------------------- | ---------------------------- |
| Base URL (Development) | http://localhost:{port}      |
| Base URL (Production)  | https://api.govconnect.my.id |
| Version                | 1.0.0                        |
| Format                 | JSON                         |

### 6.2 Autentikasi

| Tipe         | Mekanisme                 | Penggunaan               |
| ------------ | ------------------------- | ------------------------ |
| Internal API | Header X-Internal-API-Key | Service-to-service calls |
| Dashboard    | JWT via cookie/header     | Admin authentication     |
| Webhook      | WhatsApp verify token     | Webhook verification     |

### 6.3 Endpoint Penting

**Channel Service (Port 3001)**

| Method | Endpoint                     | Deskripsi                     |
| ------ | ---------------------------- | ----------------------------- |
| GET    | /webhook/whatsapp            | WhatsApp webhook verification |
| POST   | /webhook/whatsapp            | Receive WhatsApp message      |
| POST   | /internal/send               | Send WhatsApp message         |
| GET    | /internal/messages           | Get message history           |
| GET    | /internal/conversations      | Get conversation list         |
| POST   | /internal/takeover/:id/start | Start takeover mode           |
| POST   | /internal/takeover/:id/end   | End takeover mode             |
| GET    | /health                      | Health check                  |

**Case Service (Port 3003)**

| Method | Endpoint             | Deskripsi                |
| ------ | -------------------- | ------------------------ |
| POST   | /laporan/create      | Create new complaint     |
| GET    | /laporan             | Get complaints list      |
| GET    | /laporan/:id         | Get complaint detail     |
| PATCH  | /laporan/:id/status  | Update complaint status  |
| POST   | /tiket/create        | Create new ticket        |
| GET    | /tiket               | Get tickets list         |
| GET    | /statistics/overview | Get dashboard statistics |

**Reservation (Case Service)**

| Method | Endpoint                                | Deskripsi                   |
| ------ | --------------------------------------- | --------------------------- |
| GET    | /reservasi/services                     | Semua layanan (admin)       |
| GET    | /reservasi/services/active              | Layanan aktif (public)      |
| GET    | /reservasi/services/:code               | Detail layanan + pertanyaan |
| PATCH  | /reservasi/services/:code/toggle-active | Toggle aktif/nonaktif       |
| PATCH  | /reservasi/services/:code/toggle-online | Toggle reservasi online     |
| GET    | /reservasi/slots/:code/:date            | Cek slot tersedia           |
| POST   | /reservasi/create                       | Buat reservasi              |
| GET    | /reservasi                              | List reservasi              |
| GET    | /reservasi/:id                          | Detail reservasi            |
| PATCH  | /reservasi/:id/status                   | Update status               |

### 6.4 Response Format

**Success Response:**

```json
{
  "status": "success",
  "data": {
    "complaint_id": "LAP-20251208-001",
    "status": "baru"
  }
}
```

**Error Response:**

```json
{
  "error": "Bad Request",
  "message": "Invalid request body",
  "details": []
}
```

### 6.5 HTTP Status Codes

| Code | Penggunaan                     |
| ---- | ------------------------------ |
| 200  | Success                        |
| 201  | Resource created               |
| 400  | Bad request / Validation error |
| 401  | Unauthorized                   |
| 404  | Resource not found             |
| 500  | Internal server error          |

---

## 7. Keamanan Sistem

### 7.1 Mekanisme yang Terdokumentasi

**Authentication Flow (Admin):**

1. Admin login dengan username/password.
2. Dashboard memvalidasi credentials.
3. Sistem men-generate JWT token.
4. JWT disimpan dalam cookie.
5. Request berikutnya menyertakan JWT.
6. Middleware memverifikasi JWT.

**Internal Service Communication:**

1. Service A memanggil Service B.
2. Request menyertakan header x-internal-api-key.
3. Service B memvalidasi key.
4. Request diproses jika valid.

---

## 8. Deployment dan Environment

### 8.1 Environment yang Terdokumentasi

**Docker Networks:**

- infra-network: Infrastructure services (PostgreSQL, RabbitMQ, monitoring).
- govconnect-network: Application services.

**Container Structure:**

- Setiap service memiliki Dockerfile sendiri.
- Multi-stage build untuk optimasi image size.
- Health check pada setiap service.

### 8.2 Cara Menjalankan Sistem

```bash
# 1. Setup networks
cd networks && docker compose up -d && cd ..

# 2. Start database
cd database && docker compose up -d && cd ..

# 3. Start supporting services
cd supporting && docker compose up -d && cd ..

# 4. Start traefik
cd traefik && docker compose -f docker-compose.local.yml up -d && cd ..

# 5. Start GovConnect
cd govconnect && docker compose up -d --build && cd ..

# 6. Check all services
docker compose -f govconnect/docker-compose.yml ps
```

### 8.3 Access Points

| Service           | URL                    |
| ----------------- | ---------------------- |
| Dashboard         | http://localhost:3000  |
| Channel API       | http://localhost:3001  |
| AI API            | http://localhost:3002  |
| Case API          | http://localhost:3003  |
| Notification API  | http://localhost:3004  |
| Traefik Dashboard | http://localhost:8080  |
| RabbitMQ          | http://localhost:15672 |
| Prometheus        | http://localhost:9090  |
| Grafana           | http://localhost:3300  |

---

## 9. Keputusan Desain dan Trade Off

### 9.1 Keputusan Desain yang Terdokumentasi

**Database per Service:**

- Setiap service memiliki database sendiri (gc_channel, gc_ai, gc_case, gc_notification, gc_dashboard).
- Dampak: Tidak ada shared database, isolasi data per domain.
- Keterbatasan: Join antar service tidak dimungkinkan, harus melalui API call.

**Dual Communication Pattern:**

- Synchronous untuk operasi yang membutuhkan response langsung (query data, create resource).
- Asynchronous untuk operasi fire-and-forget dan decoupling (message processing, notification).
- Dampak: Fleksibilitas dalam pemilihan pola sesuai use case.

**Message Batching:**

- Pesan dari user yang sama dalam interval waktu tertentu digabungkan.
- Konfigurasi: MESSAGE_BATCH_DELAY_MS=2000, MAX_BATCH_SIZE=10.
- Dampak: Mengurangi AI API calls hingga 66%.

**Circuit Breaker:**

- Terdapat di shared/circuit-breaker.ts.
- State: CLOSED, OPEN, HALF_OPEN.
- Dampak: Mencegah cascade failure antar services.

**Layanan Reservasi Fixed:**

- Daftar layanan pemerintahan bersifat fixed.
- Admin hanya dapat toggle aktif/nonaktif dan toggle online.
- Keterbatasan: Tidak fleksibel untuk menambah layanan baru tanpa perubahan kode.

### 9.2 Keterbatasan yang Terdokumentasi

1. Tidak ada Kubernetes, hanya Docker Compose untuk development.
2. Semua service menggunakan TypeScript, arsitektur mendukung polyglot tetapi belum diimplementasikan.
3. Sistem bergantung pada external WhatsApp API.

---

## 10. Informasi Tidak Terdokumentasi

Berikut informasi yang tidak ditemukan dalam dokumen:

1. Alasan pemilihan setiap teknologi stack secara spesifik.
2. Alasan pendekatan keamanan yang dipilih.
3. SLA atau performance requirements.
4. Backup dan disaster recovery strategy.
5. Rate limiting configuration.
6. Detailed error codes dan handling.
7. Versioning strategy untuk API.
