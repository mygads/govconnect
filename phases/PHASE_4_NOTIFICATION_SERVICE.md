# PHASE 4: NOTIFICATION SERVICE (Express.js)

**Duration**: 4-6 jam  
**Complexity**: ⭐⭐ Medium  
**Prerequisites**: Phase 0, 1, 3 completed

---

## 🎯 OBJECTIVES

- Consume RabbitMQ events (AI reply, complaint created, ticket created)
- Build message templates
- Send notifications via Service 1 internal API
- Log all notifications to database

---

## 📋 CHECKLIST

### 1. Project Setup
- [ ] Create folder: `govconnect-notification-service/`
- [ ] Install: Express, TypeScript, Prisma, amqplib, axios
- [ ] Setup folder structure

### 2. Database Schema
- [ ] Model `NotificationLog`:
  - [ ] wa_user_id, message_text, notification_type
  - [ ] status (sent|failed), error_msg
  - [ ] sent_at
- [ ] Run migration

### 3. Core Services
- [ ] **RabbitMQ Consumer** (`src/services/rabbitmq.service.ts`):
  - [ ] Consume `govconnect.ai.reply`
  - [ ] Consume `govconnect.complaint.created`
  - [ ] Consume `govconnect.ticket.created`
  - [ ] Consume `govconnect.status.updated`
- [ ] **Template Builder** (`src/services/template.service.ts`):
  - [ ] `buildAIReplyMessage()`
  - [ ] `buildComplaintCreatedMessage()`
  - [ ] `buildTicketCreatedMessage()`
  - [ ] `buildStatusUpdatedMessage()`
- [ ] **Notification Sender** (`src/services/notification.service.ts`):
  - [ ] Call Service 1 `/internal/send`
  - [ ] Log success/failure
  - [ ] Retry on failure (max 3 attempts)

### 4. Event Handlers
- [ ] Handle AI reply event
- [ ] Handle complaint created event
- [ ] Handle ticket created event
- [ ] Handle status updated event

### 5. Testing
- [ ] Publish test events via RabbitMQ
- [ ] Verify notifications sent
- [ ] Check logs

---

## 💾 DATABASE SCHEMA

```prisma
model NotificationLog {
  id                String   @id @default(cuid())
  wa_user_id        String
  message_text      String   @db.Text
  notification_type String   // ai_reply|complaint_created|ticket_created|status_updated
  status            String   // sent|failed
  error_msg         String?  @db.Text
  sent_at           DateTime @default(now())
  
  @@index([wa_user_id])
  @@index([status])
  @@index([sent_at])
  @@map("notification_logs")
}
```

---

## 🔧 CORE IMPLEMENTATION

### Template Builder

`src/services/template.service.ts`:

```typescript
export function buildComplaintCreatedMessage(data: {
  complaint_id: string;
  kategori: string;
}) {
  return `
✅ *Laporan Diterima*

Nomor Laporan: ${data.complaint_id}
Kategori: ${formatKategori(data.kategori)}
Status: Baru

Laporan Anda sedang kami proses. Anda akan menerima update melalui WhatsApp ini.

Terima kasih telah menggunakan GovConnect! 🙏
`.trim();
}

export function buildTicketCreatedMessage(data: {
  ticket_id: string;
  jenis: string;
}) {
  return `
🎫 *Tiket Layanan Dibuat*

Nomor Tiket: ${data.ticket_id}
Jenis: ${formatJenis(data.jenis)}

Silakan datang ke kantor kelurahan dengan membawa tiket ini.

Jam Pelayanan: Senin-Jumat, 08:00-15:00
`.trim();
}

export function buildStatusUpdatedMessage(data: {
  complaint_id: string;
  status: string;
  admin_notes?: string;
}) {
  return `
📢 *Update Status Laporan*

Nomor: ${data.complaint_id}
Status: ${formatStatus(data.status)}

${data.admin_notes || 'Terima kasih atas kesabaran Anda.'}
`.trim();
}

function formatKategori(kategori: string): string {
  const map: Record<string, string> = {
    jalan_rusak: 'Jalan Rusak',
    lampu_mati: 'Lampu Jalan Mati',
    sampah: 'Sampah',
    drainase: 'Drainase',
    pohon_tumbang: 'Pohon Tumbang',
    fasilitas_rusak: 'Fasilitas Rusak',
  };
  return map[kategori] || kategori;
}

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    baru: 'Baru',
    proses: 'Sedang Diproses',
    selesai: 'Selesai',
    ditolak: 'Ditolak',
  };
  return map[status] || status;
}
```

---

### Notification Sender

`src/services/notification.service.ts`:

