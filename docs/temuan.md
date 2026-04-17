

#### Temuan 13: Cache Profil Desa Menggunakan `Map` Tak Terbatas

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEANDALAN — Manajemen Memori |
| **File** | [knowledge.service.ts](govconnect-ai-service/src/services/knowledge.service.ts) |

**Masalah:** `_villageProfileCache` adalah `Map<string, { data, timestamp }>` biasa dengan TTL 15 menit. Berbeda dari cache lain yang menggunakan `LRUCache` terbatas, Map ini tumbuh tanpa batas. Entri kedaluwarsa hanya dibersihkan saat diakses (*lazy expiration*).

**Perbaikan:** Ganti dengan `LRUCache<string, VillageProfileData>` dengan maksimal ~200 entri.

---

#### Temuan 14: `usageCache` di API Key Manager Tumbuh Antar Siklus Flush

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEANDALAN — Manajemen Memori |
| **File** | [api-key-manager.service.ts](govconnect-ai-service/src/services/api-key-manager.service.ts) |

**Masalah:** `usageCache` adalah objek biasa dengan kunci berbasis waktu (format menit: `2026-02-26T10:30`), sehingga entri baru terus dibuat setiap menit. Meski `flushUsage()` membersihkan entri lama setiap 30 detik, di antara siklus flush entri dapat menumpuk.

**Perbaikan:** Tambahkan pemeriksaan batas entri maks, atau jalankan logika pembersihan juga saat `recordUsage()`.

