# Quick Setup: GovConnect + WhatsApp (Per Desa)

> Channel Service sekarang mem-bootstrap session WhatsApp sekaligus dengan webhook dan konfigurasi S3 media.

## Prerequisites

- Semua service GovConnect (minimal: `govconnect-dashboard`, `govconnect-channel-service`, Postgres)
- WA Provider service berjalan dan bisa diakses dari Channel Service (lihat `WA_API_URL`)

## Step 1: Configure Environment

Edit `govconnect/.env` (atau `cp .env.example .env` lalu isi):

```env
# WA Gateway base URL (wajib mengarah ke prefix `/v1/wa`)
WA_API_URL=https://api-wa.genfity.com/v1/wa

# API session/account genfity-wa-support
WA_SUPPORT_URL=https://api-wa.genfity.com
WA_SUPPORT_INTERNAL_API_KEY=your_wa_support_api_key

# Shared secret untuk internal calls antar service
INTERNAL_API_KEY=your_internal_api_key

# URL publik channel-service (untuk webhook URL)
PUBLIC_CHANNEL_BASE_URL=https://channel.govconnect.my.id

# S3/object storage yang dipakai GovConnect DAN dipush ke session WA
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=govconnect-media
S3_ACCESS_KEY=your_s3_access_key
S3_SECRET_KEY=your_s3_secret_key
S3_PATH_STYLE=false
S3_PUBLIC_URL=https://cdn.govconnect.my.id
S3_MEDIA_DELIVERY=s3
S3_RETENTION_DAYS=365

# (Opsional) Verify token untuk webhook.
# Jika kosong, Channel Service akan menerima verifikasi tanpa token (cocok jika genfity-wa tidak diset verify token).
WA_WEBHOOK_VERIFY_TOKEN=

# (Opsional) dry run untuk testing tanpa outbound call
WA_DRY_RUN=false
```

Catatan Docker DB:
- Jika `POSTGRES_PASSWORD` punya karakter khusus (mis. `@`), isi juga `POSTGRES_PASSWORD_URLENCODED` (contoh `Genfity@2025` → `Genfity%402025`).

## Step 2: Jalankan Docker Compose

```bash
cd govconnect
docker compose up -d --build
```

## Step 3: Connect WhatsApp per Desa

1. Login ke GovConnect Dashboard
2. Masuk menu **WhatsApp**
3. Pilih desa yang ingin dikoneksikan
4. Klik **Buat Sesi WhatsApp**
5. Klik **Konek WhatsApp**
6. Scan QR dari aplikasi WhatsApp (HP)
7. Status akan berubah menjadi connected/logged in

## Troubleshooting

**Status selalu 404 / “Belum ada sesi”**
- Buat sesi dulu di menu WhatsApp untuk desa yang ingin dihubungkan.

**QR tidak muncul**
- Pastikan WA Provider up dan `WA_API_URL` benar (harus include `/v1/wa`).
- Cek log `govconnect-channel-service`.

**Create session gagal saat provisioning session**
**Create session gagal saat bootstrap storage**
- Pastikan `S3_*` valid dan bucket bisa diakses dari server `genfity-wa`.
- Cek response `POST /v1/wa/session/s3/test` di log `govconnect-channel-service`.

**Webhook URL yang dipakai**
- Canonical: `https://channel.govconnect.my.id/webhook`
- Alternatif yang juga didukung: `/webhook/whatsapp` atau root `/`

**Request internal ditolak (401/403)**
- Samakan `INTERNAL_API_KEY` di Dashboard dan Channel Service.

## Referensi

Untuk detail arsitektur & endpoint, lihat: [GENFITY-WHATSAPP-INTEGRATION.md](./GENFITY-WHATSAPP-INTEGRATION.md)