```typescript
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();
const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export async function sendNotification(
  wa_user_id: string,
  message: string,
  notificationType: string
) {
  logger.info('Sending notification', { wa_user_id, notificationType });

  try {
    // Call Service 1
    const response = await axios.post(
      `${CHANNEL_SERVICE_URL}/internal/send`,
      {
        wa_user_id,
        message,
      },
      {
        headers: { 'x-internal-api-key': INTERNAL_API_KEY },
        timeout: 10000,
      }
    );

    // Log success
    await prisma.notificationLog.create({
      data: {
        wa_user_id,
        message_text: message,
        notification_type: notificationType,
        status: 'sent',
      },
    });

    logger.info('Notification sent', {
      wa_user_id,
      message_id: response.data.message_id,
    });

    return response.data;
  } catch (error: any) {
    logger.error('Failed to send notification', {
      wa_user_id,
      error: error.message,
    });

    // Log failure
    await prisma.notificationLog.create({
      data: {
        wa_user_id,
        message_text: message,
        notification_type: notificationType,
        status: 'failed',
        error_msg: error.message,
      },
    });

    throw error;
  }
}
```

---

### Event Handlers

`src/handlers/notification.handler.ts`:

```typescript
import { sendNotification } from '../services/notification.service';
import {
  buildComplaintCreatedMessage,
  buildTicketCreatedMessage,
  buildStatusUpdatedMessage,
} from '../services/template.service';
import logger from '../utils/logger';

export async function handleAIReply(event: any) {
  try {
    const { wa_user_id, reply_text } = event;
    await sendNotification(wa_user_id, reply_text, 'ai_reply');
  } catch (error: any) {
    logger.error('Handle AI reply error', { error: error.message });
  }
}

export async function handleComplaintCreated(event: any) {
  try {
    const { wa_user_id, complaint_id, kategori } = event;
    const message = buildComplaintCreatedMessage({ complaint_id, kategori });
    await sendNotification(wa_user_id, message, 'complaint_created');
  } catch (error: any) {
    logger.error('Handle complaint created error', { error: error.message });
  }
}

export async function handleTicketCreated(event: any) {
  try {
    const { wa_user_id, ticket_id, jenis } = event;
    const message = buildTicketCreatedMessage({ ticket_id, jenis });
    await sendNotification(wa_user_id, message, 'ticket_created');
  } catch (error: any) {
    logger.error('Handle ticket created error', { error: error.message });
  }
}

export async function handleStatusUpdated(event: any) {
  try {
    const { wa_user_id, complaint_id, status, admin_notes } = event;
    const message = buildStatusUpdatedMessage({ complaint_id, status, admin_notes });
    await sendNotification(wa_user_id, message, 'status_updated');
  } catch (error: any) {
    logger.error('Handle status updated error', { error: error.message });
  }
}
```

---

### RabbitMQ Consumer

`src/services/rabbitmq.service.ts`:

```typescript
import amqp from 'amqplib';
import {
  handleAIReply,
  handleComplaintCreated,
  handleTicketCreated,
  handleStatusUpdated,
} from '../handlers/notification.handler';
import logger from '../utils/logger';

const EXCHANGE_NAME = 'govconnect.events';

export async function startConsumer() {
  const url = process.env.RABBITMQ_URL || 'amqp://localhost';
  
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  
  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
  
  const queue = await channel.assertQueue('notification-service.queue', { durable: true });
  
  // Bind to multiple events
  await channel.bindQueue(queue.queue, EXCHANGE_NAME, 'govconnect.ai.reply');
  await channel.bindQueue(queue.queue, EXCHANGE_NAME, 'govconnect.complaint.created');
  await channel.bindQueue(queue.queue, EXCHANGE_NAME, 'govconnect.ticket.created');
  await channel.bindQueue(queue.queue, EXCHANGE_NAME, 'govconnect.status.updated');
  
  logger.info('Notification consumer started');
  
  channel.consume(queue.queue, async (msg) => {
    if (!msg) return;
    
    try {
      const routingKey = msg.fields.routingKey;
      const event = JSON.parse(msg.content.toString());
      
      logger.info('Event received', { routingKey, event });
      
      // Route to appropriate handler
      if (routingKey === 'govconnect.ai.reply') {
        await handleAIReply(event);
      } else if (routingKey === 'govconnect.complaint.created') {
        await handleComplaintCreated(event);
      } else if (routingKey === 'govconnect.ticket.created') {
        await handleTicketCreated(event);
      } else if (routingKey === 'govconnect.status.updated') {
        await handleStatusUpdated(event);
      }
      
      channel.ack(msg);
    } catch (error: any) {
      logger.error('Consumer error', { error: error.message });
      channel.nack(msg, false, false);
    }
  });
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
PORT=3004
DATABASE_URL=postgresql://postgres:postgres_secret_2025@localhost:5434/gc_notification_db
RABBITMQ_URL=amqp://admin:rabbitmq_secret_2025@localhost:5672/govconnect
CHANNEL_SERVICE_URL=http://localhost:3001
INTERNAL_API_KEY=govconnect_internal_secret_key_2025_change_in_production
```

---

## ✅ COMPLETION CRITERIA

- [x] Consumer listening to all 4 events
- [x] Templates formatted correctly
- [x] Notifications sent successfully
- [x] Logs created in database
- [x] Error handling working

---

## 🚀 NEXT STEPS

→ Go to **[Phase 5: Dashboard](./PHASE_5_DASHBOARD.md)**

---

**Phase 4 Status**: 🔴 Not Started  
**Last Updated**: November 24, 2025
