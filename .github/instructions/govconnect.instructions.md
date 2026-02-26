---
applyTo: 'govconnect/**/*'
---

# 🟩 GOVCONNECT WA-AI ARCHITECTURE INSTRUCTIONS

Instruksi ini wajib diikuti saat bekerja dengan project GovConnect. Baca keseluruhan file ini sebelum melakukan perubahan apapun.

## 📋 OVERVIEW

**GovConnect** adalah sistem layanan pemerintah berbasis WhatsApp dengan AI orchestrator untuk menangani laporan warga dan reservasi layanan.

### Tech Stack
- **Backend Services**: Express.js (Node.js)
- **Dashboard**: Next.js 14+ (App Router)
- **AI**: Google Gemini / OpenRouter
- **Message Broker**: RabbitMQ
- **Database**: PostgreSQL (1 DB per service)
- **ORM**: Prisma (Next.js), Sequelize/TypeORM (Express)

---

## 🏗️ ARSITEKTUR 5 SERVICES

```
┌─────────────────────────────────────────────────────────────┐
│                     USER (WhatsApp)                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVICE 1: CHANNEL SERVICE (Express.js)                     │
│  - Terima webhook WA                                         │
│  - Simpan IN message (FIFO 30)                               │
│  - Publish event: whatsapp.message.received                  │
│  - Internal API: POST /internal/send                         │
│  - Simpan OUT message (FIFO 30)                              │
│  DB: gc_channel_db                                           │
└────────────────┬────────────────────────────────────────────┘
                 │ (RabbitMQ Event)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVICE 2: AI ORCHESTRATOR (Express.js)                     │
│  - Consume: whatsapp.message.received                        │
│  - Fetch 30 history dari Service 1                           │
│  - Call LLM (structured JSON output)                         │
│  - SYNC call ke Service 3 (laporan/reservasi)                │
│  - Publish: govconnect.ai.reply                              │
│  DB: ❌ STATELESS (No DB)                                    │
└────────────────┬────────────────────────────────────────────┘
                 │ (REST API + RabbitMQ)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVICE 3: CASE SERVICE (Express.js)                        │
│  - POST /laporan/create                                      │
│  - POST /reservasi/create                                    │
│  - Validasi & simpan ke DB                                   │
│  - Publish: govconnect.complaint.created                     │
│  - API untuk Dashboard (GET/PATCH)                           │
│  DB: gc_case_db                                              │
└────────────────┬────────────────────────────────────────────┘
                 │ (RabbitMQ Event)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVICE 5: NOTIFICATION SERVICE (Express.js)                │
│  - Consume: govconnect.ai.reply                              │
│  - Consume: govconnect.complaint.created                     │
│  - Build template pesan                                      │
│  - POST /internal/send ke Service 1                          │
│  - Log notification                                          │
│  DB: gc_notification_db                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  SERVICE 4: DASHBOARD (Next.js)                              │
│  - Login admin (JWT/session)                                 │
│  - View laporan/reservasi (REST ke Service 3)                │
│  - Update status                                             │
│  - Statistik & charts                                        │
│  DB: gc_dashboard_db                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔥 ATURAN FUNDAMENTAL

### 1. SATU SERVICE = SATU DATABASE
- Setiap service memiliki database PostgreSQL sendiri
- **DILARANG** direct database access antar service
- Komunikasi antar service: REST API atau RabbitMQ event
- Service 2 (AI) adalah STATELESS - tidak punya database dan tidak menyimpan sesi di memori persisten

### 2. MESSAGE FLOW PATTERN
- **Inbound**: WA → Service 1 → Event → Service 2 → LLM → Service 3
- **Outbound**: Service 5 → Service 1 → WA
- **History**: Semua chat history HANYA di Service 1 (gunakan `channel` + `channel_identifier`)

### 3. FIFO 30 MESSAGES
Service 1 wajib maintain maksimal 30 pesan per user:
- Simpan IN message baru
- Simpan OUT message baru  
- Auto-delete pesan tertua jika > 30
- Query: `ORDER BY timestamp DESC LIMIT 30`

### 4. AI STRUCTURED OUTPUT
LLM wajib return JSON dengan format:
```json
{
  "intent": "CREATE_COMPLAINT|CREATE_RESERVATION|CHECK_STATUS|CANCEL_COMPLAINT|CANCEL_RESERVATION|HISTORY|KNOWLEDGE_QUERY|QUESTION|UNKNOWN",
  "fields": {
    "kategori": "...",
    "alamat": "...",
    "deskripsi": "..."
  },
  "reply_text": "Baik, laporan Anda kami proses..."
}
```

### 5. SYNC VS ASYNC
- Service 2 → Service 3: **SYNC** (HTTP POST, tunggu response)
- Event publishing: **ASYNC** (fire and forget via RabbitMQ)
- Notification: **ASYNC** (consume event)

---

## 📊 DATABASE SCHEMAS

### SERVICE 1: gc_channel_db

```prisma
model Message {
  id          String   @id @default(cuid())
  wa_user_id  String   // 628xxx (nomor WA user)
  message_id  String   @unique // message ID dari WA provider
  message_text String  @db.Text
  direction   String   // "IN" | "OUT"
  source      String   // "WA_WEBHOOK" | "AI" | "SYSTEM"
  timestamp   DateTime @default(now())
  createdAt   DateTime @default(now())
  
  @@index([wa_user_id, timestamp])
  @@index([direction])
}

