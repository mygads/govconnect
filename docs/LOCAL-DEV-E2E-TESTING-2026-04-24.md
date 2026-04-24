# Local Dev E2E Testing Report

Tanggal: 2026-04-24

## Ringkasan akhir

Stack GovConnect sudah divalidasi ulang di local dev dengan app services berjalan lokal dan infra tetap di Docker.

Hasil utama:
- WA resident QA Sanreseng Ade lulus `15/15`
- Retrieval mode 3-varian sekarang eksplisit dan bisa dibedakan: `external_rerank`, `heuristic_rerank`, `raw_no_rerank`
- Persistence utama tervalidasi di PostgreSQL Docker untuk message, conversation, complaint, service request, dan document vectors
- Bug yang sebelumnya mengganggu flow warga sudah diperbaiki, terutama fallback model agent, routing tool, cache stateful service info, dan observability retrieval mode

## Runtime yang dipakai

App services lokal:
- Channel Service: `http://127.0.0.1:3001`
- AI Service: `http://127.0.0.1:3002`
- Case Service: `http://127.0.0.1:3003`
- Dashboard: `http://127.0.0.1:3010`

Infra Docker yang aktif:
- PostgreSQL: `infra-postgres`
- RabbitMQ: `rabbitmq`
- Redis: `redis`

Status Docker saat verifikasi:
- `infra-postgres` healthy
- `rabbitmq` healthy
- `redis` healthy

## Tenant dan corpus uji

Tenant aktif untuk resident-flow dan retrieval:
- Village slug: `desa-sanreseng-ade`
- Village ID: `cmkuvo1dk0000mj60h4u4bq1w`

Corpus dokumen Sanreseng Ade yang aktif di vector store mencakup dokumen seperti:
- `Profil-Desa-Sanreseng-Ade`
- `Rencana-Pembangunan-Desa-Sanreseng-Ade-2021-2029`
- `Panduan-Layanan-Administrasi-Desa-Sanreseng-Ade`
- `SOP-Pengaduan-Desa-Sanreseng-Ade`

Verifikasi vector DB:
- `ai.document_vectors` untuk tenant `cmkuvo1dk0000mj60h4u4bq1w`: `9` row

## Perbaikan kode yang dilakukan

### 1. Retrieval mode matrix dibuat eksplisit

File:
- [govconnect-ai-service/src/types/embedding.types.ts](govconnect-ai-service/src/types/embedding.types.ts)
- [govconnect-ai-service/src/services/rag.service.ts](govconnect-ai-service/src/services/rag.service.ts)
- [govconnect-ai-service/src/services/knowledge.service.ts](govconnect-ai-service/src/services/knowledge.service.ts)
- [govconnect-ai-service/src/services/ai-analytics.service.ts](govconnect-ai-service/src/services/ai-analytics.service.ts)

Perubahan penting:
- menambahkan mode retrieval eksplisit:
  - `external_rerank`
  - `heuristic_rerank`
  - `raw_no_rerank`
- `rag.service.ts` sekarang resolve mode dari option/env dan benar-benar membedakan:
  - external rerank via gateway
  - heuristic rerank lokal
  - raw tanpa rerank
- hasil `knowledge.service.ts` sekarang mengalirkan mode aktual dari `ragContext.retrievalDebug?.retrievalMode`
- analytics trace sekarang menerima mode retrieval baru, tidak lagi terbatas ke `rag|keyword|document_rag`

### 2. Agent fallback model dibuat lebih tahan gagal

File:
- [govconnect-ai-service/src/services/ai-gateway.service.ts](govconnect-ai-service/src/services/ai-gateway.service.ts)
- [govconnect-ai-service/src/services/agent/agent-orchestrator.ts](govconnect-ai-service/src/services/agent/agent-orchestrator.ts)

Perubahan penting:
- lane agent tidak lagi bergantung pada satu model alias saja
- fallback model dari env dipakai sebagai daftar prioritas
- agent call sekarang mencoba beberapa model sampai ada yang berhasil

### 3. Routing resident-flow diperbaiki

File:
- [govconnect-ai-service/src/services/agent/agent-orchestrator.ts](govconnect-ai-service/src/services/agent/agent-orchestrator.ts)

Perubahan penting:
- heuristik tool selection dipisah lebih tegas untuk:
  - service info
  - complaint SOP info
  - history/status by reference
  - cancel intent
  - village/profile/document query
- mengurangi konflik antara tool info dan tool aksi

### 4. Flow layanan WA yang stateful diperbaiki

File:
- [govconnect-ai-service/src/services/agent/tool-executor.ts](govconnect-ai-service/src/services/agent/tool-executor.ts)
- [govconnect-ai-service/src/services/unified-message-processor.service.ts](govconnect-ai-service/src/services/unified-message-processor.service.ts)

