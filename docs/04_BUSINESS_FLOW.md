# Business Flow GovConnect (Redesain)

Dokumen ini menjelaskan alur utama sesuai fitur terbaru: knowledge base terpadu, layanan berbasis form publik, pengaduan dengan prioritas, serta channel WhatsApp + webchat.

## 🔄 Skenario Bisnis Utama

### A) Tanya Info Desa (Knowledge Base)
```
1. Warga WA: "Jam buka kantor desa?"
2. Channel Service menerima webhook, simpan pesan, publish event.
3. AI Orchestrator deteksi intent: KNOWLEDGE_QUERY.
4. AI query Dashboard KB (profil desa + dokumen + FAQ).
5. AI publish reply.
6. Notification Service kirim ke WA.
```

### B) Tanya Layanan + Arahkan ke Form
```
1. Warga WA: "Syarat bikin KTP?"
2. AI Orchestrator: intent SERVICE_INFO.
3. AI query Case Service untuk syarat + deskripsi layanan.
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

### D) Edit Data Layanan (Token)
```
1. Warga WA: "Ubah data layanan LAY-..."
2. AI minta konfirmasi + validasi kepemilikan.
3. Case Service buat edit token.
4. AI kirim link edit: /form/edit/{requestNumber}?token=...
```

### E) Batalkan Layanan (Konfirmasi)
```
1. Warga WA: "Batalkan layanan LAY-..."
2. AI minta konfirmasi pembatalan.
3. Jika setuju, Case Service ubah status ke dibatalkan.
4. AI mengonfirmasi pembatalan.
```

### F) Cek Status Layanan (WA)
```
1. Warga WA: "Cek status LAY-20260122-001"
2. AI Orchestrator: intent CHECK_STATUS.
3. AI query Case Service status (ownership check).
4. AI balas status + langkah berikutnya.
```

### G) Riwayat Layanan
```
1. Warga WA: "Riwayat layanan saya"
2. AI Orchestrator: intent HISTORY.
3. AI query Case Service by wa_user_id.
4. AI balas list ringkas.
```

### H) Pengaduan (Non-Urgent)
```
1. Warga WA: "Lapor lampu jalan mati"
2. AI Orchestrator: intent CREATE_COMPLAINT.
3. AI cek aturan jenis (butuh alamat?).
4. Jika alamat wajib dan kosong: AI tanya alamat.
5. Case Service buat laporan + nomor laporan.
6. AI balas konfirmasi.
```

### I) Pengaduan (Urgent + Nomor Penting)
```
1. Warga WA: "Ada kebakaran di RT 02"
2. AI Orchestrator membaca konfigurasi urgent pada jenis.
3. Case Service buat laporan urgent.
4. AI balas:
  - konfirmasi laporan
  - nomor penting terkait (damkar/polisi)
5. Dashboard memunculkan alert urgent.
```

### J) Update & Pembatalan Pengaduan (Warga)
```
1. Warga WA: "Ubah laporan LAP-..." atau "Batalkan laporan LAP-..."
2. AI validasi kepemilikan dan status.
3. Case Service update data atau ubah status dibatalkan.
4. AI mengonfirmasi.
```

### K) Channel Connect (WA + Webchat)
```
1. Admin klik "Buat Session" di dashboard.
2. Sistem membuat session dan menyimpan token di DB internal.
3. Admin klik "Konek & Ambil QR" lalu scan QR untuk login WhatsApp.
4. Sistem menampilkan nomor WA & status koneksi.
5. Admin toggle WA dan/atau Webchat.
6. Jika OFF, AI tidak memproses channel tersebut.
```

### L) Live Chat & Takeover
```
1. Admin melihat percakapan.
2. Klik Takeover.
3. Channel Service menonaktifkan AI sementara.
4. Admin balas manual.
5. Takeover selesai → AI aktif kembali.
```

### M) Uji Pengetahuan (Testing Knowledge)
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