model SendLog {
  id          String   @id @default(cuid())
  wa_user_id  String
  message_text String  @db.Text
  status      String   // "sent" | "failed"
  error_msg   String?  @db.Text
  timestamp   DateTime @default(now())
  
  @@index([wa_user_id])
  @@index([status])
}
```

### SERVICE 2: AI Orchestrator
❌ **NO DATABASE** - Fully stateless

### SERVICE 3: gc_case_db

```prisma
model Complaint {
  id            String   @id @default(cuid())
  complaint_id  String   @unique // LAP-20250101-001
  wa_user_id    String
  kategori      String
  deskripsi     String   @db.Text
  alamat        String?
  rt_rw         String?
  foto_url      String?
  status        String   @default("baru") // baru|proses|selesai|ditolak
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  
  @@index([wa_user_id])
  @@index([status])
  @@index([kategori])
  @@index([created_at])
}

model Ticket {
  id            String   @id @default(cuid())
  ticket_id     String   @unique // TIK-20250101-001
  wa_user_id    String
  jenis         String   // "surat_keterangan" | "surat_pengantar" | dll
  data_json     Json     // Flexible field untuk berbagai tipe tiket
  status        String   @default("pending") // pending|proses|selesai|ditolak
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  
  @@index([wa_user_id])
  @@index([status])
  @@index([jenis])
}
```

### SERVICE 4: gc_dashboard_db

```prisma
model AdminUser {
  id            String   @id @default(cuid())
  username      String   @unique
  password_hash String
  name          String
  role          String   @default("admin") // admin|superadmin
  is_active     Boolean  @default(true)
  created_at    DateTime @default(now())
  
  sessions      AdminSession[]
  activityLogs  ActivityLog[]
}

model AdminSession {
  id         String   @id @default(cuid())
  admin_id   String
  token      String   @unique
  expires_at DateTime
  created_at DateTime @default(now())
  
  admin      AdminUser @relation(fields: [admin_id], references: [id])
  
  @@index([admin_id])
  @@index([expires_at])
}

model ActivityLog {
  id         String   @id @default(cuid())
  admin_id   String
  action     String   // "update_status" | "login" | "view_complaint"
  resource   String   // "complaint:LAP-001" | "ticket:TIK-001"
  details    Json?
  ip_address String?
  timestamp  DateTime @default(now())
  
  admin      AdminUser @relation(fields: [admin_id], references: [id])
  
  @@index([admin_id])
  @@index([timestamp])
}
```

### SERVICE 5: gc_notification_db

```prisma
model NotificationLog {
  id            String   @id @default(cuid())
  wa_user_id    String
  message_text  String   @db.Text
  notification_type String // "ai_reply" | "complaint_created" | "ticket_created"
  status        String   // "sent" | "failed"
  error_msg     String?  @db.Text
  sent_at       DateTime @default(now())
  
  @@index([wa_user_id])
  @@index([status])
  @@index([sent_at])
}
```

---

## 🔄 RABBITMQ EVENTS

### Exchange: `govconnect.events` (type: topic)

| Event Name | Producer | Consumer | Payload |
|------------|----------|----------|---------|
| `whatsapp.message.received` | Service 1 | Service 2 | `{ wa_user_id, message, received_at, message_id }` |
| `govconnect.ai.reply` | Service 2 | Service 5 | `{ wa_user_id, reply_text }` |
| `govconnect.complaint.created` | Service 3 | Service 5 | `{ wa_user_id, complaint_id, kategori }` |
| `govconnect.ticket.created` | Service 3 | Service 5 | `{ wa_user_id, ticket_id, jenis }` |

### Queue Pattern
- Queue name: `{service_name}.{event_pattern}`
- Example: `ai-service.whatsapp.message.#`
- Durable: `true`
- Auto-delete: `false`

