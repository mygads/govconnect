# GovConnect AI Orchestrator Service

<!-- CI/CD Trigger: 2026-02-01-v2 - Force rebuild -->

## 🎯 Overview

AI Orchestrator Service adalah **stateless service** yang bertanggung jawab untuk:
- Consume event `whatsapp.message.received` dari RabbitMQ
- Fetch conversation history dari Channel Service
- Process messages dengan Google Gemini LLM
- Orchestrate ke Case Service untuk membuat laporan/permohonan layanan
- Publish event `govconnect.ai.reply` untuk Notification Service

## 🏗️ Architecture

```
RabbitMQ (whatsapp.message.received)
   ↓
AI Orchestrator
   ├─→ Channel Service (GET /internal/messages) - Fetch history
   ├─→ Google Gemini API - Process with LLM
  ├─→ Case Service (POST /laporan/create | /service-requests) - SYNC calls
   └─→ RabbitMQ (govconnect.ai.reply) - Publish reply
```

**Key Design**: 
- ❌ NO DATABASE (fully stateless)
- ✅ SYNC calls to Case Service
- ✅ Structured JSON output dari LLM
- ✅ Context-aware conversations

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- pnpm
- Google Gemini API Key
- RabbitMQ running
- Channel Service running (Port 3001)

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Edit .env and add your GEMINI_API_KEY

# Run in development
pnpm dev

# Build for production
pnpm build
pnpm start
```

## 📦 Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `NODE_ENV` | Environment | No | development |
| `PORT` | Server port | No | 3002 |
| `GEMINI_API_KEY` | Google Gemini API key | **Yes** | - |
| `RABBITMQ_URL` | RabbitMQ connection string | **Yes** | - |
| `CHANNEL_SERVICE_URL` | Channel Service URL | **Yes** | - |
| `CASE_SERVICE_URL` | Case Service URL | **Yes** | - |
| `INTERNAL_API_KEY` | Shared secret for inter-service auth | **Yes** | - |
| `LLM_MODEL` | Gemini model name | No | gemini-1.5-flash |
| `LLM_TEMPERATURE` | LLM temperature | No | 0.3 |
| `LLM_MAX_TOKENS` | Max output tokens | No | 1000 |
| `MAX_HISTORY_MESSAGES` | Max conversation history | No | 30 |

## 🔧 API Endpoints

### Health Checks

#### GET /health
Service health check
```json
{
  "status": "ok",
  "service": "ai-orchestrator",
  "timestamp": "2025-11-24T..."
}
```

#### GET /health/rabbitmq
RabbitMQ connection status
```json
{
  "status": "connected",
  "service": "ai-orchestrator"
}
```

#### GET /health/services
Check dependent services
```json
{
  "status": "ok",
  "services": {
    "channelService": "healthy",
    "caseService": "healthy"
  }
}
```

## 🤖 LLM Integration

### Intent Detection
- `CREATE_COMPLAINT`: User melaporkan masalah infrastruktur
- `CREATE_SERVICE_REQUEST`: User mengajukan permohonan layanan
- `QUESTION`: User bertanya tentang layanan
- `UNKNOWN`: Intent tidak jelas

### Kategori Laporan
- `jalan_rusak`: Jalan berlubang, rusak
- `lampu_mati`: Lampu jalan mati/rusak
- `sampah`: Masalah sampah menumpuk
- `drainase`: Saluran air tersumbat
- `pohon_tumbang`: Pohon tumbang
- `fasilitas_rusak`: Fasilitas umum rusak

### Katalog Layanan
- Permohonan layanan mengacu ke **Service Catalog** di Case Service (service_id + requirements)

## 📊 Message Flow

1. **Receive Event**: Consume `whatsapp.message.received` dari RabbitMQ
2. **Build Context**: Fetch 30 message history dari Channel Service
3. **Call LLM**: Send to Gemini dengan structured JSON schema
4. **Parse Response**: Validate LLM output dengan Zod schema
5. **Handle Intent**:
  - If `CREATE_COMPLAINT` → SYNC call ke Case Service `/laporan/create`
  - If `CREATE_SERVICE_REQUEST` → SYNC call ke Case Service `/service-requests`
   - If `QUESTION` → Just reply with LLM response
6. **Publish Reply**: Send `govconnect.ai.reply` event ke RabbitMQ

## 🧪 Testing

### Manual Testing

1. **Send test event to RabbitMQ**:
```bash
# Via RabbitMQ Management UI (http://localhost:15672)
# Exchange: govconnect.events
# Routing Key: whatsapp.message.received
# Payload:
{
  "wa_user_id": "628123456789",
  "message": "jalan depan rumah rusak pak",
  "message_id": "wamid.test123",
  "received_at": "2025-11-24T10:00:00Z"
}
```

2. **Check logs**:
```bash
# Development
pnpm dev

# Docker
docker logs govconnect-ai-service -f
```

3. **Verify Case Service call** (if complaint/service request created)

## 🐳 Docker

```bash
# Build image
docker build -t govconnect-ai-service .

# Run container
docker run -d \
  --name govconnect-ai-service \
  --env-file .env \
  -p 3002:3002 \
  govconnect-ai-service
```

## 📝 Project Structure

```
src/
├── config/
│   ├── env.ts              # Environment validation
│   └── rabbitmq.ts         # RabbitMQ constants
├── prompts/
│   └── system-prompt.ts    # LLM system prompt & schema
├── services/
│   ├── ai-orchestrator.service.ts   # Main orchestration logic
│   ├── case-client.service.ts       # Case Service client
│   ├── context-builder.service.ts   # Build LLM context
│   ├── llm.service.ts               # Gemini integration
│   └── rabbitmq.service.ts          # Consumer & Publisher
├── types/
│   ├── event.types.ts      # RabbitMQ event types
│   └── llm-response.types.ts  # LLM response schema
├── utils/
│   └── logger.ts           # Winston logger
├── app.ts                  # Express app
└── server.ts               # Server entry point
```

## 🔐 Security

- ✅ Internal API authentication via X-Internal-API-Key
- ✅ Environment variables for secrets
- ✅ No hardcoded credentials
- ✅ Input validation with Zod
- ✅ Error handling & logging

## 🚨 Error Handling

- LLM failures → Fallback response sent to user
- Case Service down → Error message sent to user
- RabbitMQ connection lost → Auto-reconnect (via amqplib)
- Invalid JSON from LLM → Zod validation catches it

## 📈 Monitoring

Check logs for:
- `LLM response received` → Intent detection working
- `Complaint created successfully` → Case Service integration working
- `AI reply event published` → Notification Service will receive

## 🎯 Next Steps

- Connect to Case Service (Phase 3)
- Connect to Notification Service (Phase 4)
- Add retry logic for failed Case Service calls
- Add metrics & monitoring (Prometheus)

## 📄 License

ISC

---

> Last updated: 2026-02-01 - CI/CD trigger for rebuild
