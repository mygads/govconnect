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
  # Business Flow GovConnect (Redesain)

  Dokumen ini menggantikan flow lama dan menyesuaikan fitur baru: knowledge base terpadu, layanan berbasis form publik, pengaduan dengan prioritas, serta channel WhatsApp + webchat.

  ## 🔄 Skenario Bisnis Utama

  ### A) Tanya Info Desa (Knowledge Base)
  ```
  1. Warga WA: "Jam buka kantor desa?"
  2. Channel Service menerima webhook, simpan message, publish event.
  3. AI Orchestrator deteksi intent: KNOWLEDGE_QUERY.
  4. AI query Dashboard KB (profil desa + dokumen + FAQ).
  5. AI publish reply.
  6. Notification Service kirim ke WA.
  ```

  ### B) Tanya Layanan + Arahkan ke Form
  ```
  1. Warga WA: "Syarat bikin KTP?"
  2. AI Orchestrator: intent SERVICE_INFO.
  3. AI query Case Service untuk syarat layanan + deskripsi.
  4. AI jawab syarat + tanya "mau diproses sekarang?".
  5. Jika iya, AI kirim link form:
     govconnect.my.id/form/{slug-desa}/{slug-layanan}?user=628xxx
  ```

  ### C) Submit Form Layanan (Web)
  ```
  1. Warga buka link form (WA auto prefill nomor).
  2. Warga isi persyaratan (file/field).
  3. Dashboard (public route) kirim ke Case Service.
  4. Case Service buat service_request + nomor layanan.
  5. Dashboard menampilkan nomor + tombol chat status.
  ```

  ### D) Cek Status Layanan (WA)
  ```
  1. Warga WA: "Cek status LAY-20260122-001"
  2. AI Orchestrator: intent CHECK_STATUS.
  3. AI query Case Service status.
  4. AI balas status + langkah berikutnya.
  ```

  ### E) Riwayat Layanan
  ```
  1. Warga WA: "Riwayat layanan saya"
  2. AI Orchestrator: intent HISTORY.
  3. AI query Case Service by wa_user_id.
  4. AI balas list ringkas + link detail (opsional).
  ```

  ### F) Pengaduan (Non-Urgent)
  ```
  1. Warga WA: "Lapor lampu jalan mati"
  2. AI Orchestrator: intent CREATE_COMPLAINT.
  3. AI cek aturan jenis (butuh alamat?).
  4. Jika alamat kosong dan wajib: AI tanya alamat.
  5. Case Service buat laporan + nomor laporan.
  6. AI balas konfirmasi.
  ```

  ### G) Pengaduan (Urgent + Nomor Penting)
  ```
  1. Warga WA: "Ada kebakaran di RT 02"
  2. AI Orchestrator tandai urgent.
  3. Case Service buat laporan urgent.
  4. AI balas:
     - konfirmasi laporan
     - nomor penting terkait (damkar/polisi)
  5. Dashboard memunculkan alert urgent.
  ```

  ### H) Channel Connect (WA + Webchat)
  ```
  1. Admin isi token WA + nomor WA di dashboard.
  2. Sistem tampilkan webhook URL (read-only).
  3. Admin toggle WA dan/atau Webchat.
  4. Jika OFF, AI tidak memproses channel tersebut.
  ```

  ### I) Live Chat & Takeover
  ```
  1. Admin melihat percakapan.
  2. Klik Takeover.
  3. Channel Service menonaktifkan AI sementara.
  4. Admin balas manual.
  5. Takeover selesai → AI aktif kembali.
  ```

  ### J) Uji Pengetahuan (Testing Knowledge)
  ```
  1. Admin buka halaman Uji Pengetahuan di dashboard.
  2. Admin isi pertanyaan + opsi kategori + sumber (knowledge/dokumen).
  3. Dashboard memanggil /api/testing-knowledge.
  4. API meneruskan ke AI Service /api/search (RAG) dengan filter desa.
  5. Admin melihat skor relevansi dan cuplikan hasil.
  ```

  ---

  ## 📌 Catatan Flow Penting
  - **Profil Desa** adalah input teks dan ikut knowledge base.
  - **Knowledge base file**: PDF/DOC/DOCX/TXT.
  - **Form publik** hanya untuk layanan administrasi, bukan pengaduan.
  - **Detail pengaduan**: admin bisa memberi update penanganan berupa teks dan foto.
  - **AI model** hanya dikonfigurasi via ENV (tidak ada halaman ubah model).
  - **Semua halaman admin dalam Bahasa Indonesia**.
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