---

## 📝 CODING GUIDELINES

### Service Structure (Express.js)
```
govconnect-{service-name}/
├── src/
│   ├── config/
│   │   ├── database.js      # Prisma/Sequelize client
│   │   ├── rabbitmq.js      # RabbitMQ connection
│   │   └── env.js           # Env validation
│   ├── controllers/
│   │   ├── webhook.controller.js
│   │   └── internal.controller.js
│   ├── services/
│   │   ├── message.service.js
│   │   ├── rabbitmq.service.js
│   │   └── wa.service.js
│   ├── middleware/
│   │   ├── auth.middleware.js
│   │   └── validation.middleware.js
│   ├── routes/
│   │   ├── webhook.routes.js
│   │   └── internal.routes.js
│   ├── models/              # Prisma schema atau Sequelize models
│   ├── utils/
│   │   ├── logger.js
│   │   └── error-handler.js
│   └── app.js               # Express app setup
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── .env.example
├── package.json
└── README.md
```

### Dashboard Structure (Next.js)
```
govconnect-dashboard/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   └── layout.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx          # Overview
│   │   │   ├── laporan/
│   │   │   │   ├── page.tsx      # List laporan
│   │   │   │   └── [id]/page.tsx # Detail
│   │   │   ├── reservasi/
│   │   │   ├── layanan/
│   │   │   └── statistik/
│   │   └── api/
│   │       ├── auth/
│   │       └── proxy/            # Proxy ke Service 3
│   ├── components/
│   │   ├── ui/                   # shadcn components
│   │   ├── dashboard/
│   │   │   ├── header.tsx
│   │   │   ├── sidebar.tsx
│   │   │   └── stats-card.tsx
│   │   └── laporan/
│   ├── lib/
│   │   ├── api-client.ts         # Axios/Fetch wrapper
│   │   └── utils.ts
│   └── types/
├── prisma/
├── public/
└── package.json
```

### Naming Conventions
- **Files**: kebab-case (`message.service.js`)
- **Classes**: PascalCase (`MessageService`)
- **Functions**: camelCase (`sendMessage`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_MESSAGES`)
- **Database**: snake_case (`wa_user_id`, `created_at`)
- **API Endpoints**: kebab-case (`/api/laporan/create`)

### Environment Variables Pattern
```bash
# SERVICE 1 - Channel Service
NODE_ENV=development
PORT=3001

# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/gc_channel_db"

# RabbitMQ
RABBITMQ_URL="amqp://user:pass@localhost:5672"

# WA Provider (genfity-wa / whatsapp-api)
# WA_API_URL harus mengarah ke prefix `/v1/wa`
WA_API_URL="https://api-wa.genfity.com/v1/wa"

# Token fallback (opsional). Umumnya token sesi disimpan otomatis di DB internal.
WA_ACCESS_TOKEN=""

# Dry run (opsional) untuk testing tanpa outbound call
WA_DRY_RUN=false

# Internal API Keys (untuk inter-service auth)
INTERNAL_API_KEY="govconnect-internal-2025-secret"
```

---

## 🚀 API CONTRACTS

### SERVICE 1: Channel Service

#### POST /webhook/whatsapp
```typescript
// Request (dari WA Provider)
{
  "messaging_product": "whatsapp",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "628123456789",
          "id": "wamid.xxx",
          "timestamp": "1234567890",
          "text": { "body": "jalan rusak depan rumah" }
        }]
      }
    }]
  }]
}

// Response
{ "status": "ok" }
```

#### POST /internal/send (Internal Only)
```typescript
// Request (dari Service 5)
{
  "wa_user_id": "628123456789",
  "message": "Laporan Anda #LAP-001 sedang diproses"
}

