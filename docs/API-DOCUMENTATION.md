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
- [GraphQL API](#graphql-api)
- [Error Handling](#error-handling)

---

## Overview

GovConnect is a microservices-based government service platform with the following services:

| Service | Port | Description |
|---------|------|-------------|
| Dashboard | 3000 | Admin dashboard (Next.js) |
| Channel Service | 3001 | WhatsApp gateway & messaging |
| AI Service | 3002 | AI orchestrator & NLU |
| Case Service | 3003 | Complaints & reservations |
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
GraphQL endpoints and some public endpoints don't require authentication.

---

## Base URLs

| Environment | URL Pattern |
|-------------|-------------|
| Production | `https://api.govconnect.my.id/{service}` |
| Local | `http://localhost:{port}` |

**Service Paths (via Traefik):**
- Channel: `/channel/*`
- AI: `/ai/*`
- Case: `/case/*`
- Notification: `/notification/*`

---

## Case Service API

Base URL: `http://localhost:3003` or `https://api.govconnect.my.id/case`

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
    "status": "baru",
    "created_at": "2025-12-22T15:00:00.000Z"
  }
}
```

#### GET /laporan
Get complaints list.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status (baru, proses, selesai, ditolak) |
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
    "baru": 30,
    "proses": 50,
    "selesai": 15,
    "ditolak": 5,
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
  "status": "proses",
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

### Reservations (Reservasi)

#### GET /reservasi/services
Get all government services.

**Response:**
```json
{
  "status": "success",
  "data": [
    {
      "code": "SKD",
      "name": "Surat Keterangan Domisili",
      "description": "...",
      "category": "Kependudukan",
      "requirements": ["KTP", "KK"],
      "estimated_duration": 15,
      "daily_quota": 20,
      "is_active": true,
      "is_online_available": true
    }
  ]
}
```

#### GET /reservasi/services/active
Get active services only.

#### GET /reservasi/services/:code
Get service by code.

#### PATCH /reservasi/services/:code/toggle-active
Toggle service active status.

**Request Body:**
```json
{
  "is_active": false
}
```

#### PATCH /reservasi/services/:code/toggle-online
Toggle online availability.

**Request Body:**
```json
{
  "is_online_available": false
}
```

#### PATCH /reservasi/services/:code/settings
Update service settings.

**Request Body:**
```json
{
  "daily_quota": 30,
  "operating_hours": {
    "senin": { "open": "08:00", "close": "15:00" },
    "selasa": { "open": "08:00", "close": "15:00" }
  }
}
```

#### GET /reservasi/slots/:code/:date
Get available time slots.

**Parameters:**
- `code`: Service code (e.g., "SKD")
- `date`: ISO date (e.g., "2025-12-24")

**Response:**
```json
{
  "available": true,
  "service_code": "SKD",
  "date": "2025-12-24",
  "day_name": "rabu",
  "total_quota": 20,
  "booked": 5,
  "remaining": 15,
  "available_slots": ["08:00", "08:30", "09:00", "09:30"]
}
```

#### POST /reservasi/create
Create a reservation.

**Headers:**
```
X-Internal-API-Key: <api-key>
```

**Request Body:**
```json
{
  "wa_user_id": "6281234567890",
  "service_code": "SKD",
  "citizen_data": {
    "nama_lengkap": "John Doe",
    "nik": "1234567890123456",
    "alamat": "Jl. Merdeka No. 10",
    "no_hp": "081234567890"
  },
  "reservation_date": "2025-12-24",
  "reservation_time": "09:00"
}
```

**Response (201):**
```json
{
  "status": "success",
  "data": {
    "reservation_id": "RSV-20251222-001",
    "queue_number": 6,
    "service_name": "Surat Keterangan Domisili",
    "reservation_date": "2025-12-24",
    "reservation_time": "09:00",
    "status": "pending"
  }
}
```

#### GET /reservasi
Get reservations list.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status |
| service_id | string | Filter by service |
| wa_user_id | string | Filter by user |
| date_from | string | Start date (ISO) |
| date_to | string | End date (ISO) |
| limit | number | Limit results |
| offset | number | Offset |

#### GET /reservasi/:id
Get reservation by ID.

#### POST /reservasi/:id/check
Check reservation status with ownership.

#### PATCH /reservasi/:id/status
Update reservation status.

**Valid Status:**
- `pending` - Menunggu konfirmasi
- `confirmed` - Dikonfirmasi
- `arrived` - Sudah hadir
- `completed` - Selesai
- `cancelled` - Dibatalkan
- `no_show` - Tidak hadir

#### POST /reservasi/:id/cancel
Cancel reservation.

#### PATCH /reservasi/:id/time
Update reservation time.

**Request Body:**
```json
{
  "wa_user_id": "6281234567890",
  "reservation_date": "2025-12-25",
  "reservation_time": "10:00"
}
```

#### GET /reservasi/statistics
Get reservation statistics.

#### GET /reservasi/history/:wa_user_id
Get user reservation history.

---

### Statistics

#### GET /statistics/overview
Get overview statistics.

---

### User History

#### GET /user/:wa_user_id/history
Get user history (complaints + reservations).

**Headers:**
```
X-Internal-API-Key: <api-key>
```



---

## Channel Service API

Base URL: `http://localhost:3001` or `https://api.govconnect.my.id/channel`

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

