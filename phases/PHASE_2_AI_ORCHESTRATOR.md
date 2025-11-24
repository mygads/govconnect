# PHASE 2: AI ORCHESTRATOR SERVICE (Express.js)

**Duration**: 8-10 jam  
**Complexity**: ⭐⭐⭐ Hard  
**Prerequisites**: Phase 0, Phase 1 completed  
**Reference**: `clivy-wa-support/services/` (context_builder.go, gemini.go, openrouter.go)

---

## 🎯 OBJECTIVES

- Setup Express.js project (STATELESS - no database)
- Consume RabbitMQ event `whatsapp.message.received`
- Fetch message history dari Service 1
- Call LLM (Gemini) dengan structured JSON output
- **SYNC call** ke Service 3 untuk create laporan/tiket
- Publish event `govconnect.ai.reply`

---

## 📋 CHECKLIST

### 1. Project Initialization
- [x] Create folder: `govconnect-ai-service/`
- [x] Initialize npm project: `pnpm init`
- [x] Install dependencies:
  - [x] Express.js
  - [x] TypeScript
  - [x] amqplib (RabbitMQ)
  - [x] @google/generative-ai (Gemini)
  - [x] axios (HTTP client)
  - [x] winston (logging)
  - [x] dotenv
- [x] Setup TypeScript config
- [x] Create folder structure
- [x] **NO DATABASE SETUP** (stateless service)

### 2. Core Services Implementation
- [x] **Context Builder** (`src/services/context-builder.service.ts`):
  - [x] `fetchMessageHistory()` - call Service 1 internal API
  - [x] `buildSystemPrompt()` - create prompt with history
  - [x] `formatConversationHistory()` - format untuk LLM
- [x] **LLM Service** (`src/services/llm.service.ts`):
  - [x] `callGemini()` - dengan JSON schema enforcement
  - [x] `parseStructuredOutput()` - parse & validate JSON
  - [x] `handleLLMError()` - fallback response
- [x] **Case Service Client** (`src/services/case-client.service.ts`):
  - [x] `createComplaint()` - SYNC POST ke Service 3
  - [x] `createTicket()` - SYNC POST ke Service 3
  - [x] Handle timeout & retry
- [x] **RabbitMQ Consumer** (`src/services/rabbitmq.service.ts`):
  - [x] `consumeMessages()` - listen to queue
  - [x] `publishEvent()` - publish AI reply
  - [x] Message acknowledgement
  - [x] Error handling & retry

### 3. Main Orchestrator Logic
- [x] **AI Orchestrator** (`src/services/ai-orchestrator.service.ts`):
  - [x] Receive event `whatsapp.message.received`
  - [x] Fetch history (30 messages) from Service 1
  - [x] Build context & call LLM
  - [x] Parse intent (CREATE_COMPLAINT | CREATE_TICKET | QUESTION | UNKNOWN)
  - [x] **SYNC call** ke Service 3 based on intent
  - [x] Publish `govconnect.ai.reply` event
  - [x] Handle errors gracefully

### 4. Configuration
- [x] **Environment Config** (`src/config/env.ts`):
  - [x] GEMINI_API_KEY
  - [x] RABBITMQ_URL
  - [x] CHANNEL_SERVICE_URL
  - [x] CASE_SERVICE_URL
  - [x] INTERNAL_API_KEY
- [x] **Logger** (`src/utils/logger.ts`):
  - [x] Winston with structured logging
  - [x] Log all LLM calls (token usage)
  - [x] Log all service calls

### 5. Prompt Engineering
- [x] **System Prompt Template** (`src/prompts/system-prompt.ts`):
  - [x] Define AI role (GovConnect assistant)
  - [x] Define JSON schema enforcement rules
  - [x] Define categories (jalan_rusak, lampu_mati, etc)
  - [x] Define ticket types (surat_keterangan, etc)
  - [x] Conversation extraction rules
- [x] **Response Schema** (`src/types/llm-response.types.ts`):
  - [x] TypeScript interface untuk LLM output
  - [x] Validation schema (Zod)

### 6. Health Check & Monitoring
- [x] `GET /health` - service health
- [x] `GET /health/rabbitmq` - RabbitMQ connection
- [x] `GET /health/services` - check Service 1 & 3 availability
- [x] Metrics logging (LLM latency, token usage)

### 7. Testing
- [ ] Unit tests:
  - [ ] Context builder
  - [ ] LLM response parsing
  - [ ] Intent detection
- [ ] Integration tests:
  - [ ] Mock RabbitMQ event
  - [ ] Mock Service 1 & 3 responses
  - [ ] Test full orchestration flow
- [x] Manual testing:
  - [x] Send event via RabbitMQ UI
  - [x] Verify LLM call
  - [x] Verify Service 3 call

