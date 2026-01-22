# GovConnect - Platform Layanan Pemerintah Desa/Kelurahan

## 📋 Deskripsi Singkat
GovConnect adalah platform layanan desa/kelurahan berbasis WhatsApp dan web yang memudahkan warga mendapatkan informasi, mengajukan layanan administrasi, serta membuat pengaduan/keluhan. Sistem ini memakai arsitektur microservices dengan AI orchestration agar jawaban cepat, konsisten, dan dapat menuntun warga sampai proses layanan selesai.

## 🎯 Scope Saat Ini
- **Create user hanya tingkat desa/kelurahan** (paling bawah). Pada form registrasi hanya ada **1 pilihan default** yang dikunci.
- **Roadmap berikutnya**: user tingkat kecamatan dapat menautkan banyak desa dalam satu akun.

## ✅ Fitur Utama (Redesain)

### 1) Knowledge Base Desa
- **Kategori dasar otomatis**: Profil Desa, FAQ, Struktur Desa, Data RT/RW, Layanan Administrasi, Panduan/SOP.
- **Kategori custom**: admin bebas menambah kategori baru (misalnya “Layanan KTP”).
- **Input file**: PDF, DOC/DOCX, TXT.
- **Input text** (Profil Desa): nama desa, alamat, lokasi Google Maps, nama singkat (untuk URL form), jam buka per hari + jam operasional.
- Profil desa otomatis disinkronkan ke **knowledge base terpadu** untuk AI.
- **Scope per desa**: konten, kategori, dan dokumen hanya terlihat di desa terkait.

### 2) Knowledge Base Nomor Penting
- **Kategori → banyak nomor** (contoh: Polisi → Pak Joko, Pak Jaya).
- AI dapat menampilkan nomor penting saat kasus urgent.

### 3) Channel Connect (WhatsApp + Webchat)
- Setiap akun desa **terhubung ke 1 nomor WhatsApp**.
- **Session WhatsApp dikelola otomatis**: admin klik **Buat Session**, sistem menyimpan token di DB internal, lalu menampilkan **QR** untuk login.
- Jika session sudah ada, admin cukup **konek QR** tanpa membuat session baru.
- Nomor WA & status koneksi ditampilkan otomatis di dashboard.
- **Webchat Widget** dapat di-embed ke website desa (toggle on/off).
- **Channel toggle**: admin dapat menyalakan/mematikan AI di WA dan Webchat.

### 4) Testing Knowledge (Demo)
- Halaman uji coba respons AI sebelum launch dengan filter kategori dan sumber data.

### 5) Layanan Administrasi (Service Catalog)
- Admin membuat **kategori layanan** → **banyak layanan**.
- Setiap layanan punya deskripsi, kategori, dan **persyaratan dinamis**:
    - Input file (upload)
    - Input text/textarea
    - Select/radio/date/number
- **Mode layanan**: online, ambil di kantor, atau keduanya.
- Public form: `govconnect.my.id/form/{slug-desa}/{slug-layanan}`.
- WA user otomatis terisi lewat query `?user=628xxx`.
- Pengisian layanan **hanya via form web**; edit data via link bertoken.

### 6) Pengaduan / Pelaporan
- Admin membuat **kategori** dan **jenis** laporan.
- Setiap jenis punya opsi:
    - **Urgent** (trigger alert dashboard)
    - **Butuh alamat** (AI wajib minta alamat)
    - **Nomor penting terkait** (opsional untuk dikirim ke warga)

### 7) Status & Riwayat
- Warga dapat cek **status layanan** dan **riwayat** via WhatsApp.
- Untuk layanan berbasis form, warga mendapat **nomor layanan** setelah submit.

### 8) Super Admin
- Memantau semua desa, melihat analytics global, dan setting sistem.
- Pengaturan model AI **hanya lewat ENV**, tidak ada menu ubah model di dashboard.

---

## 🧱 Arsitektur Tingkat Tinggi
Tetap memakai **5 services**:
1. **Channel Service** – Webhook WA, webchat message, history 30 pesan
2. **AI Orchestrator** – stateless, intent + flow logic
3. **Case Service** – layanan, pengaduan, status, riwayat
4. **Notification Service** – pengiriman pesan keluar
5. **Dashboard (Next.js)** – admin UI + public form

---

## 🧭 Dokumen Terkait
- [02_ARCHITECTURE.md](./02_ARCHITECTURE.md) – Arsitektur detail
- [03_DEV_PLAN.md](./03_DEV_PLAN.md) – Rencana pengembangan
- [04_BUSINESS_FLOW.md](./04_BUSINESS_FLOW.md) – Business flow
- [05_SERVICE_REQUEST_SYSTEM.md](./05_SERVICE_REQUEST_SYSTEM.md) – Layanan & Form
- [07_EAI_MAPPING.md](./07_EAI_MAPPING.md) – Mapping EAI
- [API-DOCUMENTATION.md](./API-DOCUMENTATION.md) – API reference
