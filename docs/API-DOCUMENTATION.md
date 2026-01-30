# Dokumentasi API GovConnect (Redesain)

Dokumen ini menambahkan **API v2** sesuai perubahan fitur. Bagian lama tetap ada di bawah sebagai **legacy** dan **tidak dipakai**.

---

## API v2 (Redesain)

### Prinsip
- Semua request internal memakai header `X-Internal-API-Key`.
- AI model **tidak** diubah dari dashboard (hanya via ENV).
- Bahasa UI dan respons admin: **Bahasa Indonesia**.

---

## Auth & User

### POST /api/auth/register
Register desa/kelurahan (pilihan **terkunci** 1 level).

### POST /api/auth/login
Login admin desa.

### POST /api/auth/logout
Logout admin.

---

## Dashboard (Admin)

### Desa & Profil
```
GET  /api/villages/me
PUT  /api/villages/me

GET  /api/village-profile
PUT  /api/village-profile
```

### Knowledge Base
```
GET  /api/knowledge/categories
POST /api/knowledge/categories

GET  /api/knowledge/documents
POST /api/knowledge/documents (upload PDF/DOC/DOCX/TXT)
DELETE /api/knowledge/documents/:id
```

### Nomor Penting
```
GET  /api/important-contacts/categories
POST /api/important-contacts/categories
GET  /api/important-contacts
POST /api/important-contacts
```

### Channel Connect
```
GET  /api/channel-settings
PUT  /api/channel-settings
```
Payload mencakup: `wa_number`, `wa_token`, `webhook_url` (read-only), `enabled_wa`, `enabled_webchat`.

### Testing Knowledge
```
POST /api/testing-knowledge
```
Request body (JSON):
```
{
  "query": "jam buka kantor kelurahan?",
  "category_id": "cat_xxx" ,
  "category_ids": ["cat_xxx"],
  "include_knowledge": true,
  "include_documents": true,
  "top_k": 5,
  "min_score": 0.6
}
```
Response:
```
{
  "data": [
    {
      "id": "...",
      "content": "...",
      "score": 0.78,
      "source": "Judul",
      "sourceType": "knowledge",
      "metadata": { "category": "jadwal" }
    }
  ],
  "total": 1,
  "searchTimeMs": 124
}
```

---

## Public Form (Warga)
```
GET  /form/:villageSlug/:serviceSlug
GET  /api/public/services/by-slug?village_slug=...&service_slug=...
POST /api/public/service-requests
```
`POST /api/public/service-requests` menerima data warga + file persyaratan.

---

## Case Service (Layanan & Pengaduan)

### Layanan
```
GET  /services/categories
POST /services/categories
GET  /services
POST /services
GET  /services/:id
PUT  /services/:id

GET  /services/:id/requirements
POST /services/:id/requirements
PUT  /services/requirements/:id
DELETE /services/requirements/:id
```

### Permohonan Layanan
```
GET  /service-requests
POST /service-requests
GET  /service-requests/:id
PATCH /service-requests/:id/status
POST /service-requests/:id/cancel
POST /service-requests/:id/edit-token
GET  /service-requests/by-token?token=...
PATCH /service-requests/:id/by-token
GET  /service-requests/history/:wa_user_id
```

### Pengaduan
```
GET  /complaints/categories
POST /complaints/categories
PATCH /complaints/categories/:id
DELETE /complaints/categories/:id
GET  /complaints/types?village_id=...&category_id=...
POST /complaints/types
PATCH /complaints/types/:id
DELETE /complaints/types/:id

POST /laporan/create
GET  /laporan
GET  /laporan/:id
POST /laporan/:id/check
PATCH /laporan/:id/status
POST /laporan/:id/cancel
PATCH /laporan/:id/update
POST /complaints/:id/updates
```

---

## Channel Service (WhatsApp)
```
POST /webhook/whatsapp
GET  /webhook/whatsapp
POST /internal/messages/send
GET  /internal/messages/history?wa_user_id=628xxx
GET  /internal/channel-accounts/:village_id
PUT  /internal/channel-accounts/:village_id
```

---

## AI Orchestrator
```
POST /internal/process-message
POST /api/webchat
POST /internal/knowledge/search
```

### Internal Knowledge (Dashboard)
```
GET  /api/internal/knowledge?query=...&category_id=...&village_id=...&limit=5
POST /api/internal/knowledge
```
Body POST (JSON):
```
{
  "query": "alamat kantor",
  "categories": ["kontak"],
  "category_ids": ["cat_xxx"],
  "village_id": "village_xxx",
  "limit": 5
}
```

