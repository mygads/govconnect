# GovConnect Copilot Instructions

Dokumen ini mengarahkan GitHub Copilot agar konsisten dengan kebutuhan GovConnect.

## ✅ Bahasa & Nada
- Gunakan **Bahasa Indonesia** yang profesional dan jelas.
- Hindari istilah ambigu; jelaskan tujuan dan dampak perubahan.
- Utamakan kejelasan arsitektur, batasan data, dan alur integrasi.

## ✅ Aturan Umum
- Ikuti arsitektur **5 service** dan prinsip **1 service = 1 database**.
- **AI Orchestrator stateless** (tidak boleh simpan data di DB AI atau memory session persisten).
- **Chat history hanya di Channel Service** (FIFO 30 pesan, pakai `channel` + `channel_identifier`).
- Jangan mengubah konfigurasi model AI di UI; hanya lewat **ENV**.
- Jangan mengakses DB antar service secara langsung; gunakan REST/RabbitMQ.
- Selalu jaga naming convention yang sudah ada (kebab-case file, camelCase function, PascalCase class).

## ✅ Arsitektur Sistem (Wajib Dipatuhi)
**Service & Tanggung Jawab:**
1. **Channel Service**: WA webhook, chat history, outbound message, channel settings & session WA (1 nomor WA per desa).
2. **AI Orchestrator**: intent + flow logic, stateless, panggil data via REST.
3. **Case Service**: layanan & pengaduan (CRUD + status + history + media penanganan).
4. **Notification Service**: kirim pesan keluar, log status.
5. **Dashboard (Next.js)**: admin UI + public form, profil desa, knowledge base, nomor penting.

**Database per Service:**
- gc_channel (messages, send_logs, channel_accounts)
- gc_case (service_* dan complaint_*)
- gc_notification (notification_logs)
- gc_dashboard (admin_users, villages, knowledge_*)
- AI Orchestrator: **tidak ada DB**

**Komunikasi:**
- Synchronous: REST API antar service
- Asynchronous: RabbitMQ events

**Aturan Ketat:**
- Dilarang akses DB lintas service.
- History chat hanya di Channel Service (maks 30 pesan/user).
- Perubahan AI model hanya via ENV.

## ✅ Scope Tenant & Registrasi
- Saat ini **hanya desa/kelurahan** (1 akun = 1 desa).
- Form register harus **1 pilihan default** (terkunci).
- Siapkan struktur data untuk **future kecamatan** (bisa menautkan banyak desa).

## ✅ Data Ownership & Batasan
- **Profil desa + knowledge base + nomor penting** disimpan di **Dashboard DB**.
- **Layanan & pengaduan** disimpan di **Case Service DB**.
- **Chat history** hanya di **Channel Service DB**.
- **AI Orchestrator** tidak menyimpan data.

## ✅ Alur Pesan (WA/Webchat)
- **Inbound WA**: WhatsApp → Channel Service → RabbitMQ → AI Orchestrator → (REST Case/Dashboard) → RabbitMQ → Notification → Channel Service → WhatsApp.
- **Webchat**: Webchat → AI Orchestrator (sync) → (REST Case/Dashboard) → Response langsung.
- **Takeover**: saat takeover aktif, AI **tidak** memproses pesan.

## ✅ FIFO 30 Pesan
- Simpan IN/OUT messages.
- Hapus pesan tertua jika > 30.
- Query history: order by timestamp desc limit 30.

## ✅ AI Structured Output (Wajib)
AI wajib mengembalikan JSON valid sesuai schema:
```
{
	"intent": "CREATE_COMPLAINT|SERVICE_INFO|CREATE_SERVICE_REQUEST|CHECK_STATUS|HISTORY|KNOWLEDGE_QUERY|QUESTION|UNKNOWN",
	"fields": {
		"kategori": "...",
		"alamat": "...",
		"deskripsi": "...",
		"rt_rw": "...",
		"service_id": "...",
		"request_number": "...",
		"complaint_id": "..."
	},
	"reply_text": "..."
}
```
- Jangan tambahkan teks di luar JSON.

## ✅ Knowledge Base
- Kategori default: Profil Desa, FAQ, Struktur Desa, Data RT/RW, Layanan Administrasi, Panduan/SOP.
- Admin bisa tambah kategori custom.
- Profil Desa berupa input teks (nama, alamat, gmaps_url, short_name, jam operasional per hari).
- File KB: **PDF/DOC/DOCX/TXT**.

## ✅ Nomor Penting
- Struktur: kategori → banyak nomor.
- Dapat dihubungkan ke jenis pengaduan urgent.