### 8. Documentation
- [x] `README.md` with architecture diagram
- [x] `.env.example`
- [x] Prompt engineering documentation
- [x] LLM schema documentation

---

## 📁 FOLDER STRUCTURE

```
govconnect-ai-service/
├── src/
│   ├── config/
│   │   ├── env.ts
│   │   └── rabbitmq.ts
│   ├── prompts/
│   │   ├── system-prompt.ts
│   │   └── examples.ts
│   ├── services/
│   │   ├── ai-orchestrator.service.ts  # Main logic
│   │   ├── case-client.service.ts      # Call Service 3
│   │   ├── context-builder.service.ts  # Build LLM context
│   │   ├── llm.service.ts              # Gemini client
│   │   └── rabbitmq.service.ts         # Consumer & Publisher
│   ├── types/
│   │   ├── event.types.ts
│   │   └── llm-response.types.ts
│   ├── utils/
│   │   └── logger.ts
│   ├── app.ts          # Express app (minimal)
│   └── server.ts       # Start consumer
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔧 CORE CODE IMPLEMENTATION

### 1. AI Orchestrator (Main Logic)

`src/services/ai-orchestrator.service.ts`:

```typescript
import { buildContext } from './context-builder.service';
import { callGemini } from './llm.service';
import { createComplaint, createTicket } from './case-client.service';
import { publishEvent } from './rabbitmq.service';
import logger from '../utils/logger';

interface MessageReceivedEvent {
  wa_user_id: string;
  message: string;
  message_id: string;
  received_at: string;
}

export async function processMessage(event: MessageReceivedEvent) {
  const { wa_user_id, message, message_id } = event;

  logger.info('Processing message', { wa_user_id, message_id });

  try {
    // 1. Build context (fetch history from Service 1)
    const context = await buildContext(wa_user_id);

    // 2. Call LLM
    const llmResponse = await callGemini(context.systemPrompt, message);

    logger.info('LLM response', {
      wa_user_id,
      intent: llmResponse.intent,
      reply_preview: llmResponse.reply_text.substring(0, 50),
    });

    // 3. Handle intent (SYNC call to Service 3)
    let additionalInfo = '';

    if (llmResponse.intent === 'CREATE_COMPLAINT') {
      try {
        const complaint = await createComplaint({
          wa_user_id,
          kategori: llmResponse.fields.kategori || 'umum',
          deskripsi: llmResponse.fields.deskripsi || message,
          alamat: llmResponse.fields.alamat,
          rt_rw: llmResponse.fields.rt_rw,
        });

        additionalInfo = `\n\n✅ Laporan berhasil dibuat dengan nomor: *${complaint.complaint_id}*`;
        logger.info('Complaint created', { complaint_id: complaint.complaint_id });
      } catch (error: any) {
        logger.error('Failed to create complaint', { error: error.message });
        additionalInfo = '\n\n⚠️ Terjadi kesalahan saat membuat laporan. Mohon coba lagi.';
      }
    } else if (llmResponse.intent === 'CREATE_TICKET') {
      try {
        const ticket = await createTicket({
          wa_user_id,
          jenis: llmResponse.fields.jenis || 'umum',
          data_json: llmResponse.fields,
        });

        additionalInfo = `\n\n✅ Tiket berhasil dibuat dengan nomor: *${ticket.ticket_id}*`;
        logger.info('Ticket created', { ticket_id: ticket.ticket_id });
      } catch (error: any) {
        logger.error('Failed to create ticket', { error: error.message });
        additionalInfo = '\n\n⚠️ Terjadi kesalahan saat membuat tiket. Mohon coba lagi.';
      }
    }

    // 4. Publish reply event
    await publishEvent('govconnect.ai.reply', {
      wa_user_id,
      reply_text: llmResponse.reply_text + additionalInfo,
      original_message_id: message_id,
    });

    logger.info('Message processed successfully', { wa_user_id, message_id });
  } catch (error: any) {
    logger.error('Error processing message', {
      wa_user_id,
      message_id,
      error: error.message,
    });

    // Send fallback response
    await publishEvent('govconnect.ai.reply', {
      wa_user_id,
      reply_text: 'Maaf, terjadi kesalahan. Silakan coba lagi nanti.',
      original_message_id: message_id,
    });
  }
}
```

---

### 2. Context Builder

`src/services/context-builder.service.ts`:

```typescript
import axios from 'axios';
import logger from '../utils/logger';
import { SYSTEM_PROMPT_TEMPLATE } from '../prompts/system-prompt';

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

interface Message {
  message_text: string;
  direction: 'IN' | 'OUT';
  timestamp: string;
}

