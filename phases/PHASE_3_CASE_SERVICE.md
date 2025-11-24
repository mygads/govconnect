# PHASE 3: CASE SERVICE (Express.js)

**Duration**: 6-8 jam  
**Complexity**: ⭐⭐ Medium  
**Prerequisites**: Phase 0, Phase 1, Phase 2 completed

---

## 🎯 OBJECTIVES

- Setup Express.js project dengan Prisma ORM
- Implement REST API untuk create & manage laporan/tiket
- Publish RabbitMQ events untuk notifikasi
- Setup database `gc_case_db`
- Create API endpoints untuk Dashboard

---

## 📋 CHECKLIST

### 1. Project Setup
- [ ] Create folder: `govconnect-case-service/`
- [ ] Initialize npm: `pnpm init`
- [ ] Install: Express, TypeScript, Prisma, amqplib, express-validator, winston
- [ ] Setup folder structure

### 2. Database Schema (Prisma)
- [ ] Initialize Prisma: `gc_case_db`
- [ ] Model `Complaint`:
  - [ ] complaint_id (LAP-YYYYMMDD-XXX)
  - [ ] wa_user_id, kategori, deskripsi, alamat, rt_rw
  - [ ] status (baru|proses|selesai|ditolak)
  - [ ] foto_url (optional)
  - [ ] created_at, updated_at
- [ ] Model `Ticket`:
  - [ ] ticket_id (TIK-YYYYMMDD-XXX)
  - [ ] wa_user_id, jenis, data_json
  - [ ] status (pending|proses|selesai|ditolak)
  - [ ] created_at, updated_at
- [ ] Run migration

### 3. Core Services
- [ ] **Complaint Service** (`src/services/complaint.service.ts`):
  - [ ] `createComplaint()` - generate ID, save to DB
  - [ ] `getComplaintById()`
  - [ ] `getComplaintsList()` - with filters & pagination
  - [ ] `updateComplaintStatus()`
  - [ ] `getStatistics()` - count by status, kategori
- [ ] **Ticket Service** (`src/services/ticket.service.ts`):
  - [ ] `createTicket()` - generate ID, save to DB
  - [ ] `getTicketById()`
  - [ ] `getTicketsList()` - with filters & pagination
  - [ ] `updateTicketStatus()`
- [ ] **ID Generator** (`src/utils/id-generator.ts`):
  - [ ] Generate LAP-YYYYMMDD-001 format
  - [ ] Generate TIK-YYYYMMDD-001 format
  - [ ] Auto-increment per day
- [ ] **RabbitMQ Publisher** (`src/services/rabbitmq.service.ts`):
  - [ ] Publish `govconnect.complaint.created`
  - [ ] Publish `govconnect.ticket.created`
  - [ ] Publish `govconnect.status.updated`

### 4. Controllers
- [ ] **Complaint Controller**:
  - [ ] POST `/laporan/create` (from Service 2)
  - [ ] GET `/laporan` (for Dashboard)
  - [ ] GET `/laporan/:id`
  - [ ] PATCH `/laporan/:id/status`
- [ ] **Ticket Controller**:
  - [ ] POST `/tiket/create` (from Service 2)
  - [ ] GET `/tiket`
  - [ ] GET `/tiket/:id`
  - [ ] PATCH `/tiket/:id/status`
- [ ] **Statistics Controller**:
  - [ ] GET `/statistics/overview`
  - [ ] GET `/statistics/by-category`
  - [ ] GET `/statistics/by-rt-rw`

### 5. Middleware
- [ ] Internal API auth
- [ ] Input validation
- [ ] Error handler

### 6. Testing
- [ ] Unit tests (ID generator, validation)
- [ ] Integration tests (create & retrieve)
- [ ] API tests via Postman

### 7. Documentation
- [ ] README with API docs
- [ ] `.env.example`

---

## 💾 DATABASE SCHEMA

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Complaint {
  id           String   @id @default(cuid())
  complaint_id String   @unique
  wa_user_id   String
  kategori     String
  deskripsi    String   @db.Text
  alamat       String?
  rt_rw        String?
  foto_url     String?
  status       String   @default("baru") // baru|proses|selesai|ditolak
  admin_notes  String?  @db.Text
  created_at   DateTime @default(now())
  updated_at   DateTime @updatedAt
  
  @@index([wa_user_id])
  @@index([status])
  @@index([kategori])
  @@index([created_at])
  @@map("complaints")
}

model Ticket {
  id         String   @id @default(cuid())
  ticket_id  String   @unique
  wa_user_id String
  jenis      String   // surat_keterangan|surat_pengantar|izin_keramaian
  data_json  Json
  status     String   @default("pending") // pending|proses|selesai|ditolak
  admin_notes String? @db.Text
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  
  @@index([wa_user_id])
  @@index([status])
  @@index([jenis])
  @@index([created_at])
  @@map("tickets")
}
```

---

## 🔧 CORE IMPLEMENTATION

### ID Generator

`src/utils/id-generator.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function generateComplaintId(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  // Count today's complaints
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));
  
  const count = await prisma.complaint.count({
    where: {
      created_at: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });
  
  const sequence = String(count + 1).padStart(3, '0');
  return `LAP-${dateStr}-${sequence}`;
}

