---
description: Buat PRD testing lengkap GovConnect untuk 2 session testing paralel
---

Baca skill `govconnect-testing` dan `govconnect-api-testing` terlebih dahulu.

Tugasmu adalah membuat dokumen PRD testing lengkap di `docs/testing/TESTING-PRD.md`.

PRD ini akan dipakai oleh 2 session Kilo yang berjalan paralel untuk testing GovConnect.

## Yang harus ada di PRD

1. **Daftar semua test case** dengan format:
   - TC-001, TC-002, dst (nomor urut)
   - Judul test case
   - Scope: superadmin / village_admin / public / ai-agent / webhook
   - Service yang terlibat
   - Langkah-langkah testing
   - Expected result
   - Session yang mengerjakan (ganjil = session-1, genap = session-2)

2. **Cakupan testing harus mencakup**:
   - Auth: login superadmin, login village admin, token invalid, logout
   - Superadmin: CRUD village, CRUD village admin, system health, AI wallets, LLM check, providers
   - Village admin: CRUD kategori pengaduan, CRUD jenis pengaduan (termasuk urgent, require_address, auto-send kontak)
   - Village admin: CRUD layanan, CRUD kategori layanan, CRUD persyaratan layanan
   - Village admin: CRUD nomor penting, CRUD kategori nomor penting
   - Village admin: CRUD knowledge base, cek konsistensi KB
   - Laporan/complaint: buat via AI (WhatsApp webhook), list, detail, update status, soft delete, restore
   - Laporan urgent: pastikan is_urgent dari DB complaint type, bukan dari request
   - Auto-send nomor penting: buat laporan dengan type yang punya send_important_contacts=true
   - Service request: buat via public form, list, detail, update status, history
   - AI agent: tanya info layanan, tanya nomor penting, buat laporan, cek status laporan, batalkan laporan
   - AI agent: tanya hal di luar scope, tanya nomor yang tidak ada di DB, mixed intent
   - Webchat: kirim pesan, poll response, clear session
   - Public forms: submit pengaduan, cek status pengaduan, submit service request
   - Multi-desa isolation: pastikan data desa A tidak bocor ke desa B
   - Notification: cek delivery tracking, cek urgent alert config
   - Dashboard UI: login, navigasi, CRUD via UI, realtime update

3. **Format checklist** di akhir PRD:
   ```
   - [ ] TC-001: ... (session-1)
   - [ ] TC-002: ... (session-2)
   ```

4. **Pembagian session**:
   - Session 1: TC ganjil (TC-001, TC-003, TC-005, ...)
   - Session 2: TC genap (TC-002, TC-004, TC-006, ...)

Buat minimal 40 test case yang komprehensif dan realistis berdasarkan kode yang ada.

Setelah PRD selesai, buat juga file kosong `docs/testing/TESTING-STATUS.md` dengan header dan checklist awal dari semua TC.

Pastikan direktori `docs/testing/` ada sebelum menulis file.