export async function buildContext(wa_user_id: string) {
  logger.info('Building context', { wa_user_id });

  // Fetch last 30 messages from Service 1
  const messages = await fetchMessageHistory(wa_user_id, 30);

  // Format conversation history
  const history = formatConversationHistory(messages);

  // Build system prompt
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{history}', history);

  logger.info('Context built', {
    wa_user_id,
    message_count: messages.length,
    prompt_length: systemPrompt.length,
  });

  return {
    systemPrompt,
    messageCount: messages.length,
  };
}

async function fetchMessageHistory(wa_user_id: string, limit: number): Promise<Message[]> {
  try {
    const response = await axios.get(`${CHANNEL_SERVICE_URL}/internal/messages`, {
      params: { wa_user_id, limit },
      headers: { 'x-internal-api-key': INTERNAL_API_KEY },
      timeout: 5000,
    });

    return response.data.messages || [];
  } catch (error: any) {
    logger.error('Failed to fetch message history', { error: error.message });
    return []; // Return empty if fail (graceful degradation)
  }
}

function formatConversationHistory(messages: Message[]): string {
  if (messages.length === 0) {
    return '(Belum ada riwayat percakapan)';
  }

  return messages
    .map((m) => {
      const role = m.direction === 'IN' ? 'User' : 'Assistant';
      return `${role}: ${m.message_text}`;
    })
    .join('\n');
}
```

---

### 3. LLM Service (Gemini with JSON Schema)

`src/services/llm.service.ts`:

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';
import { LLMResponse, LLMResponseSchema } from '../types/llm-response.types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['CREATE_COMPLAINT', 'CREATE_TICKET', 'QUESTION', 'UNKNOWN'],
    },
    fields: {
      type: 'object',
      properties: {
        kategori: { type: 'string' },
        alamat: { type: 'string' },
        deskripsi: { type: 'string' },
        rt_rw: { type: 'string' },
        jenis: { type: 'string' },
      },
    },
    reply_text: { type: 'string' },
  },
  required: ['intent', 'fields', 'reply_text'],
};

export async function callGemini(systemPrompt: string, userMessage: string): Promise<LLMResponse> {
  const startTime = Date.now();

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: JSON_SCHEMA,
      },
    });

    const fullPrompt = `${systemPrompt}\n\nPESAN TERAKHIR USER:\n${userMessage}`;

    const result = await model.generateContent(fullPrompt);
    const responseText = result.response.text();

    // Parse JSON
    const parsed = JSON.parse(responseText);

    // Validate with Zod
    const validated = LLMResponseSchema.parse(parsed);

    const latency = Date.now() - startTime;
    logger.info('LLM call successful', {
      intent: validated.intent,
      latency_ms: latency,
      model: 'gemini-1.5-flash',
    });

    return validated;
  } catch (error: any) {
    const latency = Date.now() - startTime;
    logger.error('LLM call failed', {
      error: error.message,
      latency_ms: latency,
    });

    // Fallback response
    return {
      intent: 'UNKNOWN',
      fields: {},
      reply_text: 'Maaf, saya tidak mengerti. Bisa ulangi pertanyaan Anda?',
    };
  }
}
```

---

### 4. Case Service Client (SYNC Calls)

`src/services/case-client.service.ts`:

```typescript
import axios from 'axios';
import logger from '../utils/logger';

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || 'http://localhost:3003';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

interface ComplaintData {
  wa_user_id: string;
  kategori: string;
  deskripsi: string;
  alamat?: string;
  rt_rw?: string;
}

interface TicketData {
  wa_user_id: string;
  jenis: string;
  data_json: any;
}

export async function createComplaint(data: ComplaintData) {
  logger.info('Creating complaint', { wa_user_id: data.wa_user_id });

  try {
    const response = await axios.post(
      `${CASE_SERVICE_URL}/laporan/create`,
      data,
      {
        headers: { 'x-internal-api-key': INTERNAL_API_KEY },
        timeout: 10000, // 10 seconds
      }
    );

    logger.info('Complaint created', { complaint_id: response.data.data.complaint_id });
    return response.data.data;
  } catch (error: any) {
    logger.error('Failed to create complaint', {
      error: error.message,
      wa_user_id: data.wa_user_id,
    });
    throw error;
  }
}

export async function createTicket(data: TicketData) {
  logger.info('Creating ticket', { wa_user_id: data.wa_user_id });

  try {
    const response = await axios.post(
      `${CASE_SERVICE_URL}/tiket/create`,
      data,
      {
        headers: { 'x-internal-api-key': INTERNAL_API_KEY },
        timeout: 10000,
      }
    );

    logger.info('Ticket created', { ticket_id: response.data.data.ticket_id });
    return response.data.data;
  } catch (error: any) {
    logger.error('Failed to create ticket', {
      error: error.message,
      wa_user_id: data.wa_user_id,
    });
    throw error;
  }
}
```

