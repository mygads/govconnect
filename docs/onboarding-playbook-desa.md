# Playbook Onboarding Desa — GovConnect WhatsApp AI

Dokumen operasional untuk tim implementasi saat mengaktifkan layanan di desa
baru. Urutan bersifat sekuensial: jangan lanjut ke fase berikut sebelum
exit criteria fase berjalan terpenuhi.

Konvensi: `TENANT=<village_id>` dipakai di semua contoh.

---

## Fase 0 — Pra-syarat administratif (H-14 s/d H-7)

1. **SK Kepala Desa** — penunjukan operator/admin aplikasi + penanggung jawab
   tindak lanjut laporan (minimal 1 orang perangkat desa yang memantau tiket
   tiap hari kerja). Tanpa penanggung jawab yang jelas, JANGAN go-live:
   seluruh pesan fallback/karantina berjanji "petugas desa akan
   menindaklanjuti".
2. **Nomor WhatsApp resmi desa** — nomor khusus layanan (bukan nomor pribadi
   perangkat). Daftarkan ke provider WhatsApp (Genfity) dan catat
   `channel`/`sender id`-nya.
3. **Persetujuan biaya** — Musdes/RKPDesa/APBDes untuk langganan tahunan.
   Sampaikan estimasi biaya WhatsApp (cek dokumen resmi Meta terbaru —
   JANGAN pakai angka lama) + biaya AI per turn (±$0,001–0,004/turn;
   budget guard default $5/tenant/24 jam, dapat diubah per desa).
4. **Kebijakan retensi data** — sepakati dengan desa: berapa lama tiket,
   transkrip, dan file warga disimpan; kapan foto KTP dihapus setelah
   verifikasi. Tuangkan dalam berita acara (kebutuhan UU PDP).

**Exit:** SK terbit, nomor WA resmi aktif, penanggung jawab tertulis.

---

## Fase 1 — Provisioning tenant (H-7)

1. Buat `village_id` baru (format: slug, mis. `desa-sukamaju`).
2. Jalankan migration: `pnpm db:migrate:deploy` (TIDAK PERNAH `db:migrate`
   di production).
3. Isi konfigurasi desa (18 settings desa — lihat arsitektur §settings):
   - `PIPELINE_MODE=shadow` (WAJIB mulai dari shadow, bukan `on`)
   - `WA_COST_SAVER_MODE=true` (1 pesan/turn; hemat biaya WA)
   - `LAPOR_ENABLED=false` (aktifkan setelah Fase 4 bila desa meminta
     penerusan ke SP4N-LAPOR!)
   - `CSAT_ENABLED=false` (aktifkan setelah go-live stabil)
   - Budget harian per desa (default $5/24 jam)
   - `VILLAGE_KILL_SWITCH` — kosongkan; isi hanya saat darurat
4. Daftarkan nomor WA desa di channel-service dan verifikasi webhook
   menerima pesan (kirim pesan tes → terlihat di log ingress).
5. Verifikasi tenant isolation: kirim pesan dari 2 nomor berbeda, pastikan
   profil/tiket tidak tercampur (key profil = `(village_id, wa_user_id)`).

**Exit:** tenant terdaftar, `PIPELINE_MODE=shadow`, pesan tes masuk log.

---

## Fase 2 — Import data layanan (H-6 s/d H-4)

Data layanan desa adalah **data otoritatif** (DB-first): jenis surat,
syarat dokumen, tarif/PNBP, jam pelayanan, kontak perangkat, jadwal.

1. Kumpulkan dari perangkat desa dalam bentuk tabel (CSV/Sheets):
   `layanan | syarat_dokumen | tarif | estimasi_waktu | penanggung_jawab`.
2. Masukkan via dashboard admin / API case-service. JANGAN via upload
   dokumen bebas — KB upload router akan me-REJECT data otoritatif yang
   masuk lewat jalur dokumen (aturan: jam/tarif/kontak TIDAK BOLEH hidup
   di dokumen RAG).
3. Uji jalur CEK_STATUS dan INFORMASI dengan 5 pertanyaan nyata
   ("berapa biaya KTP?", "syarat SKTM?") — jawaban HARUS dari DB, bukan
   karangan model. Jika jawaban tidak dari DB → investigasi sebelum lanjut.

**Exit:** ≥20 layanan terdaftar; 5/5 uji tanya-jawab jawabannya sesuai DB.

---

## Fase 3 — Bootstrap knowledge base (H-4 s/d H-2)

1. Upload dokumen desa (Perdes, SOP, pengumuman) lewat jalur upload —
   router mengklasifikasikan `rag | skill | both | rejected`.
2. Untuk prosedur baku yang sering ditanya (alur surat, syarat), tulis
   `SKILL.md` di direktori skill desa (lihat `skill-loader.ts`) —
   progressive disclosure, bukan dump teks.
3. Generate **canary docs** (lihat `canary-docs.ts`): 2–3 dokumen canary
   per desa dengan token unik. Ini jebakan: jika token canary muncul di
   jawaban bot, berarti ada kebocoran retrieval.