## ✅ Channel Settings
- 1 desa ↔ 1 nomor WA.
- Session WA dikelola otomatis (admin klik **Buat Session** → token tersimpan di DB internal → tampil QR).
- Nomor WA & status koneksi ditampilkan di dashboard (tanpa input token manual).
- Field (read-only): `wa_number`, `webhook_url`.
- Toggle `enabled_wa` / `enabled_webchat` mematikan/menyalakan AI di channel terkait.

## ✅ Layanan (Service Catalog)
- Kategori layanan → banyak layanan.
- Layanan punya deskripsi, slug, mode (online|offline|both).
- Persyaratan dinamis: file/text/textarea/select/radio/date/number.
- Form publik: `govconnect.my.id/form/{slug-desa}/{slug-layanan}`.
- Prefill WA via `?wa=628xxx`.
- Prefill Webchat via `?session=web_xxx`.

## ✅ Pengaduan
- Kategori → banyak jenis.
- Setiap jenis bisa **urgent**, **require_address**, dan **nomor penting terkait**.
- Jika require_address dan alamat kosong → AI wajib minta alamat.
- Urgent memunculkan alert di dashboard dan bisa kirim nomor penting ke warga.
- Admin bisa mengirim **update penanganan** berupa teks dan foto.
- Pengaduan **tidak** menggunakan form publik (hanya via WA/Webchat).

## ✅ Status & Riwayat
- Layanan dan pengaduan memiliki **nomor** (mis: LAY-YYYYMMDD-XXX, LAP-YYYYMMDD-XXX).
- Warga bisa cek status dan riwayat via WA.

## ✅ Halaman UI (Wajib Bahasa Indonesia)
- Auth: Login/Register (desa locked)
- Profil Desa
- Knowledge Base + Upload Dokumen
- Nomor Penting
- Channel Connect
- Testing Knowledge
- Layanan (kategori, layanan, persyaratan)
- Daftar Pelayanan (list, detail, status)
- Pengaduan (list, detail, update + foto)
- Live Chat & Takeover
- Super Admin: daftar desa, analytics global, **AI analytics**, setting sistem

## ✅ Keamanan & Validasi
- Internal API menggunakan `X-Internal-API-Key`.
- Validasi input (format nomor WA, file type/size, required fields).
- Webhook WA wajib idempotent (cek `message_id`).

## ✅ Dokumentasi yang Wajib Diupdate
- docs/01_OVERVIEW.md
- docs/02_ARCHITECTURE.md
- docs/04_BUSINESS_FLOW.md
- docs/05_RESERVATION_SYSTEM.md
- docs/API-DOCUMENTATION.md
- docs/07_EAI_MAPPING.md

## ✅ Perubahan Fitur (Checklist Wajib)
Saat mengubah fitur besar, pastikan:
- Update dokumentasi arsitektur & business flow.
- Update API docs (v2) dan contoh payload.
- Update skema DB + migration plan.
- Validasi dampak ke event RabbitMQ.
- Perbarui UI/UX sesuai Bahasa Indonesia.

## ✅ Architecture Decision Record (ADR)
Wajib membuat ADR untuk perubahan besar.

**Format minimal ADR:**
- Judul keputusan
- Status (Proposed/Accepted/Deprecated)
- Konteks
- Keputusan
- Konsekuensi

Simpan di: `docs/adr/ADR-YYYYMMDD-judul-singkat.md`.

## ✅ Checklist Release & QA
Wajib menambahkan checklist ini saat fitur besar dirilis:

**Release Checklist:**
- [ ] Migrasi DB siap dijalankan
- [ ] API docs diperbarui
- [ ] Event queue terdaftar
- [ ] Feature flag/toggle sesuai kebutuhan
- [ ] Monitoring & logging aktif

**QA Checklist:**
- [ ] Unit test lulus
- [ ] Integration test (AI → Case → Notification)
- [ ] Flow WA & Webchat tervalidasi
- [ ] Form publik tervalidasi
- [ ] Uji error handling + fallback

## ✅ Respons Akhir Wajib
Setiap kali tugas selesai, **wajib** menambahkan dua bagian di akhir jawaban:

### Rekomendasi Selanjutnya
- Berisi langkah praktis yang bisa dikerjakan berikutnya.

### Future Improvements
- Berisi saran peningkatan jangka menengah/panjang.

Gunakan format bullet list singkat agar mudah dibaca.

## ✅ Contoh Format Akhir
Rekomendasi Selanjutnya:
- ...
- ...

Future Improvements:
- ...
- ...