export async function generateTicketId(): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));
  
  const count = await prisma.ticket.count({
    where: {
      created_at: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });
  
  const sequence = String(count + 1).padStart(3, '0');
  return `TIK-${dateStr}-${sequence}`;
}
```

---

### Complaint Service

`src/services/complaint.service.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import { generateComplaintId } from '../utils/id-generator';
import { publishEvent } from './rabbitmq.service';
import logger from '../utils/logger';

const prisma = new PrismaClient();

interface CreateComplaintData {
  wa_user_id: string;
  kategori: string;
  deskripsi: string;
  alamat?: string;
  rt_rw?: string;
  foto_url?: string;
}

export async function createComplaint(data: CreateComplaintData) {
  const complaint_id = await generateComplaintId();
  
  const complaint = await prisma.complaint.create({
    data: {
      complaint_id,
      wa_user_id: data.wa_user_id,
      kategori: data.kategori,
      deskripsi: data.deskripsi,
      alamat: data.alamat,
      rt_rw: data.rt_rw,
      foto_url: data.foto_url,
      status: 'baru',
    },
  });
  
  // Publish event
  await publishEvent('govconnect.complaint.created', {
    wa_user_id: data.wa_user_id,
    complaint_id: complaint.complaint_id,
    kategori: complaint.kategori,
  });
  
  logger.info('Complaint created', { complaint_id });
  
  return complaint;
}

export async function getComplaintsList(filters: {
  status?: string;
  kategori?: string;
  limit?: number;
  offset?: number;
}) {
  const { status, kategori, limit = 20, offset = 0 } = filters;
  
  const where: any = {};
  if (status) where.status = status;
  if (kategori) where.kategori = kategori;
  
  const [data, total] = await Promise.all([
    prisma.complaint.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.complaint.count({ where }),
  ]);
  
  return { data, total, limit, offset };
}

export async function updateComplaintStatus(
  complaint_id: string,
  status: string,
  admin_notes?: string
) {
  const complaint = await prisma.complaint.update({
    where: { complaint_id },
    data: { status, admin_notes },
  });
  
  // Publish event
  await publishEvent('govconnect.status.updated', {
    wa_user_id: complaint.wa_user_id,
    complaint_id: complaint.complaint_id,
    status: complaint.status,
    admin_notes: admin_notes,
  });
  
  return complaint;
}
```

---

### Complaint Controller

`src/controllers/complaint.controller.ts`:

```typescript
import { Request, Response } from 'express';
import { createComplaint, getComplaintsList, updateComplaintStatus } from '../services/complaint.service';
import logger from '../utils/logger';

export async function handleCreateComplaint(req: Request, res: Response) {
  try {
    const complaint = await createComplaint(req.body);
    
    return res.status(201).json({
      status: 'success',
      data: {
        complaint_id: complaint.complaint_id,
        status: complaint.status,
      },
    });
  } catch (error: any) {
    logger.error('Create complaint error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleGetComplaints(req: Request, res: Response) {
  try {
    const filters = {
      status: req.query.status as string,
      kategori: req.query.kategori as string,
      limit: parseInt(req.query.limit as string) || 20,
      offset: parseInt(req.query.offset as string) || 0,
    };
    
    const result = await getComplaintsList(filters);
    
    return res.json({
      data: result.data,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (error: any) {
    logger.error('Get complaints error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpdateComplaintStatus(req: Request, res: Response) {
  try {
    const { complaint_id } = req.params;
    const { status, admin_notes } = req.body;
    
    const complaint = await updateComplaintStatus(complaint_id, status, admin_notes);
    
    return res.json({
      status: 'success',
      data: complaint,
    });
  } catch (error: any) {
    logger.error('Update status error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

---

## 🚀 RUNNING THE SERVICE

```bash
pnpm install
pnpm prisma migrate dev
pnpm dev
```

**Environment Variables**:
```bash
NODE_ENV=development
PORT=3003
DATABASE_URL=postgresql://postgres:postgres_secret_2025@localhost:5433/gc_case_db
RABBITMQ_URL=amqp://admin:rabbitmq_secret_2025@localhost:5672/govconnect
INTERNAL_API_KEY=govconnect_internal_secret_key_2025_change_in_production
```

---

## ✅ COMPLETION CRITERIA

- [x] Complaint & Ticket CRUD complete
- [x] ID generator working (LAP-/TIK-)
- [x] Events published to RabbitMQ
- [x] API tested via Postman
- [x] Statistics endpoint working
- [x] Integration with Service 2 tested

---

## 🚀 NEXT STEPS

→ Go to **[Phase 4: Notification Service](./PHASE_4_NOTIFICATION_SERVICE.md)**

---

**Phase 3 Status**: 🔴 Not Started  
**Last Updated**: November 24, 2025
