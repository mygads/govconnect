# Business Flow & Skenario Demo - GovConnect

## 🔄 Skenario Bisnis Utama

### Skenario A: Warga Membuat Laporan (Event-Driven / Async)

**Mapping ke Requirement EAI**: Asynchronous Communication

**Flow Lengkap**:

```
1. Warga mengirim pesan WhatsApp
   "Saya mau lapor jalan rusak di Jl. Melati No. 15, banyak lubang"
   
2. WhatsApp API → Webhook → Channel Service
   POST /webhook/whatsapp
   
3. Channel Service:
   - Validate payload
   - Save to gc_channel.messages (direction: IN)
   - Check takeover status (not in takeover)
   - Publish to RabbitMQ:
     Exchange: govconnect.events
     Routing Key: whatsapp.message.received
     Payload: {
       wa_user_id: "628123456789",
       message: "Saya mau lapor jalan rusak...",
       message_id: "msg_123"
     }
   
4. AI Service (consumes from RabbitMQ):
   - Receive message from queue
   - Call Gemini AI for intent detection
   - Intent detected: CREATE_COMPLAINT
   - Extract data:
     * kategori: "jalan_rusak"
     * alamat: "Jl. Melati No. 15"
     * deskripsi: "Banyak lubang"
   
5. AI Service → Case Service (Sync REST):
   POST http://case-service:3003/internal/complaints
   Headers: x-internal-api-key: xxx
   Body: {
     "wa_user_id": "628123456789",
     "kategori": "jalan_rusak",
     "alamat": "Jl. Melati No. 15",
     "deskripsi": "Banyak lubang"
   }
   
6. Case Service:
   - Generate complaint ID: LAP-20251208-001
   - Save to gc_case.complaints
   - Return complaint data
   
7. AI Service:
   - Generate reply message
   - Publish to RabbitMQ:
     Routing Key: govconnect.ai.reply
     Payload: {
       wa_user_id: "628123456789",
       reply_text: "✅ Laporan Anda telah diterima dengan nomor LAP-20251208-001..."
     }
   
8. Channel Service (consumes from RabbitMQ):
   - Receive reply from queue
   - Call WhatsApp API: POST /send-message
   - Save to gc_channel.messages (direction: OUT)
   
9. WhatsApp API → Warga
   Warga menerima konfirmasi laporan
```

**Sequence Diagram**:

```
Warga    WhatsApp   Channel    RabbitMQ    AI       Case      WhatsApp
  │         │         │           │         │         │          │
  ├─Kirim──►│         │           │         │         │          │
  │         ├─Webhook►│           │         │         │          │
  │         │         ├─Save DB   │         │         │          │
  │         │         ├─Publish──►│ (ASYNC) │         │          │
  │         │         │           ├─Consume►│         │          │
  │         │         │           │         ├─Detect  │          │
  │         │         │           │         ├─REST───►│ (SYNC)   │
  │         │         │           │         │         ├─Save DB  │
  │         │         │           │         │◄─Return─┤          │
  │         │         │           │◄Publish─┤ (ASYNC) │          │
  │         │         │◄─Consume──┤         │         │          │
  │         │         ├─Send─────────────────────────►│ (SYNC)   │
  │         │◄────────┤           │         │         │          │
  │◄─Terima─┤         │           │         │         │          │
```

**Demo Command**:
```bash
# 1. Kirim webhook test
curl -X POST http://localhost:3001/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "628123456789",
            "text": {
              "body": "Saya mau lapor jalan rusak di Jl. Melati No. 15"
            },
            "id": "msg_123",
            "timestamp": "1733654400"
          }]
        }
      }]
    }]
  }'

# 2. Monitor RabbitMQ
# Open http://localhost:15672
# Login: admin / genfityrabbitmq
# Check Queues

# 3. Check AI Service logs
docker compose -f govconnect/docker-compose.yml logs ai-service --tail=50

# 4. Check database
docker exec infra-postgres psql -U postgres -d gc_case \
  -c "SELECT id, kategori, alamat, status FROM complaints ORDER BY created_at DESC LIMIT 1;"
```

---

### Skenario B: Warga Cek Status Laporan (Request-Response / Sync)

**Mapping ke Requirement EAI**: Synchronous Communication

**Flow Lengkap**:

