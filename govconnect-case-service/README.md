# GovConnect Case Service

<!-- CI/CD Trigger: 2026-02-01-v2 - Prisma client fix -->

Service 3: REST API untuk manajemen laporan (complaints) dan permohonan layanan (service requests).

## 📋 OverviewS

Case Service adalah layanan CRUD yang mengelola:
- **Laporan** (Complaints): Laporan masalah dari warga (jalan rusak, lampu mati, dll)
- **Permohonan Layanan** (Service Requests): Permohonan layanan administrasi (surat keterangan, surat pengantar, dll)

Service ini dipanggil oleh:
- **AI Orchestrator** (Phase 2) - untuk create laporan/permohonan layanan
- **Dashboard** (Phase 4) - untuk view dan update status

## 🏗️ Architecture

- **Framework**: Express.js 5 + TypeScript
- **ORM**: Prisma 5.22.0
- **Database**: PostgreSQL (schema `cases`)
- **Message Broker**: RabbitMQ (publisher only)
- **Port**: 3003

## 📊 Database Schema

### Complaint
- `complaint_id`: LAP-YYYYMMDD-XXX (unique)
- `wa_user_id`: 628xxx
- `kategori`: jalan_rusak, lampu_mati, sampah, drainase, pohon_tumbang, fasilitas_rusak
- `deskripsi`: Deskripsi masalah
- `alamat`: Alamat lengkap (optional)
- `rt_rw`: RT/RW (optional)
- `foto_url`: URL foto bukti (optional)
- `status`: baru, proses, selesai, ditolak
- `admin_notes`: Catatan dari admin (optional)

### Service Request
- `request_number`: LAY-YYYYMMDD-XXX (unique)
- `service_id`: ID layanan
- `wa_user_id`: 628xxx
- `citizen_data_json`: Data pemohon (JSON)
- `requirement_data_json`: Data persyaratan (JSON)
- `status`: baru, proses, selesai, ditolak, dibatalkan
- `admin_notes`: Catatan dari admin (optional)

## 🔄 RabbitMQ Events

**Published Events** (ke exchange: `govconnect.events`):

1. **complaint.created**
```json
{
  "complaint_id": "LAP-20250124-001",
  "wa_user_id": "628123456789",
  "kategori": "jalan_rusak",
  "created_at": "2025-01-24T10:00:00Z"
}
```

2. **service.requested**
```json
{
  "request_number": "LAY-20250124-001",
  "wa_user_id": "628123456789",
  "service_id": "service-uuid"
}
```

3. **status.updated**
```json
{
  "type": "complaint",
  "id": "LAP-20250124-001",
  "old_status": "baru",
  "new_status": "proses",
  "updated_at": "2025-01-24T11:00:00Z"
}
```

## 🚀 API Endpoints

### Health Endpoints
- `GET /health` - Basic health check
- `GET /health/database` - Check database connectivity
- `GET /health/rabbitmq` - Check RabbitMQ connectivity

### Complaint Endpoints

#### POST /laporan/create
Create new complaint (internal only - from AI Service)

**Headers**:
```
X-Internal-API-Key: <INTERNAL_API_KEY>
```

**Request**:
```json
{
  "wa_user_id": "628123456789",
  "kategori": "jalan_rusak",
  "deskripsi": "Jalan depan rumah berlubang besar",
  "alamat": "Jl. Melati No. 21",
  "rt_rw": "RT 03 RW 05"
}
```

**Response**:
```json
{
  "status": "success",
  "data": {
    "complaint_id": "LAP-20250124-001",
    "status": "baru"
  }
}
```

#### GET /laporan
Get complaints list (with filters & pagination)

**Query Params**:
- `status`: baru | proses | selesai | ditolak
- `kategori`: jalan_rusak | lampu_mati | sampah | drainase | pohon_tumbang | fasilitas_rusak
- `rt_rw`: RT 03 RW 05
- `wa_user_id`: 628xxx
- `limit`: default 20
- `offset`: default 0

**Response**:
```json
{
  "data": [
    {
      "complaint_id": "LAP-20250124-001",
      "wa_user_id": "628123456789",
      "kategori": "jalan_rusak",
      "deskripsi": "Jalan berlubang",
      "alamat": "Jl. Melati No. 21",
      "status": "baru",
      "created_at": "2025-01-24T10:00:00Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0
  }
}
```

#### GET /laporan/:id
Get complaint by ID

**Response**:
```json
{
  "data": {
    "id": "...",
    "complaint_id": "LAP-20250124-001",
    "wa_user_id": "628123456789",
    "kategori": "jalan_rusak",
    "deskripsi": "Jalan berlubang",
    "alamat": "Jl. Melati No. 21",
    "rt_rw": "RT 03 RW 05",
    "status": "OPEN",
    "admin_notes": null,
    "created_at": "2025-01-24T10:00:00Z",
    "updated_at": "2025-01-24T10:00:00Z"
  }
}
```

#### PATCH /laporan/:id/status
Update complaint status

**Request**:
```json
{
  "status": "PROCESS",
  "admin_notes": "Tim sudah ditugaskan ke lokasi"
}
```

**Response**:
```json
{
  "status": "success",
  "data": {
    "complaint_id": "LAP-20250124-001",
    "status": "PROCESS",
    "admin_notes": "Tim sudah ditugaskan ke lokasi"
  }
}
```

#### GET /laporan/statistics
Get complaint statistics

