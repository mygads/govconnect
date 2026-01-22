# Dev Plan - Redesain GovConnect

Dokumen ini menjadi rencana pengembangan setelah perubahan besar fitur. Fokusnya menyesuaikan arsitektur, API, dan skema data agar sesuai kebutuhan desa/kelurahan.

## 0) Prinsip Dasar
- **Single-tenant dulu**: hanya 1 desa per akun, pilihan di registrasi dikunci.
- **Future-proof**: siapkan struktur data agar kecamatan bisa menautkan banyak desa.
- **AI service stateless**: tidak punya database, semua data disediakan via API service lain.
- **Database per service**: tetap dipertahankan.

---

## 1) Phase 1 — Pondasi Tenant & Channel
**Goal:** identitas desa + koneksi WhatsApp/Webchat stabil.

**Deliverables:**
- Model data Desa (slug, nama, alamat, status aktif).
- Role **super admin** untuk monitoring seluruh desa.
- Dashboard: halaman **Register Desa**, **Profil Desa**, **Channel Settings**.
- Channel Service: tabel **channel_account** (token, wa_number, webhook_url, enabled_wa, enabled_webchat).
- API:
  - Dashboard → Channel Service: konfigurasi WA + toggle channel.
  - Channel Service → AI: event selalu bawa `village_id`.

**Acceptance:**
- Admin dapat menyimpan konfigurasi WA dan melihat webhook URL.
- Toggle WA/Webchat berdampak pada routing pesan.

---

## 2) Phase 2 — Knowledge Base Terpadu
**Goal:** KB file + KB teks (profil desa) + nomor penting.

**Deliverables:**
- Dashboard DB: kategori KB, dokumen, chunks/embedding, profil desa, jam buka, nomor penting.
- Upload file: PDF/DOC/DOCX/TXT.
- Input profil desa (teks terstruktur) masuk KB.
- API pencarian KB untuk AI (vector search di Dashboard).

**Acceptance:**
- AI dapat menjawab pertanyaan dari file + profil desa.
- Admin bisa menambah kategori custom.

---

## 3) Phase 3 — Layanan & Form Publik
**Goal:** layanan administrasi dengan form publik dan tracking status.

**Deliverables:**
- Case Service DB: service_category, service, service_requirement, service_request.
- Dashboard: CRUD kategori & layanan + builder persyaratan.
- Public form: `/{form}/{slug-desa}/{slug-layanan}` (Next.js public route).
- Auto prefill WA dari query `?user=628xxx`.
- Status & history di WhatsApp + web.

**Acceptance:**
- Form publik bisa submit dan menghasilkan nomor layanan.
- Status bisa dicek lewat WA dan halaman web.

---

## 4) Phase 4 — Pengaduan & Laporan
**Goal:** pengaduan cepat via WA dengan kategori/jenis dan penanda urgent.

**Deliverables:**
- Case Service DB: complaint_category, complaint_type, complaint.
- Aturan jenis: `is_urgent`, `require_address`, `important_contact_ids`.
- Dashboard: CRUD kategori/jenis + alert urgent.
- AI flow: tanya alamat jika wajib, kirim nomor penting bila urgent.

**Acceptance:**
- Laporan urgent memunculkan alert.
- Warga mendapat respons dengan nomor penting sesuai kategori.

---

## 5) Phase 5 — Quality, Observability, & Security
**Goal:** stabil dan siap production.

**Deliverables:**
- Rate limit & abuse protection di Channel Service.
- Audit log di Dashboard untuk aktivitas admin.
- Monitoring & tracing untuk event RabbitMQ.
- Backup/restore KB & layanan.

---

## 6) Future (Kecamatan)
- Model `SubDistrict` menautkan banyak `Village`.
- Multi-admin scope untuk kecamatan.
- Cross-village analytics.
