# GovConnect — Laporan Audit Keamanan, Keandalan & Fitur

**Tanggal:** 26 Februari 2026
**Cakupan:** govconnect-ai-service (primer), govconnect-channel-service, govconnect-case-service (tinjauan silang)
**Metode:** Tinjauan mendalam kode sumber (*deep code review*) secara menyeluruh
**Status Verifikasi:** Semua temuan telah diverifikasi langsung dari kode sumber

---

## Ringkasan Eksekutif

Sistem GovConnect AI Service adalah orkestrasi AI *stateless* yang dirancang untuk chatbot WhatsApp/webchat pelayanan publik desa di Indonesia. Kode menunjukkan pola yang baik — *circuit breaker*, *LRU cache* terbatas, rantai *fallback* model LLM, rotasi kunci BYOK, dan *graceful shutdown*. Namun, ditemukan sejumlah **masalah kritis dan risiko tinggi** yang wajib ditangani sebelum sistem digunakan oleh masyarakat umum — khususnya seputar **endpoint tanpa autentikasi yang membocorkan data pengguna**, **konfigurasi CORS yang membuka akses publik**, **penanganan Data Pribadi yang tidak memenuhi UU PDP**, dan **seluruh state percakapan yang akan hilang saat server restart**.

Laporan ini berisi **41 temuan** di berbagai tingkat keparahan, ditambah **10 ide fitur** untuk penguatan sistem di masa mendatang.

---

## Kepatuhan Hukum & Regulasi Indonesia

Sistem ini menangani data warga dan menyediakan layanan publik pemerintah desa. Oleh karena itu, tunduk pada regulasi berikut:

### 1. UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP)

UU PDP mengatur pemrosesan data pribadi, termasuk kategori data sensitif seperti **NIK** dan **nomor telepon**. Sistem GovConnect menyimpan dan memproses data ini.

| Kewajiban | Status Sistem Saat Ini |
|-----------|----------------------|
| Persetujuan eksplisit sebelum pengumpulan data (Pasal 20) | ❌ Tidak ada mekanisme persetujuan |
| Perlindungan teknis data pribadi (Pasal 35) | ❌ Disimpan *plain text* di memori |
| Pembatasan tujuan pemrosesan (Pasal 16) | ⚠️ Nomor HP warga diekstrak otomatis dari pesan dan disimpan tanpa konfirmasi eksplisit |
| Pemberitahuan kepada subjek data (Pasal 30) | ❌ Tidak ada pemberitahuan kebijakan privasi |
| Keamanan data (Pasal 35) | ❌ Tidak ada enkripsi saat disimpan di *cache* |

**Sanksi Pelanggaran UU PDP:**
- Sanksi Administratif (Pasal 57): teguran tertulis, penghentian sementara, penghapusan data, denda hingga **2% dari pendapatan tahunan**
- Sanksi Pidana (Pasal 65-67): penjara hingga **4 tahun** atau denda hingga **Rp 4 miliar** untuk kebocoran data yang disengaja

### 2. UU No. 11 Tahun 2008 jo UU No. 1 Tahun 2024 tentang Informasi dan Transaksi Elektronik (UU ITE)

| Kewajiban | Status Sistem Saat Ini |
|-----------|----------------------|
| PSE wajib menyelenggarakan sistem secara andal, aman, bertanggung jawab (Pasal 15) | ⚠️ Terdapat celah keamanan signifikan |
| Perlindungan sistem dari akses tidak sah | ❌ Beberapa endpoint tidak memiliki autentikasi |
| Menjaga kerahasiaan informasi elektronik yang dikirimkan (Pasal 32) | ⚠️ Data PII dikirim ke pihak ketiga (Google Gemini) |

**Sanksi (Pasal 46-48):** penjara hingga **8 tahun** atau denda hingga **Rp 800 juta** untuk kasus pelanggaran yang disengaja.

### 3. PP No. 71 Tahun 2019 tentang Penyelenggaraan Sistem dan Transaksi Elektronik (PSTE)

| Kewajiban | Status Sistem Saat Ini |
|-----------|----------------------|
| Menjamin kerahasiaan dan integritas data pengguna (Pasal 24) | ⚠️ Sebagian belum terpenuhi |
| Menerapkan manajemen risiko keamanan informasi (Pasal 26) | ❌ Belum ada kebijakan keamanan formal |
| Memiliki mekanisme pemulihan data (Pasal 24) | ❌ State percakapan tidak dipersistensikan |

### 4. Perpres No. 95 Tahun 2018 tentang Sistem Pemerintahan Berbasis Elektronik (SPBE)

Karena GovConnect adalah aplikasi layanan publik pemerintah (kelurahan/desa):

| Kewajiban | Status Sistem Saat Ini |
|-----------|----------------------|
| Keamanan informasi sesuai SNI ISO/IEC 27001 | ❌ Belum ada sertifikasi/audit formal |
| *Audit trail* untuk semua tindakan pengelola sistem | ❌ Tindakan admin tidak dicatat secara persisten |
| Rencana pemulihan bencana (*Disaster Recovery Plan*) | ❌ Tidak ada strategi pemulihan data saat server mati |

### 5. Permenkominfo No. 20 Tahun 2016 tentang Perlindungan Data Pribadi dalam Sistem Elektronik

Masih berlaku sebagai acuan teknis sebelum UU PDP berlaku penuh. Mewajibkan:
- Jaminan **kerahasiaan**, **integritas**, dan **ketersediaan** data pribadi
- **Mekanisme persetujuan** pengumpulan data dari subjek data

---

## Temuan Audit

### 🔴 KRITIS — Tindakan Segera Diperlukan