// Response
{
  "status": "sent",
  "message_id": "wamid.yyy"
}
```

#### GET /internal/messages (Internal Only)
```typescript
// Request
GET /internal/messages?wa_user_id=628123456789&limit=30

// Response
{
  "messages": [
    {
      "id": "msg-1",
      "message_text": "jalan rusak",
      "direction": "IN",
      "timestamp": "2025-01-15T10:00:00Z"
    },
    {
      "id": "msg-2",
      "message_text": "Baik, laporan diterima",
      "direction": "OUT",
      "source": "AI",
      "timestamp": "2025-01-15T10:00:05Z"
    }
  ],
  "total": 2
}
```

### SERVICE 2: AI Orchestrator
❌ **No public API** - hanya consume RabbitMQ events

### SERVICE 3: Case Service

#### POST /laporan/create (Internal/API)
```typescript
// Request (dari Service 2)
{
  "wa_user_id": "628123456789",
  "kategori": "jalan_rusak",
  "deskripsi": "lubang besar di jalan depan rumah",
  "alamat": "Jl Melati No 21",
  "rt_rw": "RT 03 RW 05"
}

// Response
{
  "status": "success",
  "data": {
    "complaint_id": "LAP-20250115-001",
    "status": "baru"
  }
}
```

#### GET /laporan (Public API untuk Dashboard)
```typescript
// Request
GET /laporan?status=baru&limit=20&offset=0

// Response
{
  "data": [
    {
      "complaint_id": "LAP-20250115-001",
      "wa_user_id": "628123456789",
      "kategori": "jalan_rusak",
      "status": "baru",
      "created_at": "2025-01-15T10:00:00Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0
  }
}
```

#### PATCH /laporan/:id/status
```typescript
// Request
{
  "status": "proses",
  "admin_notes": "Tim sudah ditugaskan"
}

// Response
{
  "status": "success",
  "data": {
    "complaint_id": "LAP-20250115-001",
    "status": "proses"
  }
}
```

### SERVICE 4: Dashboard
Frontend Next.js - semua API call ke Service 3

### SERVICE 5: Notification Service
❌ **No public API** - hanya consume RabbitMQ events

---

## 🎯 LLM PROMPT ENGINEERING

### System Prompt Template
```
Anda adalah asisten AI untuk GovConnect - sistem layanan pemerintah via WhatsApp.

ATURAN OUTPUT:
1. Anda WAJIB mengembalikan HANYA JSON VALID
2. Format JSON WAJIB sesuai schema
3. JANGAN tambahkan text/penjelasan di luar JSON
4. JANGAN gunakan markdown code block

SCHEMA OUTPUT:
{
  "intent": "CREATE_COMPLAINT | CREATE_TICKET | QUESTION | UNKNOWN",
  "fields": {
    "kategori": "jalan_rusak | lampu_mati | sampah | dll",
    "alamat": "alamat lengkap",
    "deskripsi": "deskripsi detail masalah",
    "rt_rw": "RT XX RW YY (jika disebutkan)"
  },
  "reply_text": "Balasan ramah untuk user"
}

KATEGORI LAPORAN:
- jalan_rusak: Jalan berlubang, rusak, butuh perbaikan
- lampu_mati: Lampu jalan mati/rusak
- sampah: Masalah sampah menumpuk
- drainase: Saluran air tersumbat
- pohon_tumbang: Pohon tumbang menghalangi jalan
- fasilitas_rusak: Fasilitas umum rusak (taman, dll)

JENIS TIKET:
- surat_keterangan: Surat keterangan domisili, usaha, dll
- surat_pengantar: Surat pengantar berbagai keperluan
- izin_keramaian: Izin acara/keramaian

CARA EKSTRAKSI:
1. Baca pesan user dengan seksama
2. Tentukan intent: laporan (complaint) atau tiket layanan
3. Ekstrak informasi yang ada (kategori, alamat, deskripsi)
4. Jika informasi kurang lengkap, tanyakan di reply_text
5. Jika user bertanya biasa (bukan laporan/tiket), gunakan intent "QUESTION"

CONTOH INPUT/OUTPUT:

Input: "jalan depan rumah rusak pak, banyak lubang"
Output:
{
  "intent": "CREATE_COMPLAINT",
  "fields": {
    "kategori": "jalan_rusak",
    "deskripsi": "jalan depan rumah rusak, banyak lubang",
    "alamat": ""
  },
  "reply_text": "Baik Pak/Bu, saya akan catat laporan jalan rusak Anda. Untuk mempercepat penanganan, boleh sebutkan alamat lengkapnya?"
}

Input: "Jl Melati 21 RT 03 RW 05"
Output:
{
  "intent": "CREATE_COMPLAINT",
  "fields": {
    "alamat": "Jl Melati 21",
    "rt_rw": "RT 03 RW 05"
  },
  "reply_text": "Terima kasih. Laporan Anda tentang jalan rusak di Jl Melati 21 RT 03 RW 05 sudah kami terima dengan nomor LAP-20250115-001. Tim kami akan segera meninjau lokasi."
}

Input: "mau buat surat keterangan domisili"
Output:
{
  "intent": "CREATE_TICKET",
  "fields": {
    "jenis": "surat_keterangan",
    "deskripsi": "surat keterangan domisili"
  },
  "reply_text": "Baik, untuk pembuatan surat keterangan domisili, saya buatkan tiket TIK-20250115-001. Mohon siapkan: KTP, KK, dan datang ke kantor kelurahan dengan tiket ini."
}

CONVERSATION HISTORY:
{history}

PESAN TERAKHIR USER:
{user_message}
```

### JSON Schema Enforcement (Gemini)
```typescript
const schema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["CREATE_COMPLAINT", "CREATE_TICKET", "QUESTION", "UNKNOWN"]
    },
    fields: {
      type: "object",
      properties: {
        kategori: { type: "string" },
        alamat: { type: "string" },
        deskripsi: { type: "string" },
        rt_rw: { type: "string" },
        jenis: { type: "string" }
      }
    },
    reply_text: { type: "string" }
  },
  required: ["intent", "fields", "reply_text"]
};