**Response**:
```json
{
  "data": {
    "byStatus": [
      { "status": "OPEN", "count": 45 },
      { "status": "PROCESS", "count": 30 },
      { "status": "DONE", "count": 120 },
      { "status": "CANCELED", "count": 5 },
      { "status": "REJECT", "count": 2 }
    ],
    "byKategori": [
      { "kategori": "jalan_rusak", "count": 80 },
      { "kategori": "lampu_mati", "count": 50 },
      { "kategori": "sampah", "count": 30 }
    ],
    "byRtRw": [
      { "rt_rw": "RT 01 RW 01", "count": 25 },
      { "rt_rw": "RT 02 RW 01", "count": 20 }
    ],
    "recent7Days": 15
  }
}
```

### Service Request Endpoints

#### POST /service-requests
Create new service request (internal only)

**Headers**:
```
X-Internal-API-Key: <INTERNAL_API_KEY>
```

**Request**:
```json
{
  "service_id": "service-uuid",
  "wa_user_id": "628123456789",
  "citizen_data_json": {
    "nama_lengkap": "John Doe",
    "nik": "3201010101010001",
    "alamat": "Jl. Merdeka No. 10",
    "no_hp": "081234567890"
  },
  "requirement_data_json": {
    "ktp": "file://ktp.jpg"
  }
}
```

**Response**:
```json
{
  "status": "success",
  "data": {
    "request_number": "LAY-20250124-001",
    "status": "OPEN"
  }
}
```

#### GET /service-requests
Get service requests list

**Query Params**:
- `status`: OPEN | PROCESS | DONE | CANCELED | REJECT
- `service_id`: service UUID
- `wa_user_id`: 628xxx
- `request_number`: LAY-YYYYMMDD-XXX
- `village_id`: village UUID

#### GET /service-requests/:id
Get service request by ID

#### PATCH /service-requests/:id/status
Update service request status

#### POST /service-requests/:id/cancel
Cancel service request

#### GET /service-requests/history/:wa_user_id
Get service request history

## 🛠️ Development

### Prerequisites
- Node.js 23+
- pnpm 9+
- PostgreSQL 16
- RabbitMQ 3.13+

### Setup
```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm prisma generate

# Run migration
pnpm prisma migrate dev

# Start development server
pnpm dev
```

### Environment Variables
```env
# Required
DATABASE_URL="postgresql://user:pass@localhost:5432/govconnect?schema=cases"
RABBITMQ_URL="amqp://admin:pass@localhost:5672/govconnect"
INTERNAL_API_KEY="secret-key"

# Optional
NODE_ENV="development"
PORT="3003"
LOG_LEVEL="info"
LOG_DIR="logs"
ID_PREFIX_COMPLAINT="LAP"
ID_PREFIX_SERVICE_REQUEST="LAY"
```

### Scripts
- `pnpm dev` - Start development server with ts-node
- `pnpm build` - Build TypeScript to dist/
- `pnpm start` - Start production server
- `pnpm prisma:generate` - Generate Prisma client
- `pnpm prisma:migrate` - Run migrations
- `pnpm prisma:studio` - Open Prisma Studio

## 🐳 Docker

### Build
```bash
docker build -t govconnect-case-service:latest .
```

### Run with Docker Compose
```bash
cd ../../
docker compose up -d case-service
```

### Check logs
```bash
docker logs govconnect-case-service -f
```

## ✅ Testing

### Test Health
```bash
curl http://localhost:3003/health
curl http://localhost:3003/health/database
curl http://localhost:3003/health/rabbitmq
```

### Test Create Complaint
```bash
curl -X POST http://localhost:3003/laporan/create \
  -H "Content-Type: application/json" \
  -H "X-Internal-API-Key: govconnect-internal-2025-secret" \
  -d '{
    "wa_user_id": "628123456789",
    "kategori": "jalan_rusak",
    "deskripsi": "Jalan berlubang besar di depan rumah",
    "alamat": "Jl. Melati No. 21",
    "rt_rw": "RT 03 RW 05"
  }'
```

### Test Get Complaints
```bash
curl http://localhost:3003/laporan?status=baru&limit=5
```

### Test Update Status
```bash
curl -X PATCH http://localhost:3003/laporan/LAP-20250124-001/status \
  -H "Content-Type: application/json" \
  -d '{
    "status": "proses",
    "admin_notes": "Tim sudah ditugaskan"
  }'
```

## 📝 Notes

- **ID Generator**: LAP-/LAY- IDs reset daily and auto-increment
- **Authentication**: Internal endpoints require `X-Internal-API-Key` header
- **Event Publishing**: All create/update operations publish events to RabbitMQ
- **Pagination**: Default limit 20, max 100 per request
- **Validation**: All inputs validated with express-validator
- **Logging**: Winston logger with file rotation (5MB max)

## 🔗 Related Services

- **Phase 1**: Channel Service (port 3001)
- **Phase 2**: AI Orchestrator (port 3002)
- **Phase 4**: Dashboard (port 3000)
- **Phase 5**: Notification Service (port 3005)

## 📊 Folder Structure

```
govconnect-case-service/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── config/
│   │   ├── env.ts
│   │   ├── database.ts
│   │   └── rabbitmq.ts
│   ├── controllers/
│   │   ├── complaint.controller.ts
│   │   ├── complaint-meta.controller.ts
│   │   └── service-catalog.controller.ts
│   ├── services/
│   │   ├── complaint.service.ts
│   │   ├── user-history.service.ts
│   │   └── rabbitmq.service.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts
│   │   ├── validation.middleware.ts
│   │   └── error-handler.middleware.ts
│   ├── routes/
│   │   ├── complaint.routes.ts
│   │   ├── complaint-meta.routes.ts
│   │   ├── service-catalog.routes.ts
│   │   ├── statistics.routes.ts
│   │   └── health.routes.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   └── id-generator.ts
│   ├── app.ts
│   └── server.ts
├── Dockerfile
├── .dockerignore
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

**Status**: ✅ Phase 3 Complete
**Last Updated**: 2026-02-01 - CI/CD trigger for rebuild
