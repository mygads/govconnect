# PHASE 1: CHANNEL SERVICE (Express.js)

**Duration**: 6-8 jam  
**Complexity**: ⭐⭐ Medium  
**Prerequisites**: Phase 0 completed  
**Reference**: `clivy-wa-support/handlers/ai_webhook.go`

---

## 🎯 OBJECTIVES

- Setup Express.js project dengan TypeScript
- Implement webhook handler untuk WhatsApp
- Implement FIFO 30 messages storage
- Create internal API untuk send message & get history
- Setup RabbitMQ publisher
- Setup Prisma ORM dengan PostgreSQL

---

## 📋 CHECKLIST

### 1. Project Initialization
- [x] Create folder: `govconnect-channel-service/`
- [x] Initialize npm project: `pnpm init`
- [x] Install dependencies:
  - [x] Express.js
  - [x] TypeScript
  - [x] Prisma
  - [x] amqplib (RabbitMQ client)
  - [x] express-validator
  - [x] winston (logging)
  - [x] axios
  - [x] dotenv
  - [x] helmet (security)
  - [x] cors
- [x] Setup TypeScript config
- [x] Setup ESLint & Prettier
- [x] Create folder structure

### 2. Database Setup (Prisma)
- [x] Initialize Prisma: `pnpm prisma init`
- [x] Configure `DATABASE_URL` → `gc_channel_db`
- [x] Create Prisma schema:
  - [x] Model `Message` (id, wa_user_id, message_id, message_text, direction, source, timestamp)
  - [x] Model `SendLog` (id, wa_user_id, message_text, status, error_msg, timestamp)
- [x] Add indexes (wa_user_id, timestamp, direction, message_id)
- [x] Generate Prisma Client
- [x] Run migration: `pnpm prisma migrate dev --name init`

### 3. Core Services Implementation
- [x] **Message Service** (`src/services/message.service.ts`):
  - [x] `saveIncomingMessage()` - save IN message + FIFO
  - [x] `saveOutgoingMessage()` - save OUT message + FIFO
  - [x] `enforeFIFO()` - maintain max 30 messages per user
  - [x] `getMessageHistory()` - get last N messages
  - [x] `checkDuplicateMessage()` - idempotency check
- [x] **WhatsApp Service** (`src/services/wa.service.ts`):
  - [x] `sendTextMessage()` - call WA API
  - [x] `parseWebhookPayload()` - extract message from webhook
  - [x] `validateWebhookSignature()` - verify HMAC (optional)
- [x] **RabbitMQ Service** (`src/services/rabbitmq.service.ts`):
  - [x] `connect()` - establish connection
  - [x] `publishEvent()` - publish to exchange
  - [x] `disconnect()` - graceful shutdown

### 4. Controllers Implementation
- [x] **Webhook Controller** (`src/controllers/webhook.controller.ts`):
  - [x] `POST /webhook/whatsapp` - receive WA messages
  - [x] Filter: text only, not from self, not old (> 5 min)
  - [x] Check duplicate via message_id
  - [x] Save to DB + publish event
- [x] **Internal Controller** (`src/controllers/internal.controller.ts`):
  - [x] `POST /internal/send` - send message (from Service 5)
  - [x] `GET /internal/messages?wa_user_id=xxx&limit=30` - get history
  - [x] Require internal API key authentication

### 5. Middleware Implementation
- [x] **Auth Middleware** (`src/middleware/auth.middleware.ts`):
  - [x] `internalAuth()` - verify X-Internal-API-Key header
- [x] **Validation Middleware** (`src/middleware/validation.middleware.ts`):
  - [x] Validate webhook payload
  - [x] Validate send message payload
  - [x] Validate query parameters
- [x] **Error Handler** (`src/middleware/error-handler.middleware.ts`):
  - [x] Catch all errors
  - [x] Format error response
  - [x] Log errors

### 6. Routes Setup
- [x] **Webhook Routes** (`src/routes/webhook.routes.ts`):
  - [x] POST /webhook/whatsapp
  - [x] GET /webhook/verify (untuk WA verification)
- [x] **Internal Routes** (`src/routes/internal.routes.ts`):
  - [x] POST /internal/send (protected)
  - [x] GET /internal/messages (protected)
- [x] **Health Check** (`src/routes/health.routes.ts`):
  - [x] GET /health
  - [x] GET /health/db
  - [x] GET /health/rabbitmq

### 7. Configuration & Utils
- [x] **Environment Config** (`src/config/env.ts`):
  - [x] Validate all required env vars
  - [x] Export typed config object
- [x] **Database Config** (`src/config/database.ts`):
  - [x] Export Prisma client instance
  - [x] Handle connection errors