// Gemini API call dengan schema
const result = await model.generateContent({
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  generationConfig: {
    temperature: 0.3,
    responseMimeType: "application/json",
    responseSchema: schema
  }
});
```

---

## ⚡ PERFORMANCE & BEST PRACTICES

### 1. Database Query Optimization
```javascript
// GOOD: Index + Limit
const messages = await prisma.message.findMany({
  where: { wa_user_id: userId },
  orderBy: { timestamp: 'desc' },
  take: 30
});

// BAD: No limit, load semua
const messages = await prisma.message.findMany({
  where: { wa_user_id: userId }
});
```

### 2. FIFO Implementation
```javascript
async function saveMessage(data) {
  // 1. Save new message
  await prisma.message.create({ data });
  
  // 2. Count messages
  const count = await prisma.message.count({
    where: { wa_user_id: data.wa_user_id }
  });
  
  // 3. Delete oldest if > 30
  if (count > 30) {
    const oldestMessages = await prisma.message.findMany({
      where: { wa_user_id: data.wa_user_id },
      orderBy: { timestamp: 'asc' },
      take: count - 30,
      select: { id: true }
    });
    
    await prisma.message.deleteMany({
      where: {
        id: { in: oldestMessages.map(m => m.id) }
      }
    });
  }
}
```

### 3. RabbitMQ Retry Strategy
```javascript
const retryQueue = channel.assertQueue('retry_queue', {
  durable: true,
  arguments: {
    'x-message-ttl': 60000, // 60 seconds
    'x-dead-letter-exchange': 'govconnect.events',
    'x-dead-letter-routing-key': 'retry.original'
  }
});
```

### 4. Error Handling Pattern
```javascript
// Wrapper untuk semua async operations
async function safeExecute(fn, context) {
  try {
    return await fn();
  } catch (error) {
    logger.error(`Error in ${context}:`, error);
    // Metrics/monitoring
    metrics.increment('error', { context });
    throw error;
  }
}