### Internal Nomor Penting (Dashboard)
```
GET /api/internal/important-contacts?village_id=...&category_name=...&category_id=...
```
Response (JSON):
```
{
  "data": [
    {
      "id": "ic_123",
      "name": "Damkar",
      "phone": "113",
      "description": "Pemadam kebakaran",
      "category": {
        "id": "cat_123",
        "name": "Darurat"
      }
    }
  ]
}
```

---

## Notification Service
```
POST /internal/notifications
GET  /internal/notifications
```

---

## Super Admin
```
GET /api/superadmin/villages
GET /api/superadmin/analytics
GET /api/superadmin/system-settings
```

---

## ⚠️ Legacy (Tidak Dipakai)

# GovConnect API Documentation

Complete API reference for all GovConnect microservices.

## Table of Contents
- [Overview](#overview)
- [Authentication](#authentication)
- [Base URLs](#base-urls)
- [Case Service API](#case-service-api)
- [Channel Service API](#channel-service-api)
- [AI Service API](#ai-service-api)
- [Dashboard API](#dashboard-api)
- [Error Handling](#error-handling)

---

## Overview

GovConnect is a microservices-based government service platform with the following services:

| Service | Port | Description |
|---------|------|-------------|
| Dashboard | 3000 | Admin dashboard (Next.js) |
| Channel Service | 3001 | WhatsApp channel & messaging |
| AI Service | 3002 | AI orchestrator & NLU |
| Case Service | 3003 | Complaints & service requests |
| Notification Service | 3004 | Notifications (event-driven) |

---

## Authentication

### Internal API Key (Service-to-Service)
```
Header: X-Internal-API-Key: <your-api-key>
```
Used for internal communication between services.

### JWT Token (Dashboard)
```
Header: Authorization: Bearer <token>
```
Used for dashboard admin authentication.

### Public APIs
Endpoint publik untuk form tersedia tanpa autentikasi.

---

## Base URLs

**Internal (Docker network):**
| Service | URL |
|---------|-----|
| Dashboard | `http://dashboard:3000` |
| Case Service | `http://case-service:3003` |
| Channel Service | `http://channel-service:3001` |
| AI Service | `http://ai-service:3002` |
| Notification Service | `http://notification-service:3004` |

**External (production):**
| Service | URL |
|---------|-----|
| Dashboard | `https://govconnect.my.id` |
| Case Service | `https://case.govconnect.my.id` |
| Channel Service | `https://channel.govconnect.my.id` |
| AI Service | `https://ai.govconnect.my.id` |
| Notification Service | `https://notification.govconnect.my.id` |

> Catatan: antar service saling berkomunikasi langsung (tanpa gateway agregasi).

---

## Case Service API

Base URL: `https://case.govconnect.my.id`

### Health Endpoints

#### GET /health
Check service health.

**Response:**
```json
{
  "status": "ok",
  "service": "govconnect-case-service",
  "timestamp": "2025-12-22T15:00:00.000Z"
}
```

#### GET /metrics
Prometheus metrics endpoint.

---

### Complaints (Laporan)

#### POST /laporan/create
Create a new complaint.

**Headers:**
```
Content-Type: application/json
X-Internal-API-Key: <api-key>
```

**Request Body:**
```json
{
  "wa_user_id": "6281234567890",
  "kategori": "jalan_rusak",
  "deskripsi": "Jalan berlubang di depan kantor kelurahan",
  "alamat": "Jl. Merdeka No. 10",
  "rt_rw": "001/002",
  "foto_url": "https://example.com/photo.jpg"
}
```

**Valid Categories:**
- `jalan_rusak` - Jalan Rusak
- `lampu_mati` - Lampu Mati
- `sampah` - Sampah
- `drainase` - Drainase
- `pohon_tumbang` - Pohon Tumbang
- `fasilitas_rusak` - Fasilitas Rusak
- `banjir` - Banjir
- `tindakan_kriminal` - Tindakan Kriminal
- `lainnya` - Lainnya

**Response (201):**
```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "complaint_id": "LP-20251222-001",
    "kategori": "jalan_rusak",
    "deskripsi": "Jalan berlubang di depan kantor kelurahan",
    "status": "OPEN",
    "created_at": "2025-12-22T15:00:00.000Z"
  }
}
```

#### GET /laporan
Get complaints list.

**Status valid:** `OPEN`, `PROCESS`, `DONE`, `CANCELED`, `REJECT`. Status `DONE`/`CANCELED`/`REJECT` wajib menyertakan `admin_notes` saat update.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status (OPEN, PROCESS, DONE, CANCELED, REJECT) |
| kategori | string | Filter by category |
| wa_user_id | string | Filter by user |
| limit | number | Limit results (default: 20) |
| offset | number | Offset for pagination |

**Response:**
```json
{
  "status": "success",
  "data": [...],
  "total": 100,
  "limit": 20,
  "offset": 0
}
```

#### GET /laporan/:id
Get complaint by ID.

#### GET /laporan/statistics
Get complaint statistics.

**Response:**
```json
{
  "totalLaporan": 100,
  "laporan": {
    "open": 30,
    "process": 50,
    "done": 15,
    "canceled": 3,
    "reject": 2,
    "hariIni": 10
  }
}
```

#### POST /laporan/:id/check
Check complaint status with ownership validation.

**Headers:**
```
X-Internal-API-Key: <api-key>
```

**Request Body:**
```json
{
  "wa_user_id": "6281234567890"
}
```

#### PATCH /laporan/:id/status
Update complaint status.

**Request Body:**
```json
{
  "status": "PROCESS",
  "admin_notes": "Sedang ditindaklanjuti"
}
```

#### POST /laporan/:id/cancel
Cancel complaint.

**Headers:**
```
X-Internal-API-Key: <api-key>
```

**Request Body:**
```json
{
  "wa_user_id": "6281234567890",
  "cancel_reason": "Sudah selesai sendiri"
}
```

---

### Service Catalog & Permohonan Layanan

**Status valid:** `OPEN`, `PROCESS`, `DONE`, `CANCELED`, `REJECT`. Status `DONE`/`CANCELED`/`REJECT` wajib menyertakan `admin_notes`.

#### GET /service-categories
Get all service categories (optional filter by `village_id`).

#### POST /service-categories
Create service category.

#### GET /services
Get all services (optional filter by `village_id`, `category_id`).

#### GET /services/:id
Get service by ID.

#### GET /services/by-slug?village_id=...&slug=...
Get service by village slug for public form.

#### POST /services
Create service item.

#### PATCH /services/:id
Update service item.

#### GET /services/:id/requirements
Get requirements by service.

#### POST /services/:id/requirements
Create requirement.

#### PATCH /requirements/:id
Update requirement.

#### DELETE /requirements/:id
Delete requirement.

#### GET /service-requests
Get service requests list.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status |
| service_id | string | Filter by service |
| wa_user_id | string | Filter by user |
| request_number | string | Filter by request number |
| village_id | string | Filter by village |

#### POST /service-requests
Create service request (public form & AI).

**Request Body:**
```json
{
  "service_id": "svc-123",
  "wa_user_id": "6281234567890",
  "citizen_data_json": {
    "nama_lengkap": "John Doe",
    "nik": "1234567890123456",
    "alamat": "Jl. Merdeka No. 10",
    "no_hp": "081234567890"
  },
  "requirement_data_json": {
    "keperluan": "Surat Domisili"
  }
}
```

#### GET /service-requests/:id
Get service request by ID.

#### PATCH /service-requests/:id/status
Update service request status.

**Request Body:**
```json
{
  "status": "PROCESS",
  "admin_notes": "Sedang diverifikasi"
}
```

#### POST /service-requests/:id/cancel
Cancel service request (ownership required).

#### DELETE /service-requests/:id
Tidak diizinkan (gunakan update status ke CANCELED/REJECT).

#### GET /service-requests/history/:wa_user_id
Get user service request history.

---

### Statistics

#### GET /statistics/overview
Get overview statistics.

---

### User History

#### GET /user/:wa_user_id/history
Get user history (complaints + service requests).

**Headers:**
```
X-Internal-API-Key: <api-key>
```



---

## Channel Service API

Base URL: `https://channel.govconnect.my.id`

### Health Endpoints

#### GET /health
Service health check.

#### GET /health/db
Database connectivity.

#### GET /health/rabbitmq
RabbitMQ connectivity.

---

### Webhook Routes

#### GET /webhook/whatsapp
Verify WhatsApp webhook.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| hub.mode | string | Must be "subscribe" |
| hub.verify_token | string | Verification token |
| hub.challenge | string | Challenge to return |

#### POST /webhook/whatsapp
Handle WhatsApp webhook events.

**Request Body:** WhatsApp webhook payload (varies by event type)

---

### Internal Routes

All internal routes require `X-Internal-API-Key` header.

#### GET /internal/messages
Get messages for a user.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| wa_user_id | string | WhatsApp user ID |
| limit | number | Limit results |
| offset | number | Offset |

#### POST /internal/messages
Store AI reply in database.

**Request Body:**
```json
{
  "wa_user_id": "6281234567890",
  "message": "Terima kasih atas laporan Anda",
  "direction": "OUT",
  "source": "AI"
}
```

#### POST /internal/send
Send message to WhatsApp.

**Request Body:**
```json
{
  "wa_user_id": "6281234567890",
  "message": "Hello!",
  "media_url": "https://example.com/image.jpg"
}
```

#### POST /internal/typing
Set typing indicator.

**Request Body:**
```json
{
  "wa_user_id": "6281234567890"
}
```

#### POST /internal/messages/read
Mark messages as read.

**Request Body:**
```json
{
  "wa_user_id": "6281234567890",
  "message_ids": ["msg1", "msg2"]
}
```

---

### WhatsApp Session (QR & Token Internal)

Semua endpoint session berada di Channel Service dan membutuhkan header `X-Internal-API-Key`.

#### POST /internal/whatsapp/session
Buat session WhatsApp baru (auto-save token di DB internal).

Body:
```json
{
  "village_id": "uuid-village",
  "admin_id": "uuid-admin"
}
```

#### DELETE /internal/whatsapp/session?village_id=...
Hapus session dan token dari DB (logout dilakukan sebelum delete).

#### GET /internal/whatsapp/status?village_id=...
Ambil status session (connected/loggedIn/jid) + nomor WA tersimpan.

#### POST /internal/whatsapp/connect?village_id=...
Konek session untuk menghasilkan QR (jika belum login).

#### GET /internal/whatsapp/qr?village_id=...
Ambil QR code untuk login.

#### POST /internal/whatsapp/disconnect?village_id=...
Putuskan koneksi session (token tetap tersimpan).

#### POST /internal/whatsapp/logout?village_id=...
Logout session (perlu scan QR lagi untuk login ulang).

---

### Live Chat & Takeover

#### POST /internal/takeover/:wa_user_id
Start admin takeover.

**Request Body:**
```json
{
  "admin_id": "admin-uuid",
  "admin_name": "Admin Name"
}
```

#### DELETE /internal/takeover/:wa_user_id
End admin takeover.

#### GET /internal/takeover
Get all active takeovers.

**Response:**
```json
{
  "data": [
    {
      "wa_user_id": "6281234567890",
      "admin_id": "admin-uuid",
      "admin_name": "Admin Name",
      "started_at": "2025-12-22T15:00:00.000Z"
    }
  ]
}
```

#### GET /internal/takeover/:wa_user_id/status
Check takeover status.

#### GET /internal/conversations
Get all conversations.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| limit | number | Limit results |
| offset | number | Offset |

#### GET /internal/conversations/:wa_user_id
Get specific conversation.

#### POST /internal/conversations/:wa_user_id/send
Admin send message.

**Request Body:**
```json
{
  "message": "Hello from admin",
  "media_url": "https://example.com/image.jpg"
}
```

#### POST /internal/conversations/:wa_user_id/read
Mark conversation as read.

#### POST /internal/conversations/:wa_user_id/retry
Retry AI processing.

#### DELETE /internal/conversations/:wa_user_id
Delete conversation.

---

## AI Service API

Base URL: `https://ai.govconnect.my.id`

### Health Endpoints

#### GET /health
Service health check.

#### GET /health/rabbitmq
RabbitMQ status with retry queue info.

#### GET /health/services
Downstream services health.

---

### Web Chat API

#### POST /api/webchat
Process webchat message.

**Request Body:**
```json
{
  "session_id": "web_form_1234567890",
  "message": "Saya ingin membuat laporan jalan rusak",
  "channel": "webchat"
}
```

**Response:**
```json
{
  "success": true,
  "response": "Baik, saya akan membantu Anda membuat laporan...",
  "intent": "create_complaint",
  "processing_time_ms": 1500
}
```

#### GET /api/webchat/:session_id
Get session history.

#### DELETE /api/webchat/:session_id
Clear session.

#### GET /api/webchat/stats
Get session statistics.

#### GET /api/webchat/:session_id/poll
Poll for admin messages (long polling).

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| since | string | Timestamp to poll from |

---

### Knowledge Vector API

All routes require `X-Internal-API-Key` header.

#### POST /api/knowledge
Add knowledge with embedding.

**Request Body:**
```json
{
  "id": "kb-001",
  "title": "Persyaratan KTP",
  "content": "Untuk membuat KTP diperlukan...",
  "category": "kependudukan",
  "keywords": ["ktp", "identitas"],
  "qualityScore": 1.0
}
```

#### PUT /api/knowledge/:id
Update knowledge (re-embed).

#### DELETE /api/knowledge/:id
Delete knowledge vector.

#### GET /api/knowledge/:id
Get knowledge vector.

#### POST /api/knowledge/search
Vector search.

**Request Body:**
```json
{
  "query": "cara membuat KTP",
  "topK": 5,
  "minScore": 0.7,
  "categories": ["kependudukan"]
}
```

#### GET /api/knowledge/stats
Get vector DB statistics.

---

### Document Upload API

#### POST /api/upload/document
Upload and process document.

**Content-Type:** `multipart/form-data`

**Form Fields:**
| Field | Type | Description |
|-------|------|-------------|
| file | File | Document file (PDF, DOCX, TXT, MD, CSV) |
| category | string | Document category |

**Max Size:** 10MB

#### DELETE /api/upload/document/:documentId
Delete document vectors.

---

### Processing Status API

#### GET /api/status/summary
Get processing summary.

**Response:**
```json
{
  "success": true,
  "data": {
    "activeCount": 5,
    "completedCount": 100,
    "averageProcessingTime": 1500
  }
}
```

#### GET /api/status/active
Get all active processing statuses.

#### GET /api/status/stream/:userId
SSE stream for real-time updates.

**Response:** Server-Sent Events stream

#### GET /api/status/:userId
Get user processing status.

---

### Analytics & Statistics

#### GET /stats/models
Get all model statistics.

#### GET /stats/analytics
Get AI analytics summary.

#### GET /stats/analytics/intents
Get intent distribution.

#### GET /stats/analytics/tokens
Get token usage breakdown.

#### GET /stats/dashboard
Comprehensive dashboard stats.

#### POST /stats/analyze-complexity
Analyze message complexity.

**Request Body:**
```json
{
  "message": "Saya ingin membuat laporan jalan rusak di RT 01 RW 02"
}
```

---

### Rate Limiting

#### GET /rate-limit
Get rate limit stats.

#### GET /rate-limit/check/:wa_user_id
Check user rate limit.

#### GET /rate-limit/blacklist
Get blacklist.

#### POST /rate-limit/blacklist
Add to blacklist.

**Request Body:**
```json
{
  "wa_user_id": "6281234567890",
  "reason": "Spam",
  "expiresInDays": 7
}
```

#### DELETE /rate-limit/blacklist/:wa_user_id
Remove from blacklist.

---

### Failed Messages

#### GET /admin/failed-messages
Get all failed messages.

#### POST /admin/failed-messages/:messageId/retry
Retry specific message.

#### POST /admin/failed-messages/retry-all
Retry all failed messages.

#### DELETE /admin/failed-messages
Clear failed messages.





## Error Handling

### Standard Error Response

```json
{
  "error": "Error message",
  "details": "Additional details (optional)",
  "status": "error"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request / Validation Error |
| 401 | Unauthorized |
| 403 | Forbidden (Invalid API Key) |
| 404 | Not Found |
| 409 | Conflict (Duplicate) |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

### Validation Errors

```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "kategori",
      "message": "Invalid kategori"
    }
  ]
}
```

---

## Rate Limiting

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| MAX_REPORTS_PER_DAY | 5 | Max complaints per user per day |
| COOLDOWN_SECONDS | 30 | Cooldown between requests |
| AUTO_BLACKLIST_VIOLATIONS | 10 | Violations before auto-blacklist |

### Rate Limit Response

```json
{
  "error": "Rate limit exceeded",
  "details": {
    "remaining": 0,
    "reset_at": "2025-12-23T00:00:00.000Z"
  }
}
```

---

## WebSocket / SSE

### Processing Status Stream

**Endpoint:** `GET /api/status/stream/:userId`

**Event Types:**
- `status` - Processing status update
- `complete` - Processing complete
- `error` - Processing error

**Example Event:**
```
event: status
data: {"stage":"processing","message":"Menganalisis pesan...","progress":50}
```

---

## Postman Collection

Import the Postman collection from: `govconnect/docs/GovConnect-API.postman_collection.json`

