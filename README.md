# GovConnect

GovConnect adalah sistem layanan desa multi-service yang terdiri dari dashboard admin, AI service, channel service, case service, notification service, PostgreSQL/pgvector, Redis, dan RabbitMQ.

## Service utama

- `govconnect-dashboard` — Next.js dashboard admin/superadmin dan API proxy publik/internal.
- `govconnect-ai-service` — pemrosesan AI, RAG, gateway model, billing token, webchat, dan endpoint admin internal.
- `govconnect-channel-service` — webhook/channel WhatsApp, media upload, dan publikasi event pesan.
- `govconnect-case-service` — manajemen kasus/layanan dan client notification internal.
- `govconnect-notification-service` — pengiriman notifikasi dari event internal.

## Boundary keamanan

- Service internal memakai header `x-internal-api-key`.
- Endpoint operasional seperti `/admin`, `/metrics`, `/stats`, `/rate-limit`, dan `/api-docs` harus tetap internal/auth-gated.
- Namespace dashboard `/api/webchat/*` adalah public surface; setiap route di bawahnya wajib punya validasi input dan rate-limit sendiri.
- Webhook channel-service memakai HMAC dan hanya mempercayai forwarded IP jika `TRUST_PROXY=true`.

## Local/deployment shape

`docker-compose.yml` adalah referensi runtime utama. Service aplikasi dibind ke `127.0.0.1` dan menggunakan network eksternal `govconnect-network` serta `infra-network`.

Perintah umum:

```bash
docker compose up -d
```

Validasi TypeScript per service:

```bash
cd govconnect-dashboard && npx tsc --noEmit
cd govconnect-ai-service && npx tsc --noEmit
cd govconnect-channel-service && npx tsc --noEmit
cd govconnect-case-service && npx tsc --noEmit
cd govconnect-notification-service && npx tsc --noEmit
```

## Dokumentasi

Lihat `docs/README.md` untuk status dokumen. Dokumen di `docs/auditlama/` adalah arsip lama dan tidak boleh dipakai sebagai sumber kebenaran tanpa verifikasi ulang ke kode saat ini.