- [x] **RabbitMQ Config** (`src/config/rabbitmq.ts`):
  - [x] Connection string
  - [x] Exchange & queue names
  - [x] Retry config
- [x] **Logger** (`src/utils/logger.ts`):
  - [x] Winston setup with file + console transport
  - [x] Log rotation
  - [x] Structured logging

### 8. Testing
- [x] Write unit tests (Jest):
  - [x] FIFO enforcement (save 35 messages → keep 30)
  - [x] Duplicate message check
  - [x] Message parsing
- [x] Write integration tests:
  - [x] Webhook flow end-to-end
  - [x] Internal API calls
  - [x] RabbitMQ event publishing
- [x] Manual testing via Postman:
  - [x] Create Postman collection
  - [x] Test webhook with sample payload
  - [x] Test internal/send
  - [x] Test internal/messages

### 9. Documentation
- [x] Create `README.md`:
  - [x] Setup instructions
  - [x] API documentation
  - [x] Environment variables
  - [x] Testing guide
- [x] Create `.env.example`
- [x] Add JSDoc comments to functions
- [x] Update main `GOVCONNECT_DEV_PHASES.md`

---

## 📁 FOLDER STRUCTURE

```
govconnect-channel-service/
├── src/
│   ├── config/
│   │   ├── database.ts
│   │   ├── env.ts
│   │   └── rabbitmq.ts
│   ├── controllers/
│   │   ├── internal.controller.ts
│   │   └── webhook.controller.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts
│   │   ├── error-handler.middleware.ts
│   │   └── validation.middleware.ts
│   ├── routes/
│   │   ├── health.routes.ts
│   │   ├── internal.routes.ts
│   │   └── webhook.routes.ts
│   ├── services/
│   │   ├── message.service.ts
│   │   ├── rabbitmq.service.ts
│   │   └── wa.service.ts
│   ├── types/
│   │   ├── message.types.ts
│   │   └── webhook.types.ts
│   ├── utils/
│   │   └── logger.ts
│   ├── app.ts          # Express app setup
│   └── server.ts       # Server entry point
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

---

## 💾 DATABASE SCHEMA (Prisma)

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Message {
  id           String   @id @default(cuid())
  wa_user_id   String   // 628xxx
  message_id   String   @unique // dari WA provider
  message_text String   @db.Text
  direction    String   // "IN" | "OUT"
  source       String   // "WA_WEBHOOK" | "AI" | "SYSTEM"
  timestamp    DateTime @default(now())
  createdAt    DateTime @default(now())
  
  @@index([wa_user_id, timestamp])
  @@index([direction])
  @@index([message_id])
  @@map("messages")
}

model SendLog {
  id           String   @id @default(cuid())
  wa_user_id   String
  message_text String   @db.Text
  status       String   // "sent" | "failed"
  error_msg    String?  @db.Text
  timestamp    DateTime @default(now())
  
  @@index([wa_user_id])
  @@index([status])
  @@index([timestamp])
  @@map("send_logs")
}
```

---

## 🔧 CORE CODE IMPLEMENTATION

### 1. Message Service (FIFO Implementation)

`src/services/message.service.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

const MAX_MESSAGES = 30;

/**
 * Save incoming message with FIFO enforcement
 */
export async function saveIncomingMessage(data: {
  wa_user_id: string;
  message_id: string;
  message_text: string;
  timestamp?: Date;
}) {
  logger.info('Saving incoming message', {
    wa_user_id: data.wa_user_id,
    message_id: data.message_id,
  });

  // Check duplicate
  const existing = await prisma.message.findUnique({
    where: { message_id: data.message_id },
  });

  if (existing) {
    logger.warn('Duplicate message detected', { message_id: data.message_id });
    throw new Error('DUPLICATE_MESSAGE');
  }

  // Save message
  const message = await prisma.message.create({
    data: {
      wa_user_id: data.wa_user_id,
      message_id: data.message_id,
      message_text: data.message_text,
      direction: 'IN',
      source: 'WA_WEBHOOK',
      timestamp: data.timestamp || new Date(),
    },
  });

  // Enforce FIFO
  await enforeFIFO(data.wa_user_id);

  logger.info('Incoming message saved', { id: message.id });
  return message;
}

/**
 * Save outgoing message with FIFO enforcement
 */
export async function saveOutgoingMessage(data: {
  wa_user_id: string;
  message_id: string;
  message_text: string;
  source: 'AI' | 'SYSTEM';
}) {
  const message = await prisma.message.create({
    data: {
      wa_user_id: data.wa_user_id,
      message_id: data.message_id,
      message_text: data.message_text,
      direction: 'OUT',
      source: data.source,
      timestamp: new Date(),
    },
  });

  // Enforce FIFO
  await enforeFIFO(data.wa_user_id);

  logger.info('Outgoing message saved', { id: message.id });
  return message;
}

/**
 * Maintain maximum 30 messages per user (FIFO)
 */
async function enforeFIFO(wa_user_id: string) {
  const count = await prisma.message.count({
    where: { wa_user_id },
  });

  if (count > MAX_MESSAGES) {
    const toDelete = count - MAX_MESSAGES;
    
    // Get oldest messages
    const oldestMessages = await prisma.message.findMany({
      where: { wa_user_id },
      orderBy: { timestamp: 'asc' },
      take: toDelete,
      select: { id: true },
    });

    // Delete oldest messages
    await prisma.message.deleteMany({
      where: {
        id: { in: oldestMessages.map((m) => m.id) },
      },
    });

    logger.info(`FIFO: Deleted ${toDelete} old messages`, { wa_user_id });
  }
}

/**
 * Get message history (last N messages)
 */
export async function getMessageHistory(wa_user_id: string, limit = 30) {
  const messages = await prisma.message.findMany({
    where: { wa_user_id },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });

  logger.info('Retrieved message history', {
    wa_user_id,
    count: messages.length,
  });

  return messages.reverse(); // oldest first
}
```