// Usage
app.post('/webhook', async (req, res) => {
  try {
    await safeExecute(
      () => processWebhook(req.body),
      'webhook-handler'
    );
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 5. Rate Limiting (Service 1)
```javascript
const rateLimit = require('express-rate-limit');

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // max 100 requests per minute
  message: 'Too many requests'
});

app.post('/webhook/whatsapp', webhookLimiter, handleWebhook);
```

---

## 🔐 SECURITY

### 1. Internal API Authentication
```javascript
// Middleware untuk internal calls
function internalAuth(req, res, next) {
  const apiKey = req.headers['x-internal-api-key'];
  
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  next();
}

app.post('/internal/send', internalAuth, sendMessage);
```

### 2. Admin Dashboard JWT
```typescript
// Generate JWT
import jwt from 'jsonwebtoken';

function generateToken(adminId: string) {
  return jwt.sign(
    { adminId, role: 'admin' },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  );
}

// Verify middleware
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

### 3. Input Validation
```javascript
const { body, validationResult } = require('express-validator');

app.post('/laporan/create',
  [
    body('wa_user_id').matches(/^628\d{8,12}$/),
    body('kategori').isIn([
      'jalan_rusak', 'lampu_mati', 'sampah', 
      'drainase', 'pohon_tumbang', 'fasilitas_rusak'
    ]),
    body('deskripsi').isLength({ min: 10, max: 1000 })
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // Process...
  }
);
```

---

## 📊 MONITORING & LOGGING

### Log Format Standard
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    })
  ]
});

// Usage dengan context
logger.info('Message received', {
  service: 'channel-service',
  wa_user_id: '628123456789',
  message_id: 'wamid.xxx',
  event: 'webhook.received'
});
```

### Metrics to Track
- **Service 1**: Webhook receive rate, send success rate, FIFO queue length
- **Service 2**: LLM latency, token usage, intent distribution
- **Service 3**: Laporan created per hour, ticket created per hour
- **Service 5**: Notification success rate

---

## 🧪 TESTING

### Unit Test Pattern (Jest)
```javascript
describe('MessageService', () => {
  describe('saveMessageWithFIFO', () => {
    it('should keep only 30 messages per user', async () => {
      // Arrange
      const userId = '628123456789';
      
      // Create 35 messages
      for (let i = 0; i < 35; i++) {
        await messageService.saveMessage({
          wa_user_id: userId,
          message_text: `Message ${i}`,
          direction: 'IN',
          source: 'WA_WEBHOOK'
        });
      }
      
      // Act
      const messages = await prisma.message.findMany({
        where: { wa_user_id: userId }
      });
      
      // Assert
      expect(messages.length).toBe(30);
      expect(messages[0].message_text).toBe('Message 5'); // Oldest
      expect(messages[29].message_text).toBe('Message 34'); // Newest
    });
  });
});
```

### Integration Test (Service 2 → Service 3)
```javascript
describe('AI to Case Service Integration', () => {
  it('should create complaint when intent is CREATE_COMPLAINT', async () => {
    // Mock LLM response
    const llmResponse = {
      intent: 'CREATE_COMPLAINT',
      fields: {
        kategori: 'jalan_rusak',
        deskripsi: 'lubang besar',
        alamat: 'Jl Melati 21'
      },
      reply_text: 'Laporan diterima'
    };
    
    // Call Service 3 API
    const response = await axios.post(
      'http://localhost:3003/laporan/create',
      {
        wa_user_id: '628123456789',
        ...llmResponse.fields
      }
    );
    
    expect(response.status).toBe(201);
    expect(response.data.complaint_id).toMatch(/^LAP-/);
  });
});
```

---

## 📦 DEPLOYMENT

### Docker Compose Structure
```yaml
version: '3.8'

services:
  # RabbitMQ
  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: secret

  # PostgreSQL instances
  db-channel:
    image: postgres:15
    environment:
      POSTGRES_DB: gc_channel_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
    volumes:
      - pgdata-channel:/var/lib/postgresql/data

  db-case:
    image: postgres:15
    environment:
      POSTGRES_DB: gc_case_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
    volumes:
      - pgdata-case:/var/lib/postgresql/data

  # Services
  channel-service:
    build: ./govconnect-channel-service
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://postgres:secret@db-channel:5432/gc_channel_db
      RABBITMQ_URL: amqp://admin:secret@rabbitmq:5672
    depends_on:
      - db-channel
      - rabbitmq

  ai-service:
    build: ./govconnect-ai-service
    environment:
      RABBITMQ_URL: amqp://admin:secret@rabbitmq:5672
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      CHANNEL_SERVICE_URL: http://channel-service:3001
      CASE_SERVICE_URL: http://case-service:3003
    depends_on:
      - rabbitmq
      - channel-service
      - case-service

  case-service:
    build: ./govconnect-case-service
    ports:
      - "3003:3003"
    environment:
      DATABASE_URL: postgresql://postgres:secret@db-case:5432/gc_case_db
      RABBITMQ_URL: amqp://admin:secret@rabbitmq:5672
    depends_on:
      - db-case
      - rabbitmq

  notification-service:
    build: ./govconnect-notification-service
    environment:
      DATABASE_URL: postgresql://postgres:secret@db-notification:5432/gc_notification_db
      RABBITMQ_URL: amqp://admin:secret@rabbitmq:5672
      CHANNEL_SERVICE_URL: http://channel-service:3001
    depends_on:
      - db-notification
      - rabbitmq
      - channel-service

  dashboard:
    build: ./govconnect-dashboard
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:secret@db-dashboard:5432/gc_dashboard_db
      CASE_SERVICE_URL: http://case-service:3003
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      - db-dashboard
      - case-service

volumes:
  pgdata-channel:
  pgdata-case:
  pgdata-notification:
  pgdata-dashboard:
```

---

## ❌ COMMON MISTAKES TO AVOID

### 1. ❌ Direct DB Access Antar Service
```javascript
// WRONG
const { PrismaClient } = require('@prisma/client');
const caseDB = new PrismaClient({
  datasourceUrl: 'postgresql://localhost:5432/gc_case_db'
});
const complaints = await caseDB.complaint.findMany();

// CORRECT
const response = await axios.get(
  'http://case-service:3003/laporan',
  {
    headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY }
  }
);
const complaints = response.data;
```

### 2. ❌ Synchronous RabbitMQ Publishing
```javascript
// WRONG - blocking
await channel.publish('exchange', 'key', Buffer.from(message));
await channel.publish('exchange', 'key2', Buffer.from(message2));

// CORRECT - async fire and forget
channel.publish('exchange', 'key', Buffer.from(message));
channel.publish('exchange', 'key2', Buffer.from(message2));
```

### 3. ❌ No FIFO Maintenance
```javascript
// WRONG - akan numpuk terus
await prisma.message.create({ data });

// CORRECT - enforce FIFO 30
await prisma.message.create({ data });
await enforeFIFO(data.wa_user_id, 30);
```

### 4. ❌ LLM Response Not Parsed
```javascript
// WRONG - assume LLM always return valid JSON
const response = await gemini.generateContent(prompt);
const data = JSON.parse(response.text); // bisa error

// CORRECT - handle parsing error
try {
  const response = await gemini.generateContent(prompt);
  const data = JSON.parse(response.text);
  
  // Validate schema
  if (!data.intent || !data.reply_text) {
    throw new Error('Invalid LLM response structure');
  }
  
  return data;
} catch (error) {
  logger.error('LLM response parsing failed:', error);
  // Fallback response
  return {
    intent: 'UNKNOWN',
    fields: {},
    reply_text: 'Maaf, saya tidak mengerti. Bisa ulangi?'
  };
}
```

### 5. ❌ No Webhook Idempotency
```javascript
// WRONG - process duplicate message
app.post('/webhook', async (req, res) => {
  await processMessage(req.body);
  res.json({ status: 'ok' });
});

// CORRECT - check message_id first
app.post('/webhook', async (req, res) => {
  const messageId = req.body.entry[0].changes[0].value.messages[0].id;
  
  const exists = await prisma.message.findUnique({
    where: { message_id: messageId }
  });
  
  if (exists) {
    return res.json({ status: 'duplicate', skipped: true });
  }
  
  await processMessage(req.body);
  res.json({ status: 'ok' });
});
```

---

## 📚 REFERENCE CODE SNIPPETS

### Service 1: FIFO Helper
```javascript
// src/services/message.service.js
async function enforeFIFO(waUserId, maxMessages = 30) {
  const count = await prisma.message.count({
    where: { wa_user_id: waUserId }
  });
  
  if (count > maxMessages) {
    const toDelete = count - maxMessages;
    const oldestMessages = await prisma.message.findMany({
      where: { wa_user_id: waUserId },
      orderBy: { timestamp: 'asc' },
      take: toDelete,
      select: { id: true }
    });
    
    await prisma.message.deleteMany({
      where: { id: { in: oldestMessages.map(m => m.id) } }
    });
    
    console.log(`🗑️  Deleted ${toDelete} old messages for user ${waUserId}`);
  }
}
```

### Service 2: Context Builder
```javascript
// src/services/context-builder.service.js
async function buildContext(waUserId) {
  // Fetch 30 messages dari Service 1
  const response = await axios.get(
    `${process.env.CHANNEL_SERVICE_URL}/internal/messages`,
    {
      params: { wa_user_id: waUserId, limit: 30 },
      headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY }
    }
  );
  
  const messages = response.data.messages;
  
  // Build conversation history
  const history = messages
    .reverse() // oldest first
    .map(m => {
      const role = m.direction === 'IN' ? 'User' : 'Assistant';
      return `${role}: ${m.message_text}`;
    })
    .join('\n');
  
  return history;
}
```

### Service 2: LLM Call dengan Schema
```javascript
// src/services/gemini.service.js
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function askLLM(systemPrompt, userMessage, conversationHistory) {
  const model = genAI.getGenerativeModel({ 
    model: 'gemini-1.5-flash',
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          intent: { 
            type: 'string',
            enum: ['CREATE_COMPLAINT', 'CREATE_TICKET', 'QUESTION', 'UNKNOWN']
          },
          fields: {
            type: 'object',
            properties: {
              kategori: { type: 'string' },
              alamat: { type: 'string' },
              deskripsi: { type: 'string' },
              rt_rw: { type: 'string' },
              jenis: { type: 'string' }
            }
          },
          reply_text: { type: 'string' }
        },
        required: ['intent', 'fields', 'reply_text']
      }
    }
  });
  
  const fullPrompt = `${systemPrompt}\n\nCONVERSATION HISTORY:\n${conversationHistory}\n\nPESAN TERAKHIR USER:\n${userMessage}`;
  
  const result = await model.generateContent(fullPrompt);
  const responseText = result.response.text();
  
  return JSON.parse(responseText);
}
```

### Service 5: Notification Template
```javascript
// src/services/template.service.js
function buildNotificationMessage(eventType, data) {
  switch (eventType) {
    case 'complaint_created':
      return `✅ *Laporan Diterima*\n\nNomor Laporan: ${data.complaint_id}\nKategori: ${data.kategori}\nStatus: Baru\n\nLaporan Anda sedang kami proses. Anda akan menerima update melalui WhatsApp ini.\n\nTerima kasih telah menggunakan GovConnect! 🙏`;
      
    case 'ticket_created':
      return `🎫 *Tiket Layanan Dibuat*\n\nNomor Tiket: ${data.ticket_id}\nJenis: ${data.jenis}\n\nSilakan datang ke kantor kelurahan dengan membawa tiket ini.\n\nJam Pelayanan: Senin-Jumat, 08:00-15:00`;
      
    case 'status_updated':
      return `📢 *Update Status Laporan*\n\nNomor: ${data.complaint_id}\nStatus: ${data.status}\n\n${data.admin_notes || 'Terima kasih atas kesabaran Anda.'}`;
      
    default:
      return data.reply_text;
  }
}
```

---

## 🎓 LEARNING RESOURCES

### Express.js Best Practices
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Node.js Error Handling](https://nodejs.org/en/docs/guides/error-handling/)

### Next.js App Router
- [Next.js 16 Documentation](https://nextjs.org/docs)
- [App Router Patterns](https://nextjs.org/docs/app/building-your-application/routing)

### RabbitMQ
- [RabbitMQ Tutorials](https://www.rabbitmq.com/tutorials)
- [Node.js AMQP Client](https://github.com/amqp-node/amqplib)

### Gemini AI
- [Gemini API Quickstart](https://ai.google.dev/tutorials/node_quickstart)
- [JSON Schema in Gemini](https://ai.google.dev/docs/json_mode)

---

## 🏁 CHECKLIST SEBELUM DEPLOY

- [ ] All services have proper error handling
- [ ] FIFO enforcement tested (30 messages max)
- [ ] LLM JSON schema validated
- [ ] Internal API auth implemented
- [ ] Database migrations applied
- [ ] RabbitMQ queues declared
- [ ] Environment variables documented
- [ ] Webhook idempotency tested
- [ ] Rate limiting configured
- [ ] Logging implemented
- [ ] Metrics tracking ready
- [ ] Docker Compose tested locally
- [ ] Integration tests pass
- [ ] Security headers configured
- [ ] CORS properly set

---