#### Temuan 17: File yang Diunggah Dapat Diakses Tanpa Autentikasi

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEAMANAN — Kontrol Akses |
| **File** | [app.ts AI](govconnect-ai-service/src/app.ts#L919) / [app.ts Channel](govconnect-channel-service/src/app.ts#L32) |
| **Relevansi Hukum** | UU PDP Pasal 35; PP PSTE Pasal 24 |

**Masalah:**
- AI service: `app.use('/uploads/documents', express.static(uploadsDir))` — tanpa autentikasi
- Channel service: `app.use('/uploads', express.static(MEDIA_STORAGE_PATH))` — tanpa autentikasi

Siapa pun yang mengetahui URL file dapat mengakses dokumen *knowledge base* desa dan file media WhatsApp.

**Perbaikan:** Ganti dengan *route handler* terautentikasi. Pertimbangkan *signed URL* dengan waktu kedaluwarsa singkat.

---

#### Temuan 18: Map `statusCallbacks` Tumbuh Tanpa Batas

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEANDALAN — Kebocoran Memori Minor |
| **File** | [processing-status.service.ts](govconnect-ai-service/src/services/processing-status.service.ts#L224) |

**Masalah:** Catatan: Koneksi SSE sudah menangani *disconnect* dengan benar via `req.on('close', () => unsubscribe())` ✅. Namun, fungsi `unsubscribe()` menghapus *callback* dari array tetapi **tidak menghapus entri Map** yang kosong: `statusCallbacks.set(userId, [])` tetap tersisa. Seiring waktu, Map ini terus menumpuk entri kosong untuk setiap `userId` yang pernah terhubung.

**Perbaikan:**
```typescript
return () => {
  const current = statusCallbacks.get(userId) || [];
  const index = current.indexOf(callback);
  if (index > -1) current.splice(index, 1);
  // Hapus entri Map jika array sudah kosong:
  if (current.length === 0) {
    statusCallbacks.delete(userId); // Tambahkan baris ini
  } else {
    statusCallbacks.set(userId, current);
  }
};
```

---

#### Temuan 19: Error Handler Global Membocorkan Detail Error Internal

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEAMANAN — Kebocoran Informasi |
| **File** | [app.ts](govconnect-ai-service/src/app.ts#L1256) |

**Masalah:** Error handler global mengirimkan `err.message` dalam respons HTTP ke klien:
```typescript
res.status(500).json({
  error: 'Internal server error',
  message: err.message, // <-- detail internal bocor ke klien
});
```
Catatan: `err.stack` **tidak** dikirim ke klien — hanya dicatat di logger internal ✅. Namun `err.message` sendiri dapat mengandung: path file, nama kolom SQL, nama dependency, versi library, dll.

**Perbaikan:**
```typescript
res.status(500).json({
  error: 'Internal server error',
  message: config.nodeEnv === 'production'
    ? 'Terjadi kesalahan pada server'
    : err.message,
});
```

---

#### Temuan 20: Tidak Ada Batas Ukuran Body JSON di AI Service

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEAMANAN — Potensi DoS |
| **File** | [app.ts](govconnect-ai-service/src/app.ts#L75) |

**Masalah:** `app.use(express.json())` tanpa parameter `limit`. Penyerang dapat mengirim payload JSON berukuran ratusan MB yang akan menghabiskan RAM server.

Catatan: Channel service sudah benar — menggunakan `express.json({ limit: '10mb' })` ✅.

**Perbaikan:**
```typescript
app.use(express.json({ limit: '2mb' }));
```

---

#### Temuan 21: Tidak Ada Batas Panjang Prompt Sebelum Pemanggilan LLM

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEANDALAN / BIAYA |
| **File** | [llm.service.ts](govconnect-ai-service/src/services/llm.service.ts) |

**Masalah:** Meskipun `sanitizeUserInput()` memotong pesan pengguna hingga 1.000 karakter, total ukuran *prompt* (system prompt + histori + konteks knowledge + pesan user) tidak diperiksa terhadap batas jendela konteks model sebelum dikirim.

**Perbaikan:** Tambahkan estimasi token total sebelum pemanggilan LLM dan potong histori/konteks jika melebihi 80% jendela konteks model.


#### Temuan 24: `repairTruncatedJson` Berpotensi Menghasilkan Data Tidak Valid

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEANDALAN |
| **File** | [llm.service.ts](govconnect-ai-service/src/services/llm.service.ts) |

**Masalah:** Strategi perbaikan JSON ketiga membangun objek JSON baru dari *field* yang diekstrak via regex, yang berpotensi menggabungkan data dari percobaan respons yang berbeda atau kehilangan data penting.

**Dampak:** Respons yang rusak secara senyap dapat memberikan informasi salah kepada warga (misal: nomor HP yang salah di formulir pengaduan).

**Perbaikan:** Tandai respons yang diperbaiki dan catat semua percobaan perbaikan. Pertimbangkan memanggil ulang LLM daripada memperbaiki JSON secara agresif.

---

#### Temuan 25: Tidak Ada Konfigurasi *Content Security Policy* Eksplisit

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEAMANAN — Header HTTP |
| **File** | [app.ts](govconnect-ai-service/src/app.ts#L63) |

**Masalah:** Meskipun `helmet()` sudah dipasang, AI service tidak mengkonfigurasi `Content-Security-Policy` secara eksplisit. *Default* Helmet untuk CSP bisa terlalu longgar atau tidak sesuai.

**Perbaikan:**
```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
```

#### Temuan 29: Cache Katalog Service Tak Terbatas (Case Client)

| Bidang | Detail |
|--------|--------|
| **Keparahan** | RENDAH |
| **Jenis** | KEANDALAN |
| **File** | [case-client.service.ts](govconnect-ai-service/src/services/case-client.service.ts) |

**Masalah:** Cache katalog layanan desa menggunakan `Map` biasa tanpa batas ukuran. Dalam *deployment* multi-desa dengan ratusan desa, tumbuh linear tanpa eviksi.


#### Temuan 30: Normalisasi Teks Berpotensi Mengubah Makna Pesan Tertentu

| Bidang | Detail |
|--------|--------|
| **Keparahan** | RENDAH |
| **Jenis** | KEANDALAN |
| **File** | [text-normalizer.service.ts](govconnect-ai-service/src/services/text-normalizer.service.ts) |

**Masalah:** Koreksi *typo* (misal: "ga" → "tidak") menggunakan regex batas kata namun dapat mengubah makna dalam *edge case* tertentu.

---
#### Temuan 31: Perbandingan API Key Rentan Terhadap *Timing Attack*

| Bidang | Detail |
|--------|--------|
| **Keparahan** | RENDAH |
| **Jenis** | KEAMANAN |
| **File** | [case-service auth.middleware.ts](govconnect-case-service/src/middleware/auth.middleware.ts) / [app.ts](govconnect-ai-service/src/app.ts#L65) |

**Masalah:** Perbandingan API key menggunakan operator `===` biasa, bukan *timing-safe comparison*. Secara teori rentan terhadap *timing attack* (meski sulit dieksploitasi melalui jaringan).

**Perbaikan:**
```typescript
import * as crypto from 'crypto';
if (!apiKey || !crypto.timingSafeEqual(
  Buffer.from(apiKey as string),
  Buffer.from(config.internalApiKey)
)) { return res.status(403).json({ error: 'Forbidden' }); }
```


#### Temuan 35: AI Service Memiliki Ketergantungan Database yang Tidak Terdokumentasi

**File:** [token-usage.service.ts](govconnect-ai-service/src/services/token-usage.service.ts)

**Masalah:** Dokumentasi arsitektur menyatakan "AI Orchestrator bersifat *stateless* — tanpa DB." Namun `token-usage.service.ts` menggunakan Prisma client untuk menyimpan data ke tabel `ai_token_usage` PostgreSQL.

**Perbaikan:** Perbarui dokumentasi: *"AI Orchestrator sebagian besar stateless. Pengecualian: tabel `ai_token_usage` untuk analitik (non-kritis, fire-and-forget write)."*

#### Temuan 37: Tidak Ada Pelacakan Request (*Correlation ID*) Antar Service

**File:** Semua service

**Masalah:** Tidak ada *trace ID* atau *correlation ID* yang diteruskan antar service (Channel → AI → Case). Setiap service mencatat log secara independen tanpa cara mengkorelasikan satu *request* pengguna di seluruh service.

**Perbaikan:** Buat `X-Request-ID` UUID di webhook handler Channel service, teruskan melalui pesan RabbitMQ dan panggilan HTTP. Sertakan di semua entri log.

---

#### Temuan 38: Tidak Ada Strategi Degradasi Saat LLM Penuh Mati

**File:** [fallback-response.service.ts](govconnect-ai-service/src/services/fallback-response.service.ts)

**Masalah:** Saat semua kunci Gemini API habis atau API Google mati, pengguna hanya mendapat respons *fallback* generik. Tidak ada mekanisme antrian pesan untuk diproses kemudian.

**Perbaikan:** Implementasikan "mode terdegradasi": (1) antrekan pesan ke tabel PostgreSQL untuk diproses ulang saat LLM pulih, (2) arahkan *intent* yang diketahui ke respons statis/cache, (3) beri tahu pengguna dengan estimasi waktu pemulihan.