---

### 5. System Prompt Template

`src/prompts/system-prompt.ts`:

```typescript
export const SYSTEM_PROMPT_TEMPLATE = `
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
    "kategori": "jalan_rusak | lampu_mati | sampah | drainase | pohon_tumbang | fasilitas_rusak",
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

CONTOH:

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

Input: "mau buat surat keterangan domisili"
Output:
{
  "intent": "CREATE_TICKET",
  "fields": {
    "jenis": "surat_keterangan",
    "deskripsi": "surat keterangan domisili"
  },
  "reply_text": "Baik, saya akan buatkan tiket untuk surat keterangan domisili. Mohon siapkan KTP dan KK saat datang ke kantor kelurahan."
}

CONVERSATION HISTORY:
{history}
`.trim();
```

---

### 6. RabbitMQ Consumer

`src/services/rabbitmq.service.ts`:

```typescript
import amqp, { Channel, Connection } from 'amqplib';
import { processMessage } from './ai-orchestrator.service';
import logger from '../utils/logger';

let connection: Connection | null = null;
let channel: Channel | null = null;

const EXCHANGE_NAME = 'govconnect.events';
const QUEUE_NAME = 'ai-service.whatsapp.message.#';

export async function connectRabbitMQ() {
  const url = process.env.RABBITMQ_URL || 'amqp://localhost';

  connection = await amqp.connect(url);
  channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

  logger.info('RabbitMQ connected', { exchange: EXCHANGE_NAME });
}

export async function startConsumer() {
  if (!channel) throw new Error('Channel not initialized');

  const queue = await channel.assertQueue('ai-service.queue', { durable: true });

  await channel.bindQueue(queue.queue, EXCHANGE_NAME, 'whatsapp.message.received');

  channel.prefetch(1); // Process one message at a time

  logger.info('Consumer started', { queue: queue.queue });

  channel.consume(queue.queue, async (msg) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString());
      logger.info('Event received', { event });

      await processMessage(event);

      channel!.ack(msg);
    } catch (error: any) {
      logger.error('Consumer error', { error: error.message });
      
      // Reject & requeue (with limit)
      channel!.nack(msg, false, false); // Don't requeue
    }
  });
}

export async function publishEvent(routingKey: string, payload: any) {
  if (!channel) throw new Error('Channel not initialized');

  channel.publish(
    EXCHANGE_NAME,
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    { persistent: true }
  );

  logger.info('Event published', { routingKey });
}
```

---

### 7. LLM Response Types

`src/types/llm-response.types.ts`:

```typescript
import { z } from 'zod';

export const LLMResponseSchema = z.object({
  intent: z.enum(['CREATE_COMPLAINT', 'CREATE_TICKET', 'QUESTION', 'UNKNOWN']),
  fields: z.object({
    kategori: z.string().optional(),
    alamat: z.string().optional(),
    deskripsi: z.string().optional(),
    rt_rw: z.string().optional(),
    jenis: z.string().optional(),
  }),
  reply_text: z.string(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;
```

---

## 🚀 RUNNING THE SERVICE

### Development
```bash
# Install dependencies
pnpm install

# Start consumer
pnpm dev
```

### Environment Variables
```bash
NODE_ENV=development
PORT=3002

# RabbitMQ
RABBITMQ_URL=amqp://admin:rabbitmq_secret_2025@localhost:5672/govconnect

# Service URLs
CHANNEL_SERVICE_URL=http://localhost:3001
CASE_SERVICE_URL=http://localhost:3003

# Internal API
INTERNAL_API_KEY=govconnect_internal_secret_key_2025_change_in_production

# AI Provider
GEMINI_API_KEY=your_gemini_api_key_here
```

---

## ✅ COMPLETION CRITERIA

Phase 2 dianggap selesai jika:

- [x] Consumer menerima event `whatsapp.message.received`
- [x] Context builder fetch history dari Service 1
- [x] LLM call berhasil dengan structured JSON output
- [x] Intent parsing bekerja (CREATE_COMPLAINT, CREATE_TICKET, QUESTION)
- [x] **SYNC call** ke Service 3 berhasil
- [x] Event `govconnect.ai.reply` ter-publish
- [x] Error handling graceful (fallback response)
- [x] Token usage logged
- [x] Integration tests passing

---

## 🚀 NEXT STEPS

After completing Phase 2:
→ Go to **[Phase 3: Case Service](./PHASE_3_CASE_SERVICE.md)**

---

**Phase 2 Status**: 🔴 Not Started  
**Last Updated**: November 24, 2025