Perubahan penting:
- jawaban info layanan online selalu menyertakan ajakan konfirmasi `balas *iya*`
- `get_service_info` dihapus dari cacheable agent tools karena response ini harus membentuk ulang pending state
- akibatnya balasan `iya` kembali konsisten memicu link formulir

### 5. Harness QA WA diperkuat

File:
- [scripts/qa-wa-resident-sanreseng-ade.ps1](scripts/qa-wa-resident-sanreseng-ade.ps1)

Perubahan penting:
- null-safe property handling untuk payload message PowerShell
- helper untuk outbound message filtering dan handoff assertion
- menghilangkan false negative dari struktur objek yang tidak konsisten

## Hasil QA resident flow

Artefak utama:
- [scripts/qa-results/wa-resident-qa-sanreseng-ade_20260424_012933.json](scripts/qa-results/wa-resident-qa-sanreseng-ade_20260424_012933.json)

Ringkasan:
- total: `16`
- pass: `16`
- fail: `0`
- error: `0`
- service request number: `LAY-20260423-012`
- complaint number: `LAP-20260423-008`

Suite yang lulus:
- service info
- complaint address clarification
- complaint create
- service link confirmation
- service created notification
- generic service status/history lookup
- service process notification
- service status by number
- edit link
- cancel confirmation
- cancel completed
- complaint status open
- complaint done notification
- complaint status done
- complaint SOP info query
- human handoff

Contoh output yang tervalidasi:
- service link membawa identitas WA:
  - `/form/desa-sanreseng-ade/administrasi-kependudukan-keterangan-domisili?wa=6289912345801`
- edit link bersifat private dan bertoken:
  - `/form/edit/LAY-20260423-012?token=bdf44d4f...&wa=6289912345801`
- complaint flow sekarang memicu klarifikasi alamat bila lokasi awal belum cukup spesifik
- handoff manusia aktif dengan takeover session tersimpan
- harness WA resident sudah diperkuat agar tidak lagi false negative karena message polling/lookup yang rapuh

## Retrieval mode comparison

Query pembanding yang dipakai:
- `berapa luas wilayah desa sanreseng ade`

Tenant:
- `cmkuvo1dk0000mj60h4u4bq1w`

### A. external_rerank

Hasil:
- retrieval mode: `external_rerank`
- total selected results: `2`
- confidence: `medium`
- top score: `0.80405265`
- top titles:
  - `Rencana-Pembangunan-Desa-Sanreseng-Ade-2021-2029`
  - `Profil-Desa-Sanreseng-Ade`

Catatan:
- reranker eksternal memang paling agresif menyaring candidate
- hasil akhir lebih sedikit, tapi ranking paling tajam
- `rerankScore` muncul pada candidate terpilih

### B. heuristic_rerank

Hasil:
- retrieval mode: `heuristic_rerank`
- total selected results: `5`
- confidence: `medium`
- top score: `0.7203514262397063`
- top titles:
  - `Rencana-Pembangunan-Desa-Sanreseng-Ade-2021-2029`
  - `Profil-Desa-Sanreseng-Ade`
  - `Rencana-Pembangunan-Desa-Sanreseng-Ade-2021-2029`
  - `Panduan-Layanan-Administrasi-Desa-Sanreseng-Ade`
  - `SOP-Pengaduan-Desa-Sanreseng-Ade`

Catatan:
- coverage lebih lebar daripada external rerank
- cocok untuk baseline tanpa dependency reranker eksternal
- hasil ranking masih cukup relevan untuk query faktual tenant ini

### C. raw_no_rerank

Hasil:
- retrieval mode: `raw_no_rerank`
- total selected results: `4`
- confidence: `medium`
- top score: `0.7179973366114719`
- top titles:
  - `Rencana-Pembangunan-Desa-Sanreseng-Ade-2021-2029`
  - `Profil-Desa-Sanreseng-Ade`
  - `Rencana-Pembangunan-Desa-Sanreseng-Ade-2021-2029`
  - `Panduan-Layanan-Administrasi-Desa-Sanreseng-Ade`

Catatan:
- ini baseline mentah tanpa post-rerank
- berguna untuk audit apakah peningkatan ranking benar-benar datang dari heuristic/external rerank

### Kesimpulan perbandingan retrieval

Untuk query faktual tenant ini:
- `external_rerank` memberi ranking paling tajam dan score tertinggi
- `heuristic_rerank` memberi coverage lebih lebar tanpa ketergantungan ke service rerank eksternal
- `raw_no_rerank` sekarang benar-benar baseline mentah, jadi pembandingnya tidak ambigu lagi

Praktisnya:
- kualitas ranking terbaik: `external_rerank`
- fallback paling aman: `heuristic_rerank`
- mode audit/baseline: `raw_no_rerank`

## Verifikasi database

### 1. Service request tersimpan, tenant-aware, dan private ke nomor pengaju