```
1. Warga mengirim pesan WhatsApp
   "Cek status LAP-20251208-001"
   
2. WhatsApp API → Channel Service (Webhook)
   
3. Channel Service → RabbitMQ (Publish)
   Routing Key: whatsapp.message.received
   
4. AI Service (Consume):
   - Detect intent: CHECK_STATUS
   - Extract complaint_id: "LAP-20251208-001"
   
5. AI Service → Case Service (Sync REST):
   GET http://case-service:3003/internal/complaints/LAP-20251208-001
   Headers: x-internal-api-key: xxx
   
6. Case Service:
   - Query gc_case.complaints
   - Return complaint data:
     {
       "id": "LAP-20251208-001",
       "kategori": "jalan_rusak",
       "alamat": "Jl. Melati No. 15",
       "status": "diproses",
       "created_at": "2025-12-08T10:00:00Z"
     }
   
7. AI Service:
   - Format response message
   - Publish reply to RabbitMQ
   
8. Channel Service → WhatsApp API
   
9. Warga menerima info status laporan
```

**Demo Command**:
```bash
curl -X POST http://localhost:3001/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "628123456789",
            "text": {
              "body": "Cek status LAP-20251208-001"
            },
            "id": "msg_124",
            "timestamp": "1733658000"
          }]
        }
      }]
    }]
  }'
```

---

### Skenario C: Warga Bertanya Informasi (Knowledge Query / RAG)

**Flow Lengkap**:

```
1. Warga: "Jam berapa kantor kelurahan buka?"
   
2. Channel Service → RabbitMQ
   
3. AI Service:
   - Detect intent: KNOWLEDGE_QUERY
   - Extract category: "jadwal"
   
4. AI Service (RAG Process):
   - Generate embedding dari query
   - Vector search di gc_ai.knowledge_vectors
   - Retrieve relevant documents
   - Combine dengan LLM untuk generate answer
   
5. AI Service → RabbitMQ (Publish reply)
   
6. Channel Service → WhatsApp API
   
7. Warga menerima jawaban:
   "🏢 Kantor Kelurahan
   Jam Operasional:
   Senin-Jumat: 08:00-15:00 WIB
   Sabtu: 08:00-12:00 WIB"
```

---

### Skenario D: Admin Takeover (Live Chat)

**Flow Lengkap**:

```
1. Admin di Dashboard melihat conversation
   
2. Admin klik "Ambil Alih Percakapan"
   
3. Dashboard → Channel Service:
   POST /internal/takeover/628123456789/start
   
4. Channel Service:
   - Set takeover status = true
   - Save to gc_channel.takeover_sessions
   
5. Warga mengirim pesan baru
   
6. Channel Service:
   - Check takeover status (true)
   - SKIP RabbitMQ publish (tidak ke AI)
   - Save message
   - Notify dashboard
   
7. Admin mengetik reply di Dashboard
   
8. Dashboard → Channel Service:
   POST /internal/messages/send
   
9. Channel Service → WhatsApp API
   
10. Warga menerima reply dari admin
   
11. Admin selesai, klik "Akhiri Percakapan"
   
12. Dashboard → Channel Service:
    POST /internal/takeover/628123456789/end
    
13. Pesan selanjutnya kembali ke AI
```

**Demo Command**:
```bash
# 1. Start takeover
curl -X POST http://localhost:3001/internal/takeover/628123456789/start \
  -H "x-internal-api-key: your_internal_api_key" \
  -H "Content-Type: application/json" \
  -d '{"admin_id": "admin_001", "admin_name": "Admin Kelurahan"}'

# 2. Check takeover status
curl http://localhost:3001/internal/takeover/628123456789/status \
  -H "x-internal-api-key: your_internal_api_key"

# 3. Send message as admin
curl -X POST http://localhost:3001/internal/messages/send \
  -H "x-internal-api-key: your_internal_api_key" \
  -H "Content-Type: application/json" \
  -d '{"wa_user_id": "628123456789", "message": "Halo, saya admin. Ada yang bisa saya bantu?"}'

# 4. End takeover
curl -X POST http://localhost:3001/internal/takeover/628123456789/end \
  -H "x-internal-api-key: your_internal_api_key"
```

---

## 📊 Data Flow Diagram

### Complete System Flow

