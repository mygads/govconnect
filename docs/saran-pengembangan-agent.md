# Backlog Pengembangan GovConnect Agent (Belum Diimplementasikan)

Tanggal update: 2026-04-24

Dokumen ini hanya memuat pekerjaan yang **masih tersisa**. Item yang sudah selesai implementasi dan sudah lolos verifikasi test telah dihapus dari daftar ini.

## Prioritas 1 — Governance, Security, dan Auditability

### 1) Policy engine eksplisit per intent family
- Definisikan capability policy terstruktur per keluarga intent.
- Bedakan eligibility untuk informative/retrieval/state-mutating/sensitive tools.
- Simpan alasan pemilihan tool agar mudah diaudit.

### 2) Governance formal lintas layanan
- Data classification: publik, internal, pribadi, sensitif.
- Purpose limitation: data warga hanya dipakai untuk kebutuhan layanan relevan.
- Access control berbasis role.
- Audit trail aksi sensitif (status change, handoff, cancel/edit penting).
- Retention & deletion policy formal.
- Consent/notice warga terkait pemrosesan data.
- Incident response untuk salah kirim, kebocoran, dan respons AI sensitif.

### 3) PII & compliance hardening lanjutan
- Register field PII per service.
- Dokumen data-flow lintas service.
- Correlation ID lintas service untuk investigasi insiden.
- Review minimisasi data sensitif di prompt/log secara berkala.

---

## Prioritas 2 — Arsitektur State/Memory dan Maintainability

### 1) Unifikasi state & memory ke 4 lapisan
1. Conversation State
2. User Profile Memory
3. Case Memory
4. Operational State

Target:
- Boundary antar lapisan jelas.
- Continuity lebih konsisten.
- Seleksi context untuk prompt lebih hemat dan deterministik.

### 2) Rapikan boundary pre-agent router, tool executor, dan handler
- Business logic utama dipusatkan di domain service/handler.
- Tool executor jadi adapter agent-facing.
- Pre-agent router fokus policy/routing, bukan menumpuk logic bisnis.

---

## Prioritas 3 — Observability Biaya & Kualitas

### 1) Cost observability per tenant/flow
- Dashboard biaya per desa.
- Biaya per intent family.
- Rerank usage rate.
- Fallback/degraded rate saat model utama gagal.

### 2) Incident & quality dashboard
- Handoff rate.
- Unresolved conversations.
- Low-confidence retrieval rate.
- Repeated citizen frustration.
- Model fallback frequency.

### 3) Evaluation service/regression harness berkelanjutan
- Citizen message suites.
- Local-language/noisy text suites.
- Ambiguity suites.
- Hallucination/safety suites.
- Complaint/service operational suites.

---

## Prioritas 4 — Multi-tenant Village Adaptability

### 1) Village behavior configuration layer
- Daftar layanan aktif per desa.
- Kontak penting per desa.
- Jam layanan per desa.
- Prioritas FAQ lokal.
- Escalation routing lokal.
- Rules pengaduan/layanan khas desa.

Target:
- Agent benar-benar village-aware secara perilaku, bukan hanya tenant-filtered data.

---

## Prioritas 5 — Human Handoff Enrichment

### 1) Enrichment context untuk petugas saat takeover
Saat handoff, petugas menerima ringkasan:
- intent warga,
- ringkas percakapan terakhir,
- status aktif,
- nomor layanan/laporan terkait,
- alasan escalation.

---

## Rencana eksekusi yang disarankan

### Fase B (berikutnya)
1. Unifikasi state/memory architecture.
2. Policy engine tool eligibility.
3. Correlation ID lintas service.
4. Dashboard biaya per flow.

### Fase C (setelah stabil)
1. Village behavior config layer.
2. Evaluation service yang rutin.
3. Incident & quality dashboard.
4. Human handoff enrichment.
5. Governance/compliance formal penuh.