Query hasil verifikasi pada `cases.service_requests` untuk `LAY-20260423-012`:
- `village_id`: `cmkuvo1dk0000mj60h4u4bq1w`
- `wa_user_id`: `6289912345801`
- `channel`: `WHATSAPP`
- `channel_identifier`: `6289912345801`
- `status`: `CANCELED`
- `has_edit_token`: `true`

Makna:
- request layanan sekarang tersimpan dengan `village_id` yang benar
- ownership tetap private ke nomor WA pemohon
- edit token tetap tersimpan di DB
- status akhir sesuai flow QA, yaitu dibatalkan setelah konfirmasi

Negative verification:
- create request dengan `service_id` tenant Sanreseng Ade tetapi `village_id` tenant lain sekarang ditolak `400`
- error response: `village_id does not match selected service`

Implikasi:
- bug lama `service_requests.village_id` kosong pada jalur create sudah tertutup
- create flow sekarang tenant-safe baik untuk payload valid maupun mismatch tenant

### 2. Complaint tersimpan dan status final konsisten

Query hasil verifikasi pada `cases.complaints` untuk `LAP-20260423-008`:
- `wa_user_id`: `6289912345802`
- `channel`: `WHATSAPP`
- `channel_identifier`: `6289912345802`
- `status`: `DONE`
- `village_id`: `cmkuvo1dk0000mj60h4u4bq1w`
- `admin_notes`: `Jalan sudah ditambal sementara oleh tim desa.`

Makna:
- complaint tersimpan pada tenant yang benar
- status akhir sesuai notifikasi QA terbaru
- catatan penyelesaian terbaca konsisten saat cek status done

### 3. Message persistence channel tervalidasi

Query hasil verifikasi pada `channel.messages` untuk `6289912345801` menunjukkan inbound dan outbound yang sesuai flow, termasuk:
- inbound:
  - `cek status LAY-20260423-012`
  - `mau update data layanan LAY-20260423-012`
  - `batalkan layanan LAY-20260423-012`
  - `YA`
- outbound:
  - status layanan sedang diproses
  - edit link layanan
  - konfirmasi pembatalan
  - notifikasi layanan dibatalkan
  - link formulir layanan dengan parameter `wa`
  - respons info layanan yang meminta konfirmasi `iya`

### 4. Conversation summary channel tervalidasi

Query hasil verifikasi pada `channel.conversations` untuk `6289912345801`:
- `is_takeover = false`
- `last_message` mengarah ke notifikasi pembatalan layanan

Makna:
- summary conversation ter-update sesuai pesan terakhir
- takeover tidak aktif untuk nomor service-flow ini, sesuai ekspektasi

## Known limitation yang masih terlihat

- Complaint update row untuk skenario QA resident tidak muncul di `cases.complaint_updates`, karena flow yang diuji memang mengubah status dan catatan utama di complaint, bukan menambah update terpisah.
- Output jawaban SOP pengaduan sudah benar secara isi, tetapi masih bisa dibuat lebih ringkas dan lebih percakapan bila ingin disempurnakan lagi untuk produksi.

## Rekomendasi final

- Gunakan `external_rerank` sebagai mode default produksi bila lane rerank sehat.
- Pertahankan `heuristic_rerank` sebagai fallback operasional.
- Simpan `raw_no_rerank` untuk audit, eval, dan debugging kualitas retrieval.
- Pertahankan validasi `service_id` ↔ `village_id` pada jalur create service request agar tenancy tetap ketat.
- Pertahankan harness QA resident yang sudah diperkuat, karena sekarang coverage-nya lebih dekat ke alur warga nyata dan lebih tahan false negative.

## Artefak penting

- Resident QA terbaru: [scripts/qa-results/wa-resident-qa-sanreseng-ade_20260424_012933.json](scripts/qa-results/wa-resident-qa-sanreseng-ade_20260424_012933.json)
- Resident QA sebelumnya: [scripts/qa-results/wa-resident-qa-sanreseng-ade_20260423_221415.json](scripts/qa-results/wa-resident-qa-sanreseng-ade_20260423_221415.json)
- Laporan sebelumnya: [docs/LOCAL-DEV-E2E-TESTING-2026-04-18.md](docs/LOCAL-DEV-E2E-TESTING-2026-04-18.md)
- Harness WA resident: [scripts/qa-wa-resident-sanreseng-ade.ps1](scripts/qa-wa-resident-sanreseng-ade.ps1)

## Update 2026-04-25: Validasi Handoff, Observability & Config Lanjutan

- Endpoint /api/internal/village-behavior divalidasi dengan auth & integrasi ke i-service.
- AI Token Usage divalidasi dengan grouping berdasarkan Intent Family & Tenant Flow.
- Handoff Enrichment dikonfirmasi masuk ke Takeover Session di channel service.
- Fallback error untuk start app & Prisma Generate di Windows berhasil diselesaikan dengan mematikan lock pada process 
ode sebelum migrasi.
- API Smoke Test Script memverifikasi keberhasilan integrasi internal.

