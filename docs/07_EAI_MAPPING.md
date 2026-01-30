# Mapping GovConnect ke Requirement EAI (Redesain)

Dokumen ini menambahkan mapping terbaru sesuai perubahan fitur desa/kelurahan. Bagian lama di bawah ditandai sebagai legacy.

---

## ✅ Ringkasan Requirement
- **Microservices**: 5 services (Channel, AI, Case, Notification, Dashboard)
- **DB per service**: 4 DB utama (AI stateless)
- **Synchronous**: REST API antar service
- **Asynchronous**: RabbitMQ event
- **Docker**: tiap service containerized
- **Status seragam**: OPEN, PROCESS, DONE, CANCELED, REJECT

---

## ✅ Update Komponen Baru
1. **Knowledge Base Terpadu** (Dashboard DB)
2. **Layanan Dinamis & Form Publik** (Case Service)
3. **Pengaduan Urgent + Nomor Penting**
4. **Channel Connect WA + Webchat Toggle**
5. **Super Admin** untuk monitoring sistem
6. **Uji Pengetahuan (Testing Knowledge)** untuk validasi RAG sebelum produksi
7. **RAG Scoped per Desa** (filter `village_id` di retrieval)
8. **Profil Desa → Knowledge Base** (sinkron otomatis saat update)
9. **Edit/Batal Layanan via WA** (token & konfirmasi)
10. **Evaluasi Golden Set** untuk mengukur kualitas jawaban LLM

---

## 🔄 Event & Integrasi
- `whatsapp.message.received` → AI Orchestrator
- `govconnect.ai.reply` → Notification Service
- `govconnect.complaint.created` → Notification Service
- `govconnect.service.requested` → Notification Service

---

## 🔐 Role & Akses
- Desa Admin: kelola data desa
- Super Admin: monitor semua desa + jalankan evaluasi golden set
