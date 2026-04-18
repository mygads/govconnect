# Local Dev E2E Testing Report

Tanggal: 2026-04-18

## Ringkasan

Environment lokal sudah disamakan dari root `.env`, semua service aplikasi dijalankan lokal dalam mode watch/daemon, infra tetap memakai Docker, data RAG desa Sanreseng Ade sudah direindex ulang, alur login/webchat/WA dry-run/RAG/embed/rerank/rewrite/status-check sudah diuji end-to-end, dan QA suite final lulus `24/24`.

## Scope yang dikerjakan

- Sinkronisasi `.env` dan `.env.example` per service dari root `.env`
- Menjalankan service lokal non-Docker dalam mode watch/daemon
- Menjaga Docker hanya untuk infra: PostgreSQL, RabbitMQ, Redis
- Reindex data dokumen seed untuk RAG dari `docs/seed/desa-sangreseng-ade/documents`
- Uji login, webchat, embedding, RAG retrieval, rerank, rewrite, status check, dan WhatsApp dry-run
- Perbaikan code dan config saat ditemukan error
- Verifikasi database dan artefak hasil test

## Environment yang disamakan

Root `.env` dijadikan sumber kebenaran untuk file env lokal berikut:

- `govconnect-ai-service/.env`
- `govconnect-ai-service/.env.example`
- `govconnect-channel-service/.env`
- `govconnect-channel-service/.env.example`
- `govconnect-case-service/.env`
- `govconnect-case-service/.env.example`
- `govconnect-notification-service/.env`
- `govconnect-notification-service/.env.example`
- `govconnect-dashboard/.env`
- `govconnect-dashboard/.env.example`

Poin penting:

- Semua app service memakai `NODE_ENV=development`
- Semua koneksi DB lokal diarahkan ke `127.0.0.1:5432`
- Semua koneksi RabbitMQ diarahkan ke `127.0.0.1:5672`
- Antar-service lokal memakai port `3001`, `3002`, `3003`, `3004`, `3010`
- `WA_DRY_RUN=true`
- Model rerank diarahkan ke konfigurasi yang tervalidasi:
  - `RERANK_MODEL=cohere/rerank-v3.5`
  - `RERANK_PATH=/rerank`

## Runtime lokal

Script baru:

- `scripts/start-local-dev.ps1`
- `scripts/stop-local-dev.ps1`

Fungsi:

- Menyalakan infra Docker bila belum aktif
- Mematikan container app agar tidak bentrok dengan proses lokal
- Menjalankan service lokal dengan watch mode
- Menyimpan PID dan log runtime di `scripts/dev-runtime/`

Service lokal yang berjalan:

- Channel Service: `http://127.0.0.1:3001`
- AI Service: `http://127.0.0.1:3002`
- Case Service: `http://127.0.0.1:3003`
- Notification Service: `http://127.0.0.1:3004`
- Dashboard: `http://127.0.0.1:3010`

Infra Docker yang dipakai:

- PostgreSQL: `infra-postgres`
- RabbitMQ: `rabbitmq`
- Redis: `redis`

## Data RAG yang disiapkan

Dokumen seed Sanreseng Ade yang direindex ulang:

- `Informasi-Kontak-Desa-Sanreseng-Ade.txt`
- `Panduan-Layanan-Administrasi-Desa-Sanreseng-Ade.txt`
- `Profil-Desa-Sanreseng-Ade.txt`
- `Rencana-Pembangunan-Desa-Sanreseng-Ade-2021-2029.txt`
- `SOP-Pengaduan-Desa-Sanreseng-Ade.txt`

Prinsip yang dipakai:

- Reuse row `knowledge_documents` yang sudah ada
- Tidak membuat duplikasi dokumen dashboard
- Update `file_url`, `status`, dan `total_chunks` setelah reindex

Verifikasi DB setelah reindex:

- `ai.knowledge_vectors`: `10`
- `ai.document_vectors`: `9`
- Dokumen unik yang sudah punya vector: `5`

## Perbaikan code yang dilakukan

### Integrasi internal

- `govconnect-notification-service/src/clients/channel-service.client.ts`
  - Header auth internal diperbaiki dari `X-API-Key` menjadi `x-internal-api-key`

### AI orchestration dan retrieval

- `govconnect-ai-service/src/services/agent/agent-prompt.ts`
  - Prompt dipertegas agar pertanyaan faktual wajib memakai tool yang relevan
  - Jawaban dipaksa tetap dalam Bahasa Indonesia
  - Enumerasi penting tidak boleh dihilangkan

- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts`
  - Turn pertama agent memakai `tool_choice='required'` bila tools tersedia
  - Heuristik tool diperluas untuk knowledge/doc questions yang sebelumnya sering miss

- `govconnect-ai-service/src/services/unified-message-processor.service.ts`
  - Intent user-facing tidak lagi selalu jatuh ke `AGENT`
  - Output assistant dinormalisasi ke dash/spasi ASCII

- `govconnect-ai-service/src/services/response-cache.service.ts`
  - Generic fallback response seperti “terjadi gangguan” tidak lagi boleh masuk cache

### Status check dan error handling

- `govconnect-ai-service/src/services/case-client.service.ts`
  - `404` pada cek status laporan dipetakan benar ke not-found, bukan internal error

- `govconnect-ai-service/src/services/circuit-breaker.service.ts`
  - HTTP response error tidak lagi selalu tertelan fallback generik

### WhatsApp dry-run

- `govconnect-channel-service/src/services/wa.service.ts`
  - `WA_DRY_RUN=true` sekarang bypass kebutuhan token/session untuk:
    - send message
    - send contact
    - typing indicator
    - mark as read
  - Hasilnya dry-run tidak lagi mengeluarkan error token palsu

### Test harness

- `scripts/qa-webchat-sanreseng-ade.ps1`
  - Ekspektasi QA diperbarui agar sesuai knowledge base dan document RAG saat ini

## Verifikasi yang dijalankan

### Health check

- `GET /health` untuk service `3001`, `3002`, `3003`, `3004` sukses

### Login dashboard

- Login API dashboard berhasil dengan akun admin seed

### AI gateway ping

- `POST /api/testing/ping` sukses untuk:
  - LLM
  - Embedding
  - Rewrite
  - Rerank

### Embedding

- `POST /api/knowledge/embed-all`
- Hasil: `processed=10`, `failed=0`, `total=10`

### Webchat end-to-end

QA script final:

- File hasil: `scripts/qa-results/webchat-qa-sanreseng-ade_20260418_111309.json`
- Ringkasan: `PASS=24`, `FAIL=0`, `ERROR=0`

Kategori test yang lolos:

- Profil kantor desa
- Jam operasional
- Nomor kontak
- Panduan penggunaan GovConnect
- Format layanan
- 5W1H
- Status dan notifikasi
- SOP pengaduan
- Prioritas pengaduan
- Kanal layanan publik
- Tahap layanan
- Format berkas
- Penanganan file besar
- Penamaan file
- FAQ perubahan data/layanan
- Glosarium `LAY`
- Penjelasan embedding
- Kebijakan penggunaan data
- Kebijakan keamanan data
- Status check not found
- Luas wilayah desa dari dokumen

### WhatsApp dry-run end-to-end

Simulasi webhook:

- `scripts/wa-sim.ps1`

Hasil tervalidasi:

- Pesan inbound masuk ke `channel.messages`
- Channel publish event ke RabbitMQ
- AI menerima event, memproses, dan menyimpan reply
- Reply outbound masuk kembali ke `channel.messages`
- Pengiriman WA provider tidak benar-benar dilakukan
- Log menunjukkan `WA_DRY_RUN: Skipping WhatsApp API call`

Contoh user simulasi yang tervalidasi:

- `6281234500013`
- `6281234500014`

### Status check flow

- Query `cek status LAP-20260115-001`
- Hasil final: user mendapat jawaban not-found yang benar, bukan generic internal failure

### Type check

Semua lolos:

- `govconnect-ai-service`: `npx tsc --noEmit`
- `govconnect-channel-service`: `npx tsc --noEmit`
- `govconnect-case-service`: `npx tsc --noEmit`
- `govconnect-notification-service`: `npx tsc --noEmit`
- `govconnect-dashboard`: `npx tsc --noEmit`

## Verifikasi database

Yang dicek langsung di PostgreSQL Docker:

- Flag `channel.channel_accounts.enabled_wa` untuk Sanreseng Ade
- Persistensi `channel.messages` dan `channel.conversations`
- Vector count dokumen/knowledge
- Update metadata dokumen setelah reindex

## Non-duplication / cleanup

Yang dipastikan tidak redundant:

- Tidak membuat row dokumen dashboard baru saat reindex
- Tidak menyisakan cache error generik untuk query FAQ
- Dry-run WA tidak lagi menghasilkan error token palsu
- Env per service kembali mengikuti satu sumber utama di root `.env`

## Cara rerun

Start local dev:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local-dev.ps1
```

Stop local dev:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop-local-dev.ps1
```

QA webchat:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/qa-webchat-sanreseng-ade.ps1 -BaseUrl http://127.0.0.1:3002 -InternalApiKey govconnect-internal-api-key-2025 -VillageId cmkuvo1dk0000mj60h4u4bq1w
```

Simulasi WA dry-run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/wa-sim.ps1 -VillageId cmkuvo1dk0000mj60h4u4bq1w -WaUserId 6281234500099 -Message 'Alamat kantor desa?' -ChannelBaseUrl http://127.0.0.1:3001 -InternalApiKey govconnect-internal-api-key-2025 -PollSeconds 20 -Limit 10
```

## Artefak utama

- QA final: `scripts/qa-results/webchat-qa-sanreseng-ade_20260418_111309.json`
- Runtime log: `scripts/dev-runtime/logs/`
- Dokumen test report ini: `docs/LOCAL-DEV-E2E-TESTING-2026-04-18.md`