---

### 2. Webhook Controller

`src/controllers/webhook.controller.ts`:

```typescript
import { Request, Response } from 'express';
import { saveIncomingMessage } from '../services/message.service';
import { publishEvent } from '../services/rabbitmq.service';
import logger from '../utils/logger';

interface WhatsAppWebhookPayload {
  messaging_product?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          text?: { body: string };
          type?: string;
        }>;
      };
    }>;
  }>;
}

export async function handleWebhook(req: Request, res: Response) {
  try {
    const payload: WhatsAppWebhookPayload = req.body;

    // Parse message
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) {
      return res.json({ status: 'ok', message: 'No message in payload' });
    }

    const from = message.from;
    const messageId = message.id;
    const messageText = message.text?.body;
    const messageType = message.type;
    const timestamp = new Date(parseInt(message.timestamp) * 1000);

    // Filter: only text messages
    if (messageType !== 'text' || !messageText) {
      logger.info('Non-text message ignored', { messageType });
      return res.json({ status: 'ok', message: 'Non-text message ignored' });
    }

    // Filter: old messages (> 5 minutes)
    const messageAge = Date.now() - timestamp.getTime();
    if (messageAge > 5 * 60 * 1000) {
      logger.info('Old message ignored', { messageAge, messageId });
      return res.json({ status: 'ok', message: 'Old message ignored' });
    }

    logger.info('Webhook received', {
      from,
      messageId,
      messageText: messageText.substring(0, 50),
    });

    // Save to database (handles duplicate check)
    try {
      await saveIncomingMessage({
        wa_user_id: from,
        message_id: messageId,
        message_text: messageText,
        timestamp,
      });
    } catch (error: any) {
      if (error.message === 'DUPLICATE_MESSAGE') {
        return res.json({ status: 'ok', message: 'Duplicate message' });
      }
      throw error;
    }

    // Publish event to RabbitMQ
    await publishEvent('whatsapp.message.received', {
      wa_user_id: from,
      message: messageText,
      message_id: messageId,
      received_at: timestamp.toISOString(),
    });

    logger.info('Message processed successfully', { messageId });

    return res.json({ status: 'ok', message_id: messageId });
  } catch (error: any) {
    logger.error('Webhook handler error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Webhook verification (for WhatsApp setup)
export function verifyWebhook(req: Request, res: Response) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN || 'govconnect_verify';

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Webhook verified');
    return res.send(challenge);
  }

  logger.warn('Webhook verification failed');
  return res.sendStatus(403);
}
```

---

### 3. Internal API Controller

`src/controllers/internal.controller.ts`:

```typescript
import { Request, Response } from 'express';
import { getMessageHistory, saveOutgoingMessage } from '../services/message.service';
import { sendTextMessage } from '../services/wa.service';
import logger from '../utils/logger';

/**
 * Get message history (for Service 2 - AI)
 */
export async function getMessages(req: Request, res: Response) {
  try {
    const wa_user_id = req.query.wa_user_id as string;
    const limit = parseInt(req.query.limit as string) || 30;

    if (!wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id required' });
    }

    const messages = await getMessageHistory(wa_user_id, limit);

    return res.json({
      messages: messages.map((m) => ({
        id: m.id,
        message_text: m.message_text,
        direction: m.direction,
        source: m.source,
        timestamp: m.timestamp,
      })),
      total: messages.length,
    });
  } catch (error: any) {
    logger.error('Get messages error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Send message (from Service 5 - Notification)
 */
export async function sendMessage(req: Request, res: Response) {
  try {
    const { wa_user_id, message } = req.body;

    if (!wa_user_id || !message) {
      return res.status(400).json({ error: 'wa_user_id and message required' });
    }

    // Send via WhatsApp API
    const result = await sendTextMessage(wa_user_id, message);

    // Save to database
    await saveOutgoingMessage({
      wa_user_id,
      message_id: result.message_id,
      message_text: message,
      source: 'SYSTEM', // or 'AI' based on caller
    });

    logger.info('Message sent successfully', {
      wa_user_id,
      message_id: result.message_id,
    });

    return res.json({
      status: 'sent',
      message_id: result.message_id,
    });
  } catch (error: any) {
    logger.error('Send message error', { error: error.message });
    return res.status(500).json({ error: 'Failed to send message' });
  }
}
```