```
┌─────────────┐
│   Warga     │
│  (WhatsApp) │
└──────┬──────┘
       │
       │ 1. Send Message
       ▼
┌─────────────────────┐
│   WhatsApp API      │
│  (External Service) │
└──────┬──────────────┘
       │
       │ 2. Webhook
       ▼
┌─────────────────────┐
│  Channel Service    │
│  - Receive          │
│  - Validate         │
│  - Save DB          │
└──────┬──────────────┘
       │
       │ 3. Publish Event (ASYNC)
       ▼
┌─────────────────────┐
│     RabbitMQ        │
│  (Message Broker)   │
└──────┬──────────────┘
       │
       │ 4. Consume Event
       ▼
┌─────────────────────┐
│    AI Service       │
│  - Intent Detection │
│  - Data Extraction  │
│  - RAG Search       │
└──────┬──────────────┘
       │
       │ 5. REST API Call (SYNC)
       ▼
┌─────────────────────┐
│   Case Service      │
│  - Create Complaint │
│  - Save DB          │
│  - Return Data      │
└──────┬──────────────┘
       │
       │ 6. Return Response
       ▼
┌─────────────────────┐
│    AI Service       │
│  - Generate Reply   │
└──────┬──────────────┘
       │
       │ 7. Publish Reply (ASYNC)
       ▼
┌─────────────────────┐
│     RabbitMQ        │
└──────┬──────────────┘
       │
       │ 8. Consume Reply
       ▼
┌─────────────────────┐
│  Channel Service    │
│  - Send to WA API   │
│  - Save DB          │
└──────┬──────────────┘
       │
       │ 9. Send Message (SYNC)
       ▼
┌─────────────────────┐
│   WhatsApp API      │
└──────┬──────────────┘
       │
       │ 10. Deliver
       ▼
┌─────────────┐
│   Warga     │
└─────────────┘
```

---

## 🎯 Integration Patterns

### 1. Synchronous Integration (REST API)

**Pattern**: Request-Response

**Use Cases**:
- Dashboard query data dari services
- AI Service create complaint di Case Service
- AI Service get complaint status dari Case Service
- Channel Service send message via WhatsApp API

**Implementation**:
```typescript
// AI Service → Case Service
const response = await axios.post(
  `${CASE_SERVICE_URL}/internal/complaints`,
  complaintData,
  {
    headers: {
      'x-internal-api-key': process.env.INTERNAL_API_KEY
    },
    timeout: 10000
  }
);
```

### 2. Asynchronous Integration (Message Broker)

**Pattern**: Publish-Subscribe

**Use Cases**:
- Channel Service → AI Service (new message)
- AI Service → Channel Service (reply)
- AI Service → Notification Service (send notification)

**RabbitMQ Configuration**:
```
Exchange: govconnect.events (topic)
Virtual Host: /govconnect

Routing Keys:
- whatsapp.message.received  → AI Service
- govconnect.ai.reply        → Channel Service
- govconnect.ai.error        → Channel Service
- notification.send          → Notification Service
```

**Implementation**:
```typescript
// Publish
await rabbitMQ.publish('govconnect.events', 'whatsapp.message.received', {
  wa_user_id: '628123456789',
  message: 'Hello'
});

// Subscribe
await rabbitMQ.subscribe('ai-service.whatsapp.message.#', async (msg) => {
  await processMessage(msg);
});
```

---

## 🔄 Error Handling & Retry

### Retry Strategy

```
Request fails
    ↓
Retry 1 (after 1s)
    ↓ (if fails)
Retry 2 (after 2s)
    ↓ (if fails)
Retry 3 (after 4s)
    ↓ (if fails)
Move to Dead Letter Queue
    ↓
Manual intervention / Alert
```

### Circuit Breaker Pattern

```typescript
// shared/circuit-breaker.ts
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      throw new Error('Circuit breaker is OPEN');
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}
```

**States**:
- **CLOSED**: Normal operation
- **OPEN**: Too many failures, reject requests
- **HALF_OPEN**: Test if service recovered

---

## 📈 Performance Optimization

### Message Batching

```
User sends 3 messages in 2 seconds:
  - "Saya mau lapor"
  - "Jalan rusak"
  - "Di Jl. Melati"

Channel Service batches them:
  ↓
Single AI request with combined message:
  "Saya mau lapor jalan rusak di Jl. Melati"
  ↓
Reduces AI API calls by 66%
```

Configuration:
```env
MESSAGE_BATCH_DELAY_MS=2000
MAX_BATCH_SIZE=10
```