### WhatsApp Session Management

#### GET /internal/whatsapp/status
Get WhatsApp connection status.

**Response:**
```json
{
  "status": "connected",
  "phone_number": "6281234567890",
  "name": "GovConnect Bot"
}
```

#### POST /internal/whatsapp/connect
Connect WhatsApp session.

#### POST /internal/whatsapp/disconnect
Disconnect WhatsApp session.

#### POST /internal/whatsapp/logout
Logout WhatsApp session.

#### GET /internal/whatsapp/qr
Get QR code for pairing.

**Response:**
```json
{
  "qr": "data:image/png;base64,..."
}
```

#### POST /internal/whatsapp/pairphone
Pair phone number.

**Request Body:**
```json
{
  "phone_number": "6281234567890"
}
```

#### GET /internal/whatsapp/settings
Get WhatsApp settings.

#### PATCH /internal/whatsapp/settings
Update WhatsApp settings.

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

Base URL: `http://localhost:3002` or `https://api.govconnect.my.id/ai`

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



---

## GraphQL API

Endpoint: `POST /graphql` (Case Service)

### Queries

#### services
Get all government services.

```graphql
query {
  services {
    code
    name
    description
    category
    requirements
    sop_steps
    estimated_duration
    daily_quota
    is_active
    is_online_available
    citizen_questions {
      field
      question
      type
      required
      options
    }
  }
}
```

#### service
Get service by code.

```graphql
query GetService($code: String!) {
  service(code: $code) {
    code
    name
    description
    category
    requirements
    sop_steps
    estimated_duration
    daily_quota
    citizen_questions {
      field
      question
      type
      required
      options
    }
  }
}
```

**Variables:**
```json
{
  "code": "SKD"
}
```

#### availableSlots
Get available time slots.

```graphql
query GetAvailableSlots($serviceCode: String!, $date: String!) {
  availableSlots(serviceCode: $serviceCode, date: $date) {
    service_code
    date
    day_name
    is_open
    slots {
      time
      available
      remaining
    }
    daily_quota
    total_booked
  }
}
```

**Variables:**
```json
{
  "serviceCode": "SKD",
  "date": "2025-12-24"
}
```

#### complaintCategories
Get complaint categories.

```graphql
query {
  complaintCategories {
    code
    name
    description
    icon
  }
}
```

### Mutations

#### createComplaint
Create a complaint.

```graphql
mutation CreateComplaint($input: CreateComplaintInput!) {
  createComplaint(input: $input) {
    success
    complaint_id
    message
    error
  }
}
```

**Variables:**
```json
{
  "input": {
    "kategori": "jalan_rusak",
    "deskripsi": "Jalan berlubang di depan kantor kelurahan",
    "alamat": "Jl. Merdeka No. 10",
    "rt_rw": "001/002",
    "nama_pelapor": "John Doe",
    "no_hp": "081234567890"
  }
}
```

#### createReservation
Create a reservation.

```graphql
mutation CreateReservation($input: CreateReservationInput!) {
  createReservation(input: $input) {
    success
    reservation_id
    queue_number
    message
    error
  }
}
```

**Variables:**
```json
{
  "input": {
    "service_code": "SKD",
    "reservation_date": "2025-12-24",
    "reservation_time": "09:00",
    "nama_lengkap": "John Doe",
    "nik": "1234567890123456",
    "alamat": "Jl. Merdeka No. 10",
    "no_hp": "081234567890"
  }
}
```

---

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