---

### 4. RabbitMQ Service

`src/services/rabbitmq.service.ts`:

```typescript
import amqp, { Channel, Connection } from 'amqplib';
import logger from '../utils/logger';

let connection: Connection | null = null;
let channel: Channel | null = null;

const EXCHANGE_NAME = 'govconnect.events';

export async function connectRabbitMQ() {
  try {
    const url = process.env.RABBITMQ_URL || 'amqp://localhost';
    
    connection = await amqp.connect(url);
    channel = await connection.createChannel();

    // Assert exchange
    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

    logger.info('RabbitMQ connected', { exchange: EXCHANGE_NAME });
  } catch (error: any) {
    logger.error('RabbitMQ connection error', { error: error.message });
    throw error;
  }
}

export async function publishEvent(routingKey: string, payload: any) {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }

  const message = JSON.stringify(payload);
  
  channel.publish(
    EXCHANGE_NAME,
    routingKey,
    Buffer.from(message),
    { persistent: true }
  );

  logger.info('Event published', { routingKey, payload });
}

export async function disconnectRabbitMQ() {
  if (channel) await channel.close();
  if (connection) await connection.close();
  logger.info('RabbitMQ disconnected');
}
```

---

## 🧪 TESTING

### Unit Test Example

`tests/unit/message.service.test.ts`:

```typescript
import { saveIncomingMessage, getMessageHistory } from '../../src/services/message.service';

describe('Message Service', () => {
  describe('FIFO Enforcement', () => {
    it('should keep only 30 messages per user', async () => {
      const userId = '628123456789';

      // Create 35 messages
      for (let i = 0; i < 35; i++) {
        await saveIncomingMessage({
          wa_user_id: userId,
          message_id: `msg-${i}`,
          message_text: `Message ${i}`,
        });
      }

      // Get all messages
      const messages = await getMessageHistory(userId, 50);

      // Should have exactly 30
      expect(messages.length).toBe(30);
      
      // Oldest should be message 5 (0-4 deleted)
      expect(messages[0].message_text).toBe('Message 5');
      
      // Newest should be message 34
      expect(messages[29].message_text).toBe('Message 34');
    });
  });
});
```

---

## 🚀 RUNNING THE SERVICE

### Development
```bash
# Install dependencies
pnpm install

# Setup database
pnpm prisma migrate dev

# Generate Prisma client
pnpm prisma generate

# Start dev server
pnpm dev
```

### Environment Variables
```bash
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://postgres:postgres_secret_2025@localhost:5432/gc_channel_db
RABBITMQ_URL=amqp://admin:rabbitmq_secret_2025@localhost:5672/govconnect
INTERNAL_API_KEY=govconnect_internal_secret_key_2025_change_in_production
WA_API_URL=https://api.whatsapp.com/v1
WA_API_TOKEN=your_wa_token
WA_WEBHOOK_VERIFY_TOKEN=govconnect_verify
```

---

## ✅ COMPLETION CRITERIA

Phase 1 dianggap selesai jika:

- [x] Webhook menerima & menyimpan pesan dari WA
- [x] FIFO 30 messages berfungsi (tested)
- [x] Event `whatsapp.message.received` ter-publish ke RabbitMQ
- [x] Internal API `/internal/send` berfungsi
- [x] Internal API `/internal/messages` berfungsi
- [x] Duplicate message di-skip (idempotency)
- [x] Unit tests passing
- [x] Manual tests via Postman berhasil
- [x] Documentation lengkap

---

## 🚀 NEXT STEPS

After completing Phase 1:
→ Go to **[Phase 2: AI Orchestrator](./PHASE_2_AI_ORCHESTRATOR.md)**

---

**Phase 1 Status**: ✅ **COMPLETE**  
**Completed**: November 24, 2025  
**Verification Report**: [PHASE_1_COMPLETE.md](./PHASE_1_COMPLETE.md)