4. Verifikasi precedence: buat dokumen yang isinya BERTENTANGAN dengan DB
   (mis. tarif salah di dokumen) → tanyakan ke bot → jawaban HARUS ikut DB
   (P0 precedence). Jika ikut dokumen → STOP, perbaiki sebelum lanjut.

**Exit:** KB terisi; uji precedence P0 lolos; canary docs terpasang.

---

## Fase 4 — Training admin & perangkat desa (H-2)

Materi (2 jam, di balai desa):

1. **Cara kerja**: warga chat → bot jawab/buatkan tiket → tiket masuk
   dashboard → perangkat tindak lanjuti → warga dapat notifikasi status.
2. **Dashboard**: cara buka tiket, ubah status, lihat tiket fallback
   (`TMP-*`) dan karantina — dua antrean ini WAJIB dicek tiap hari karena
   bot berjanji "petugas desa akan menindaklanjuti".
3. **Takeover**: saat perangkat mengambil alih percakapan (bot diam selama
   TTL takeover).
4. **Darurat**: cara isi `VILLAGE_KILL_SWITCH` (bot jadi mode fallback
   total) dan cara hubungi tim teknis.
5. **Larangan**: jangan pernah meminta warga mengirim foto KTP via chat
   pribadi perangkat; jangan menjanjikan verifikasi NIK via "API Dukcapil"
   (tidak ada jalur publik semacam itu).

**Exit:** minimal 2 orang lulus simulasi (buat tiket → tindak lanjuti →
tutup tiket).

---

## Fase 5 — Shadow mode (H-1 s/d H+7)

`PIPELINE_MODE=shadow`: bot memproses pesan paralel dengan operator manual,
**tidak mengirim balasan ke warga** dan tidak menulis state produksi.

1. Pantau metrik shadow per hari: % jawaban bot yang disetujui operator,
   kategori intent yang salah, slot yang gagal terekstrak.
2. Target go-live: ≥85% jawaban setara/meniru operator selama 3 hari
   berturut-turut, dan 0 kebocoran PII di jawaban.
3. Setiap kegagalan → catat sebagai improvement proposal (tabel
   `pipeline_improvement_proposals`); TIDAK ada auto-promote — semua
   perubahan KB/setting lewat approval admin.

**Exit:** target 85% tercapai 3 hari berturut-turut; proposal perbaikan
kritis sudah di-approve dan diterapkan.

---

## Fase 6 — Go-live checklist (H+0)

Jalankan berurutan, centang satu per satu:

- [ ] `PIPELINE_MODE=on` untuk tenant desa ini SAJA via override per tenant
      (`PIPELINE_TENANT_OVERRIDES='{"<tenant_id>":"on"}'` — jangan ubah
      `PIPELINE_MODE` global jika multi-desa satu deploy)
- [ ] Kirim pesan uji end-to-end dari nomor warga: sapaan → buat laporan
      (tombol "Benar, kirim") → tiket tercipta → cek status → tutup
- [ ] Verifikasi typing indicator muncul (bukan pesan filler)
- [ ] Verifikasi hanya 1 pesan per turn (`WA_COST_SAVER_MODE=true`)
- [ ] CSAT: aktifkan `CSAT_ENABLED=true` setelah 3 hari stabil
- [ ] LAPOR!: aktifkan `LAPOR_ENABLED=true` hanya jika desa meminta dan
      kredensial API produksi sudah terverifikasi (JANGAN klaim integrasi
      sebelum API-nya terbukti)
- [ ] Nomor darurat tim teknis ditempel di dashboard desa

**Rollback:** jika dalam 24 jam pertama >10% turn gagal atau ada kebocoran
PII → isi `VILLAGE_KILL_SWITCH` dengan village_id desa tersebut, lalu
investigasi. Kill switch memaksa fallback deterministik (bot tetap
menjawab, tidak diam).

---

## Fase 7 — Review 30 hari (H+30)

1. Generate **monthly report** (`monthly-report.ts` → Markdown/JSON):
   volume percakapan, % resolved, biaya AI aktual vs budget, CSAT,
   tiket fallback, karantina.
2. Review bersama perangkat desa: 3 keluhan warga terbanyak, 3 jawaban
   bot terburuk → jadikan improvement proposal.
3. Cek retensi: hapus file KTP/media yang sudah melewati masa retensi
   sesuai berita acara Fase 0.
4. Keputusan: lanjut langganan tahun berikutnya / perluasan ke dusun /
   penyesuaian budget.

---

## Lampiran: env flags per fase

| Flag | Shadow | Go-live | Keterangan |
|---|---|---|---|
| `PIPELINE_MODE` (+ `PIPELINE_TENANT_OVERRIDES` JSON untuk per tenant) | `shadow` | `on` | global, override per tenant |
| `WA_COST_SAVER_MODE` | `true` | `true` | 1 pesan/turn |
| `LAPOR_ENABLED` | `false` | opsional | butuh API terverifikasi |
| `CSAT_ENABLED` | `false` | `true` (H+3) | survei 1–5 |
| `VILLAGE_KILL_SWITCH` | kosong | kosong | darurat saja |
| `LOCAL_EMBEDDING` | `false` | opsional | self-host, bila tersedia |
| `WHISPER_ENABLED` | `false` | opsional | butuh sidecar + uji bahasa daerah |