---

#### Temuan 1: Endpoint Status Terbuka Tanpa Autentikasi

| Bidang | Detail |
|--------|--------|
| **Keparahan** | KRITIS |
| **Jenis** | KEAMANAN — Kebocoran Data |
| **File** | [status.routes.ts](govconnect-ai-service/src/routes/status.routes.ts) / [app.ts](govconnect-ai-service/src/app.ts#L955) |
| **Kode Bermasalah** | `app.use('/api/status', statusRoutes)` tanpa middleware auth |
| **Relevansi Hukum** | UU PDP Pasal 35 (keamanan data); UU ITE Pasal 15 (sistem aman) |

**Masalah:** Rute `/api/status/*` dipasang di `app.ts` tanpa `internalAuthMiddleware`. Padahal middleware ini *hanya* diterapkan pada `/admin` dan `/stats`. Akibatnya, keempat endpoint berikut terbuka untuk siapa saja:
- `GET /api/status/summary` — ringkasan semua proses yang sedang berjalan
- `GET /api/status/active` — daftar lengkap semua pengguna yang sedang aktif beserta `userId` mereka
- `GET /api/status/stream/:userId` — koneksi SSE *real-time* untuk melihat tahap pemrosesan pesan siapa pun
- `GET /api/status/:userId` — status pemrosesan satu pengguna spesifik

**Dampak:** Siapa saja di internet dapat menghitung jumlah pengguna aktif, mengetahui `wa_user_id` (nomor telepon WhatsApp), dan memantau percakapan warga secara *real-time*. Ini adalah kebocoran **Data Pribadi** langsung.

**Perbaikan:**
```typescript
// Di app.ts, ubah baris:
app.use('/api/status', statusRoutes);
// Menjadi:
app.use('/api/status', internalAuthMiddleware, statusRoutes);
```

---

#### Temuan 2: CORS Berdefault ke Wildcard `*`

| Bidang | Detail |
|--------|--------|
| **Keparahan** | KRITIS |
| **Jenis** | KEAMANAN — Konfigurasi Salah |
| **File** | [app.ts](govconnect-ai-service/src/app.ts#L63) |
| **Kode Bermasalah** | `app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') \|\| '*' }))` |
| **Relevansi Hukum** | UU ITE Pasal 15; PP PSTE Pasal 26 |

**Masalah:** Jika *environment variable* `ALLOWED_ORIGINS` tidak diisi, sistem otomatis mengizinkan **semua domain** untuk mengakses API ini dari *browser* mana pun. Dikombinasikan dengan Temuan 1, website pihak ketiga mana pun dapat mengambil data status pengguna secara lintas-*origin*.

**Perbaikan:**
```typescript
// Validasi saat startup (di env.ts):
if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
  throw new Error('ALLOWED_ORIGINS wajib diisi di production');
}
// Di app.ts — hapus fallback '*':
app.use(cors({ origin: config.allowedOrigins })); // Harus berupa array domain sah
```

---

#### Temuan 3: Endpoint `/metrics` Prometheus Tanpa Autentikasi

| Bidang | Detail |
|--------|--------|
| **Keparahan** | KRITIS |
| **Jenis** | KEAMANAN — Kebocoran Informasi Internal |
| **File** | [app.ts AI Service](govconnect-ai-service/src/app.ts#L76) / [app.ts Channel Service](govconnect-channel-service/src/app.ts#L53) |
| **Relevansi Hukum** | UU ITE Pasal 15; PP PSTE Pasal 26 |

**Masalah:** Endpoint `/metrics` pada **kedua service** (AI dan Channel) tidak memiliki perlindungan autentikasi. Endpoint ini mengekspos metrik Prometheus: laju permintaan, laju *error*, penggunaan RAM, latensi *event loop*, jumlah koneksi, dll.

**Dampak:** Penyerang dapat melakukan *fingerprinting* infrastruktur, mendeteksi ambang kelelahan sumber daya untuk serangan DoS yang ditargetkan, dan memantau pola trafik secara *real-time*.

**Perbaikan:**
```typescript
app.get('/metrics', internalAuthMiddleware, async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.send(await promClient.register.metrics());
});
```

---

#### Temuan 4: Dokumentasi API Swagger `/api-docs` Terbuka untuk Publik

| Bidang | Detail |
|--------|--------|
| **Keparahan** | KRITIS |
| **Jenis** | KEAMANAN — Kebocoran Informasi |
| **File** | [app.ts AI Service](govconnect-ai-service/src/app.ts#L86) / [app.ts Channel Service](govconnect-channel-service/src/app.ts#L62) |
| **Relevansi Hukum** | UU ITE Pasal 15 |

**Masalah:** Dokumentasi API lengkap di `/api-docs` dan `/api-docs.json` dapat diakses oleh siapa saja tanpa autentikasi pada **kedua service**. Dokumentasi ini berisi daftar lengkap semua *endpoint*, parameter permintaan, skema respons, dan contoh data.

**Dampak:** Drastis mengurangi usaha yang diperlukan penyerang untuk memetakan sistem. Dikombinasikan dengan endpoint yang tidak terautentikasi (Temuan 1–3), ini menjadi "peta jalan" eksploitasi yang lengkap.

**Perbaikan:**
```typescript
// Nonaktifkan di production, atau lindungi dengan auth:
if (config.nodeEnv !== 'production') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
} else {
  app.use('/api-docs', internalAuthMiddleware, swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}
```

---

### 🟠 RISIKO TINGGI — Tangani Sebelum Produksi

---

#### Temuan 5: Data Pribadi Disimpan *Plain Text* di Memori (Pelanggaran UU PDP)

| Bidang | Detail |
|--------|--------|
| **Keparahan** | TINGGI |
| **Jenis** | KEAMANAN / KEPATUHAN HUKUM |
| **File** | [user-profile.service.ts](govconnect-ai-service/src/services/user-profile.service.ts) |
| **Relevansi Hukum** | **UU PDP Pasal 35** (keamanan data); Permenkominfo No. 20/2016 |

**Masalah:** Profil pengguna berisi `nama_lengkap`, `no_hp`, `default_address`, `default_rt_rw`, dan field `nik` (Nomor Induk Kependudukan — **data pribadi yang bersifat spesifik** per Pasal 4 UU PDP), semuanya disimpan dalam *plain text* di LRU cache in-memory (kapasitas 2.000 entri, TTL 24 jam) tanpa enkripsi.

**Dampak:** *Heap dump*, inspeksi memori, atau *crash dump* proses akan langsung mengekspos Data Pribadi hingga 2.000 warga. NIK memerlukan perlindungan ekstra karena termasuk data sensitif per UU PDP.

**Perbaikan:**
```typescript
import * as crypto from 'crypto';
const ENCRYPTION_KEY = process.env.PROFILE_ENCRYPTION_KEY!; // 32 bytes hex

function encryptField(value: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}
// Terapkan pada field: nik, no_hp sebelum disimpan ke cache
```

---

#### Temuan 6: Data Pribadi Warga Dikirim ke Google Gemini (Pihak Ketiga di Luar Indonesia)

| Bidang | Detail |
|--------|--------|
| **Keparahan** | TINGGI |
| **Jenis** | KEAMANAN / KEPATUHAN HUKUM |
| **File** | [user-profile.service.ts](govconnect-ai-service/src/services/user-profile.service.ts#L287) — fungsi `getProfileContext()` |
| **Relevansi Hukum** | **UU PDP Pasal 56** (transfer data lintas batas); UU ITE Pasal 32 |

**Masalah:** Fungsi `getProfileContext()` memasukkan `nama_lengkap` warga ke dalam *prompt* sistem yang dikirim ke Google Gemini (server berlokasi di luar Indonesia). Selain itu, `getAutoFillSuggestions()` mengembalikan NIK, nomor HP, dan alamat yang digunakan dalam alur pengisian formulir pengaduan.

**Dampak:** Transfer data pribadi ke server di luar Indonesia memerlukan **persetujuan eksplisit** dari subjek data dan kepastian bahwa negara tujuan memiliki tingkat perlindungan data yang setara (UU PDP Pasal 56).

**Perbaikan:**
```typescript
// Sebelum mengirim ke LLM, lakukan masking:
function maskName(name: string): string {
  const parts = name.split(' ');
  return parts[0] + (parts.length > 1 ? ' ***' : '');
}
// Dalam getProfileContext():
if (profile.nama_lengkap) {
  parts.push(`Nama user: ${maskName(profile.nama_lengkap)}`); // "Budi ***" bukan "Budi Santoso"
}
```

---

#### Temuan 7: Seluruh State Percakapan Hilang Saat Server Restart

| Bidang | Detail |
|--------|--------|
| **Keparahan** | TINGGI |
| **Jenis** | KEANDALAN — Kehilangan Data |
| **File** | [ump-state.ts](govconnect-ai-service/src/services/ump-state.ts) |
| **Relevansi Hukum** | PP PSTE Pasal 24 (integritas data); Perpres SPBE No. 95/2018 |

**Masalah:** Terdapat 11 LRU cache yang menampung *state* percakapan kritis: data pengaduan yang sedang dikumpulkan (`pendingComplaintData`, maks 500 entri), konfirmasi alamat (`pendingAddressConfirmation`, 1.000 entri), konfirmasi pembatalan, konfirmasi nama, tawaran formulir layanan, antrian foto, dll. Seluruhnya murni disimpan di RAM tanpa mekanisme persistensi.

**Dampak:** *Restart* container, *deployment* baru, atau OOM kill menyebabkan **kehilangan data langsung** untuk semua percakapan yang sedang berjalan. Warga yang sedang di tengah proses pengaduan harus memulai ulang dari awal tanpa penjelasan apa pun.

**Perbaikan (menggunakan PostgreSQL yang sudah ada, tanpa dependensi baru):**
```sql
-- Tambahkan tabel sesi sementara di database yang sudah ada:
CREATE TABLE conversation_sessions (
  id          TEXT PRIMARY KEY,        -- wa_user_id
  village_id  TEXT,
  state_type  TEXT NOT NULL,           -- 'pendingComplaint', 'pendingAddress', dll.
  state_data  JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON conversation_sessions (expires_at);
```
Prisma sudah terpasang di AI service (digunakan `ai_token_usage`). Tinggal tambahkan model ini dan gunakan write *fire-and-forget* untuk state kritis seperti `pendingComplaintData`.

---

#### Temuan 8: Data Rate Limiter (Termasuk Blacklist) Hilang Saat Restart

| Bidang | Detail |
|--------|--------|
| **Keparahan** | TINGGI |
| **Jenis** | KEANDALAN / KEAMANAN |
| **File** | [rate-limiter.service.ts](govconnect-ai-service/src/services/rate-limiter.service.ts) |

**Masalah:** Hitungan laporan harian, penghitung pelanggaran, timer *cooldown*, dan seluruh **daftar hitam (*blacklist*)** nomor spam disimpan di JavaScript `Map` in-memory. Setiap *restart* me-*reset* semua data ke nol.

**Dampak:** Nomor yang di-*blacklist* karena spam langsung mendapatkan akses kembali setelah server *restart*. Mekanisme *auto-blacklist* setelah 10 pelanggaran tidak efektif antar-*deployment*.

**Perbaikan (menggunakan PostgreSQL yang sudah ada):**
```typescript
// Persistensikan blacklist ke tabel PostgreSQL:
// await prisma.rate_limit_blacklist.upsert({ where: { wa_user_id }, create: {...}, update: {...} })
// Muat ulang blacklist dari database saat service startup
```

---

#### Temuan 9: Rate Limit Webchat Dapat Di-*Bypass* via `session_id` Baru

| Bidang | Detail |
|--------|--------|
| **Keparahan** | TINGGI |
| **Jenis** | KEAMANAN — Bypass Kontrol |
| **File** | [webchat.routes.ts](govconnect-ai-service/src/routes/webchat.routes.ts#L92) |

**Masalah:** `keyGenerator` pada `webchatRateLimit` **memprioritaskan `session_id`** dari *body* permintaan (yang dikendalikan klien), baru kemudian *fallback* ke IP:
```typescript
return req.body?.session_id  // <-- dikendalikan penyerang, diprioritaskan
  || req.headers['x-forwarded-for']...
  || req.ip;
```
Penyerang cukup membuat `session_id` baru di setiap permintaan untuk melewati pengecekan IP sepenuhnya.

**Dampak:** *Rate limiting* webchat efektif tidak berfungsi. Penyerang dapat membanjiri AI service, menghabiskan kuota token Gemini, dan meningkatkan biaya secara signifikan.

**Perbaikan:**
```typescript
keyGenerator: (req) => {
  // Prioritaskan IP — tidak bisa dipalsukan dari sisi klien:
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.ip
    || 'unknown';
},
```

---

#### Temuan 10: Webhook Channel Service Tanpa Verifikasi Tanda Tangan HMAC

| Bidang | Detail |
|--------|--------|
| **Keparahan** | TINGGI |
| **Jenis** | KEAMANAN — Autentikasi Lemah |
| **File** | [validation.middleware.ts](govconnect-channel-service/src/middleware/validation.middleware.ts) |
| **Relevansi Hukum** | UU ITE Pasal 15; PP PSTE Pasal 26 |

**Masalah:** Channel service hanya memvalidasi **format** payload webhook (ada field `type`, `jsonData`, atau `entry`), tetapi **tidak memverifikasi bahwa pesan benar-benar berasal dari Genfity-WA**. Tidak ada pemeriksaan HMAC-SHA256, tidak ada *shared secret*, dan tidak ada pembatasan IP.

**Dampak:** Siapa pun yang mengetahui URL webhook dapat menyuntikkan pesan WhatsApp palsu — menyamar sebagai nomor telepon mana pun, memicu respons AI, membuat pengaduan palsu di Case Service, serta menguras kuota token LLM.

**Perbaikan:**
```typescript
import * as crypto from 'crypto';
export function verifyWebhookSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-webhook-signature'] as string;
  const secret = process.env.WEBHOOK_SECRET!;
  if (!signature || !secret) { res.status(401).json({ error: 'Missing signature' }); return; }
  
  const expected = 'sha256=' + crypto.createHmac('sha256', secret)
    .update(JSON.stringify(req.body)).digest('hex');
  
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    res.status(401).json({ error: 'Invalid signature' }); return;
  }
  next();
}
```

---

#### Temuan 11: `wa_user_id` (Nomor Telepon) Tersimpan Permanen di Database Analitik

| Bidang | Detail |
|--------|--------|
| **Keparahan** | TINGGI |
| **Jenis** | KEPATUHAN HUKUM — Retensi Data |
| **File** | [token-usage.service.ts](govconnect-ai-service/src/services/token-usage.service.ts#L127) |
| **Relevansi Hukum** | **UU PDP Pasal 16** (pembatasan tujuan & retensi); Pasal 35 (keamanan) |

**Masalah:** Fungsi `recordTokenUsage()` menyimpan `wa_user_id` (nomor telepon WhatsApp warga) dan `session_id` secara permanen di tabel `ai_token_usage` PostgreSQL. Tidak ada kebijakan retensi — rekaman terus menumpuk tanpa batas.

**Dampak:** Database analitik mengandung Data Pribadi, menciptakan risiko kepatuhan UU PDP. Semakin lama data tersimpan, semakin besar eksposur jika terjadi pelanggaran database.

**Perbaikan:**
```typescript
// Hash wa_user_id sebelum menyimpan (satu arah, tidak dapat dikembalikan):
const hashedUserId = wa_user_id
  ? crypto.createHash('sha256').update(wa_user_id).digest('hex').substring(0, 16)
  : null;

// Tambahkan scheduled job untuk retensi 90 hari:
// DELETE FROM ai_token_usage WHERE created_at < NOW() - INTERVAL '90 days'
```

---

#### Temuan 12: Endpoint *Health Check* Mengekspos Arsitektur Internal

| Bidang | Detail |
|--------|--------|
| **Keparahan** | TINGGI |
| **Jenis** | KEAMANAN — Kebocoran Informasi |
| **File** | [app.ts](govconnect-ai-service/src/app.ts#L105) |

**Masalah:** Tiga endpoint *health check* terbuka tanpa autentikasi:
- `/health` — status koneksi RabbitMQ dan kondisi *circuit breaker*
- `/health/rabbitmq` — ukuran *retry queue*, item tertua, jumlah pesan tertunda
- `/health/services` — status layanan *upstream*

**Dampak:** Penyerang dapat mengetahui komponen infrastruktur (RabbitMQ), mendeteksi kapan layanan terdegradasi (*circuit breaker* OPEN = case service sedang mati), dan menarget serangan pada saat paling rentan.

**Perbaikan:**
```typescript
// Hanya status minimal untuk liveness probe (Docker/Kubernetes):
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Detail dipindahkan ke endpoint yang terautentikasi:
app.get('/admin/health/detailed', internalAuthMiddleware, detailedHealthHandler);
```

---

### 🟡 RISIKO MENENGAH — Tangani di Sprint Berikutnya

---

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

---

#### Temuan 15: Tidak Ada Isolasi Rate Limit Per Desa

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEANDALAN / KEAMANAN |
| **File** | [rate-limiter.service.ts](govconnect-ai-service/src/services/rate-limiter.service.ts) |

**Masalah:** *Rate limit* hanya berdasarkan `wa_user_id`. Tidak ada konsep batas total per desa. Satu desa dengan trafik tinggi atau serangan spam dapat menghabiskan kapasitas bersama dan memengaruhi seluruh desa lain.

**Perbaikan:** Tambahkan *rate limit* per-desa (total permintaan per desa per hari) dan *alert* saat mendekati batas anggaran token.

---

#### Temuan 16: Tidak Ada Pemindaian Virus/Malware pada Unggahan File

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEAMANAN — Keamanan File |
| **File** | [upload.routes.ts](govconnect-ai-service/src/routes/upload.routes.ts) |

**Masalah:** File yang diunggah (PDF, DOCX, DOC, PPTX, PPT, TXT, MD, CSV hingga 10MB) hanya divalidasi berdasarkan ekstensi dan tipe MIME — tidak ada pemindaian konten. File berbahaya (PDF dengan JavaScript *embedded*, DOCX dengan macro) dapat diunggah dan kemudian disajikan ke admin.

**Perbaikan:** Integrasikan ClamAV (tersedia sebagai Docker container) atau layanan pemindaian *cloud*. Tambahkan header `Content-Disposition: attachment` pada semua file yang disajikan.

---

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

---

#### Temuan 22: CORS Channel Service Sepenuhnya Terbuka

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEAMANAN — Konfigurasi |
| **File** | [app.ts Channel](govconnect-channel-service/src/app.ts#L26) |
| **Kode Bermasalah** | `app.use(cors())` — tanpa konfigurasi *origin* sama sekali |

**Masalah:** Channel service menggunakan `cors()` tanpa parameter apapun — mengizinkan semua *origin* secara default. Ini lebih buruk dari AI service yang setidaknya mencoba membaca `ALLOWED_ORIGINS`.

**Perbaikan:** Konfigurasikan *origin* CORS eksplisit, minimal domain Dashboard admin.

---

#### Temuan 23: Webhook Dipasang di Jalur Root untuk Kompatibilitas Mundur

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEAMANAN — Permukaan Serangan |
| **File** | [app.ts Channel](govconnect-channel-service/src/app.ts#L94) |
| **Kode Bermasalah** | `app.use('/', webhookRoutes)` |

**Masalah:** Rute webhook dipasang dua kali: di `/webhook/whatsapp` *dan* di root `/` (untuk "kompatibilitas mundur"). Ini melipatgandakan jalur yang dapat diserang dan mempersulit konfigurasi *firewall*/WAF.

**Perbaikan:** Hapus pemasangan di root. Perbarui konfigurasi URL webhook di Genfity-WA ke jalur kanonik `/webhook/whatsapp`.

---

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

---

#### Temuan 26: Ekstraksi Nomor HP Otomatis Tanpa Persetujuan Eksplisit

| Bidang | Detail |
|--------|--------|
| **Keparahan** | MENENGAH |
| **Jenis** | KEPATUHAN HUKUM |
| **File** | [user-profile.service.ts](govconnect-ai-service/src/services/user-profile.service.ts#L227) — fungsi `learnFromMessage()` |
| **Relevansi Hukum** | **UU PDP Pasal 20** (persetujuan eksplisit) |

**Masalah:** Fungsi `learnFromMessage()` secara otomatis mengekstrak nomor HP dari pesan pengguna menggunakan regex dan menyimpannya di profil tanpa konfirmasi eksplisit:
```typescript
const phoneMatch = message.match(/\b(08\d{8,12})\b/);
if (phoneMatch) {
  profile.no_hp = phoneMatch[1]; // Disimpan langsung, tidak ada konfirmasi
}
```
Pengguna mungkin menyebut nomor telepon orang lain dalam percakapan (misal: *"hubungi tetangga saya di 081234567890"*) yang kemudian salah tersimpan sebagai nomor mereka sendiri.

**Perbaikan:** Konfirmasi nomor yang diekstrak sebelum menyimpan. Tampilkan notifikasi persetujuan saat pertama kali berinteraksi.

---

### 🔵 RISIKO RENDAH — Catat untuk Perbaikan Berikutnya

---

#### Temuan 27: *Circuit Breaker* Menggunakan `console.*` Bukan Logger Terstruktur

| Bidang | Detail |
|--------|--------|
| **Keparahan** | RENDAH |
| **Jenis** | PENINGKATAN |
| **File** | [shared/circuit-breaker.ts](shared/circuit-breaker.ts) |

**Masalah:** Menggunakan `console.warn()`, `console.error()`, `console.info()` alih-alih logger Winston milik proyek. Perubahan state *circuit breaker* tidak akan muncul di sistem agregasi log.

---

#### Temuan 28: *Retry Backoff* HTTP Client Tanpa *Jitter*

| Bidang | Detail |
|--------|--------|
| **Keparahan** | RENDAH |
| **Jenis** | KEANDALAN |
| **File** | [shared/http-client.ts](shared/http-client.ts) |

**Masalah:** `const delay = this.retryDelay * Math.pow(2, attempt - 1)` — eksponensial murni tanpa *jitter*. Saat banyak klien mengalami kegagalan yang sama, semua *retry* pada interval persis sama (*thundering herd*).

**Perbaikan:** `const delay = this.retryDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random());`

---

#### Temuan 29: Cache Katalog Service Tak Terbatas (Case Client)

| Bidang | Detail |
|--------|--------|
| **Keparahan** | RENDAH |
| **Jenis** | KEANDALAN |
| **File** | [case-client.service.ts](govconnect-ai-service/src/services/case-client.service.ts) |

**Masalah:** Cache katalog layanan desa menggunakan `Map` biasa tanpa batas ukuran. Dalam *deployment* multi-desa dengan ratusan desa, tumbuh linear tanpa eviksi.

---

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

---

#### Temuan 32: Endpoint Root `/` Mengekspos Peta Lengkap API

| Bidang | Detail |
|--------|--------|
| **Keparahan** | RENDAH |
| **Jenis** | KEAMANAN — Kebocoran Informasi |
| **File** | [app.ts](govconnect-ai-service/src/app.ts#L1195) |

**Masalah:** `GET /` mengembalikan JSON yang mencantumkan setiap *endpoint* termasuk jalur admin, stats, dan internal — tanpa memerlukan autentikasi.

**Perbaikan:**
```typescript
app.get('/', (req, res) => res.json({ service: 'GovConnect AI', status: 'running' }));
// Pindahkan peta endpoint ke GET /admin/routes
```

---

#### Temuan 33: Log Payload Penuh di Webhook Controller

| Bidang | Detail |
|--------|--------|
| **Keparahan** | RENDAH |
| **Jenis** | KEAMANAN — Kebocoran di Log |
| **File** | [webhook.controller.ts](govconnect-channel-service/src/controllers/webhook.controller.ts) |

**Masalah:** `fullPayload: JSON.stringify(payload).substring(0, 2000)` mencatat hingga 2KB payload mentah di level DEBUG, mencakup konten pesan, nomor telepon, dan metadata. Jika `LOG_LEVEL=debug` tidak sengaja diaktifkan di production, Data Pribadi akan tercatat di log.

---

#### Temuan 34: Variabel `GEMINI_API_KEY` Berpotensi Bocor via Serialisasi Config

| Bidang | Detail |
|--------|--------|
| **Keparahan** | RENDAH |
| **Jenis** | KEAMANAN |
| **File** | [env.ts](govconnect-ai-service/src/config/env.ts) |

**Masalah:** Objek `config` mengandung `geminiApiKey` dan `internalApiKey`. Jika ada kode yang secara tidak sengaja melakukan `JSON.stringify(config)` atau `logger.info('Config:', config)`, kunci API dapat tercatat.

**Perbaikan:**
```typescript
Object.defineProperty(config, 'geminiApiKey', { enumerable: false, value: apiKey });
Object.defineProperty(config, 'internalApiKey', { enumerable: false, value: internalKey });
```

---

### ℹ️ INFORMASI — Observasi & Catatan

---

#### Temuan 35: AI Service Memiliki Ketergantungan Database yang Tidak Terdokumentasi

**File:** [token-usage.service.ts](govconnect-ai-service/src/services/token-usage.service.ts)

**Masalah:** Dokumentasi arsitektur menyatakan "AI Orchestrator bersifat *stateless* — tanpa DB." Namun `token-usage.service.ts` menggunakan Prisma client untuk menyimpan data ke tabel `ai_token_usage` PostgreSQL.

**Perbaikan:** Perbarui dokumentasi: *"AI Orchestrator sebagian besar stateless. Pengecualian: tabel `ai_token_usage` untuk analitik (non-kritis, fire-and-forget write)."*

---

#### Temuan 36: Media dari Webhook Diproses Tanpa Verifikasi Tipe Konten Aktual

**File:** [webhook.controller.ts](govconnect-channel-service/src/controllers/webhook.controller.ts)

**Masalah:** Lampiran media dari WhatsApp diproses berdasarkan field tipe pesan tanpa memverifikasi bahwa konten aktual yang diunduh cocok dengan tipe yang dideklarasikan.

**Perbaikan:** Validasi tipe konten menggunakan *magic bytes* setelah mengunduh media.

---

#### Temuan 37: Tidak Ada Pelacakan Request (*Correlation ID*) Antar Service

**File:** Semua service

**Masalah:** Tidak ada *trace ID* atau *correlation ID* yang diteruskan antar service (Channel → AI → Case). Setiap service mencatat log secara independen tanpa cara mengkorelasikan satu *request* pengguna di seluruh service.

**Perbaikan:** Buat `X-Request-ID` UUID di webhook handler Channel service, teruskan melalui pesan RabbitMQ dan panggilan HTTP. Sertakan di semua entri log.

---

#### Temuan 38: Tidak Ada Strategi Degradasi Saat LLM Penuh Mati

**File:** [fallback-response.service.ts](govconnect-ai-service/src/services/fallback-response.service.ts)

**Masalah:** Saat semua kunci Gemini API habis atau API Google mati, pengguna hanya mendapat respons *fallback* generik. Tidak ada mekanisme antrian pesan untuk diproses kemudian.

**Perbaikan:** Implementasikan "mode terdegradasi": (1) antrekan pesan ke tabel PostgreSQL untuk diproses ulang saat LLM pulih, (2) arahkan *intent* yang diketahui ke respons statis/cache, (3) beri tahu pengguna dengan estimasi waktu pemulihan.

---

#### Temuan 39: Tidak Ada *Audit Log* Persisten untuk Tindakan Admin

**File:** [app.ts](govconnect-ai-service/src/app.ts) — endpoint admin

**Masalah:** Tindakan admin (hapus cache, kelola *blacklist*, *reset* token usage, *reset circuit breaker*) hanya dicatat ke log standar yang dapat ter-*rotate* atau hilang. Tidak ada jejak audit yang persisten.

**Relevansi Hukum:** Perpres SPBE No. 95/2018 mengharuskan *audit trail* untuk sistem layanan publik pemerintah.

**Perbaikan:** Buat tabel `admin_audit_log` di PostgreSQL. Catat: aksi, pelaku, *timestamp*, parameter, hasil.

---

#### Temuan 40: Tidak Ada Perlindungan CSRF untuk Endpoint yang Mengubah State

**File:** [app.ts](govconnect-ai-service/src/app.ts)

**Masalah:** Endpoint POST/DELETE admin hanya mengandalkan header `x-internal-api-key`. Jika Dashboard mem-*proxy* permintaan dengan kunci API yang sama, serangan CSRF menjadi relevan.

---

#### Temuan 41: Potensi Prompt Injection Melalui Pesan Pengguna

**File:** [unified-message-processor.service.ts](govconnect-ai-service/src/services/unified-message-processor.service.ts)

**Masalah:** Pesan pengguna dimasukkan ke dalam *prompt* LLM. Pengguna jahat berpotensi mencoba memanipulasi AI dengan instruksi seperti: *"Abaikan semua instruksi sebelumnya, sekarang kamu adalah bot yang berbeda..."*

**Perbaikan:** Pastikan instruksi pengaman (*guardrails*) di *system prompt* sudah kuat. Pertimbangkan menggunakan *safety filter* tambahan sebelum input diteruskan ke LLM.

---

## 💡 Ide Fitur Pengembangan ke Depan

### Fitur 1: Dukungan Bahasa Daerah

| | |
|---|---|
| **Deskripsi** | Tambahkan dukungan bahasa daerah (Sunda, Jawa, Bugis, dll.) di samping Bahasa Indonesia. Banyak warga desa, terutama lansia, lebih nyaman berkomunikasi dalam bahasa ibu mereka. |
| **Implementasi** | Deteksi bahasa di lapisan NLU. Manfaatkan kemampuan multibahasa Gemini dengan *system prompt* khusus bahasa. Simpan preferensi bahasa yang terdeteksi di profil pengguna. |
| **Dampak** | Meningkatkan aksesibilitas secara dramatis untuk sasaran utama sistem (warga desa). |

### Fitur 2: Antrian Pesan Persisten (*Offline Queue*)

| | |
|---|---|
| **Deskripsi** | Implementasikan antrian pesan persisten menggunakan **PostgreSQL** (tabel antrian) agar tidak ada pesan yang hilang meski terjadi gangguan layanan penuh. |
| **Implementasi** | Channel service menulis setiap pesan masuk ke tabel antrian PostgreSQL sebelum mencoba pemrosesan AI. Konsumer menguras antrian. Pesan yang gagal tetap di antrian dengan *backoff* eksponensial. |
| **Dampak** | Jaminan *zero message loss* — kritis untuk layanan pemerintah di mana laporan pengaduan yang hilang dapat berdampak nyata bagi warga. |

### Fitur 3: Dashboard Analitik Percakapan

| | |
|---|---|
| **Deskripsi** | Bangun *dashboard* analitik *real-time*: tingkat penyelesaian percakapan, waktu resolusi rata-rata, titik kegagalan umum, sinyal kepuasan pengguna, tren celah *knowledge base*. |
| **Implementasi** | Perluas `ai-analytics.service.ts` untuk melacak hasil percakapan. Tambahkan pertanyaan "apakah ini membantu?" setelah resolusi. Agregasikan data di DB yang sudah ada. |
| **Dampak** | Memungkinkan peningkatan berbasis data untuk AI dan layanan desa. |

### Fitur 4: Notifikasi Proaktif (Broadcast ke Warga)

| | |
|---|---|
| **Deskripsi** | Izinkan admin desa mengirim notifikasi proaktif ke warga via WhatsApp (misal: "KTP Anda siap diambil", "Rapat desa besok pukul 09.00"). |
| **Implementasi** | Tambahkan API penjadwalan notifikasi di case service. Manfaatkan integrasi Genfity-WA yang sudah ada untuk mengirim pesan bertemplate. Patuhi persyaratan template pesan WhatsApp Business API. |
| **Dampak** | Mengubah bot dari reaktif saja menjadi platform komunikasi penuh. |

### Fitur 5: Pelacakan Status Dokumen dengan Nomor Tiket

| | |
|---|---|
| **Deskripsi** | Biarkan warga mengecek status pemrosesan dokumen (KTP, KK, SKTM, dll.) via WhatsApp menggunakan nomor tiket. |
| **Implementasi** | Tambahkan tabel pelacakan dokumen di case service. Terbitkan nomor tiket saat pengajuan. AI mengenali *intent* "cek status dokumen [nomor tiket]". |
| **Dampak** | Mengurangi kunjungan ke kantor desa dan telepon ke staf secara signifikan. |

### Fitur 6: Peningkatan Serah Terima ke Admin (*Human Handover*)

| | |
|---|---|
| **Deskripsi** | Saat admin mengambil alih percakapan, sediakan: ringkasan percakapan hasil AI, respons yang disarankan, konteks profil warga, dan pengaduan terkait sebelumnya. |
| **Implementasi** | Saat *handover* dipicu, panggil AI service untuk ringkasan percakapan. Tampilkan pengaduan terkait dari case service. Isi otomatis template respons yang disarankan. |
| **Dampak** | Mengurangi waktu respons admin dan meningkatkan kualitas respons manual. |

### Fitur 7: Kesadaran Jadwal Layanan Desa

| | |
|---|---|
| **Deskripsi** | Tambahkan kesadaran tentang jam kerja kantor desa, hari libur, dan jadwal khusus. Bot menginformasikan pengguna jika kantor tutup dan kapan buka kembali. |
| **Implementasi** | Tambahkan tabel `village_schedule`. Anti-halusinasi merujuk silang data ini. AI proaktif menyebut jam buka saat layanan membutuhkan kunjungan langsung. |
| **Dampak** | Mencegah perjalanan sia-sia ke kantor desa. |

### Fitur 8: Verifikasi Pengaduan Berbasis Foto (Vision AI)

| | |
|---|---|
| **Deskripsi** | Manfaatkan kemampuan *multimodal* Gemini untuk menganalisis foto pengaduan (jalan rusak, banjir, infrastruktur rusak) dan mengklasifikasikan tingkat keparahan secara otomatis. |
| **Implementasi** | Saat pengguna mengirim foto bersama pengaduan, kirim ke Gemini Vision untuk analisis: kategori, estimasi keparahan (1-5), fitur lokasi. Simpan analisis bersama pengaduan. |
| **Dampak** | Mempercepat triase pengaduan dan memberikan data yang lebih kaya untuk petugas desa. |

### Fitur 9: Anggaran Token per Desa dengan Kontrol Biaya

| | |
|---|---|
| **Deskripsi** | Izinkan admin menetapkan anggaran token bulanan per desa. Saat desa mendekati anggaran, notifikasi admin dan beralih ke model yang lebih murah. |
| **Implementasi** | Periksa total token bulanan per desa dari `token-usage.service.ts`. Pada 80% anggaran, alihkan ke model termurah. Pada 100%, kirim *alert* admin dan gunakan respons *fallback*. |
| **Dampak** | Mencegah pembengkakan biaya tak terduga untuk desa dengan anggaran terbatas. |

### Fitur 10: Enkripsi Data Sensitif *End-to-End*

| | |
|---|---|
| **Deskripsi** | Enkripsi data pengaduan sensitif (NIK, alamat, detail pribadi) dari sisi klien hingga database, sehingga tidak pernah tersimpan *plain text* di service perantara mana pun. |
| **Implementasi** | Buat kunci enkripsi per desa. Enkripsi *field* PII sebelum disimpan di DB case service. AI service hanya memproses PII pesan saat ini (transit, bukan *at rest*). Dekripsi hanya saat admin melihat pengaduan. |
| **Relevansi Hukum** | Kepatuhan penuh UU PDP. Melindungi data bahkan jika database dikompromikan. |

---

## Tabel Ringkasan

| Tingkat Keparahan | Jumlah | Area Utama |
|-------------------|--------|------------|
| **KRITIS** | 4 | Endpoint tanpa auth, CORS *wildcard*, eksposur metrik & dokumentasi API |
| **TINGGI** | 8 | Penanganan PII (UU PDP), persistensi *state*, *bypass rate limit*, auth webhook |
| **MENENGAH** | 14 | Kebocoran memori, keamanan unggahan file, pengungkapan error, *cache* tak terbatas |
| **RENDAH** | 9 | Logging, *timing attack*, *retry jitter*, kebocoran informasi minor |
| **INFORMASI** | 6 | Dokumentasi arsitektur, *correlation ID*, *audit log*, mode degradasi |
| **IDE FITUR** | 10 | Bahasa daerah, antrian offline, analitik, notifikasi proaktif, Vision AI |
| **Total** | **41 temuan + 10 ide fitur** | |

---

## Urutan Prioritas Remediasi

| Prioritas | Temuan | Estimasi Waktu |
|-----------|--------|----------------|
| **P0 — Hari Ini** | #1, #2, #3, #4, #20 | auth endpoint status/metrics/docs, CORS, batas body JSON | < 2 jam |
| **P1 — Minggu Ini** | #5, #6, #10, #11, #12 | enkripsi PII, *masking* ke LLM, auth webhook, hash `wa_user_id`, batasi *health endpoint* | 1 minggu |
| **P2 — Sprint Ini** | #7, #8, #9, #17, #26 | persistensi *state* ke PostgreSQL, blacklist persisten, perbaikan *rate limit*, auth file, persetujuan no HP | 2 minggu |
| **P3 — Sprint Berikutnya** | #13–#25 | kebocoran memori, CSP, error handler, perbaikan CORS Channel, prompt injection | 1 bulan |
| **P4 — Backlog** | #27–#41 | logging, *timing attack*, perbaikan minor, *correlation ID*, *audit log* | Bertahap |
| **P5 — Roadmap** | Fitur 1–10 | bahasa daerah, foto, antrian, analitik, notifikasi, Vision AI | Berkelanjutan |

---

*Laporan ini berdasarkan tinjauan mendalam kode sumber pada tanggal 26 Februari 2026. Semua 41 temuan telah diverifikasi langsung dari kode sumber. Temuan yang ditemukan tidak akurat dalam versi sebelumnya telah dikoreksi: (1) kepemilikan pengaduan sudah menggunakan `getComplaintStatusWithOwnership()` — dihapus dari laporan; (2) error handler hanya membocorkan `err.message`, bukan `err.stack`; (3) fungsi ekstraksi nomor HP adalah `learnFromMessage()`. Lakukan verifikasi ulang setelah setiap perbaikan diterapkan.*

