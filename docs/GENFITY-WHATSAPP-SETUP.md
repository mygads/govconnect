# Quick Setup: GovConnect + WhatsApp (Per Desa)

> Catatan: Channel Service bisa membuat sesi dengan 2 cara:
> 1) (Direkomendasikan) lewat **genfity-app customer-api** agar kuota “admin” (mis. max 99 sesi) terpakai terpusat.
> 2) Fallback: langsung ke WA provider (`WA_API_URL`) seperti sebelumnya.

## Prerequisites

- Semua service GovConnect (minimal: `govconnect-dashboard`, `govconnect-channel-service`, Postgres)
- WA Provider service berjalan dan bisa diakses dari Channel Service (lihat `WA_API_URL`)

## Step 1: Configure Environment

Edit `govconnect/.env` (atau `cp .env.example .env` lalu isi):

```env
# (Opsional tapi direkomendasikan) Buat sesi via genfity-app customer-api
# Base URL genfity customer-api (tanpa trailing slash)
GENFITY_APP_API_URL=https://genfity.com/api/customer-api
# API key (format: gf_...) dipakai sebagai Authorization: Bearer <apiKey>
GENFITY_APP_CUSTOMER_API_KEY=gf_xxxxxxxxxxxxxxxxx

# WA Gateway base URL (wajib mengarah ke prefix `/v1/wa`)
# Direkomendasikan: public gateway (genfity-wa-support)
WA_API_URL=https://api-wa.genfity.com/v1/wa

# Shared secret untuk internal calls antar service
INTERNAL_API_KEY=your_internal_api_key

# URL publik channel-service (untuk webhook URL)
PUBLIC_CHANNEL_BASE_URL=https://channel.govconnect.my.id

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

**Create session gagal saat pakai genfity-app**
- Pastikan `GENFITY_APP_API_URL` bisa diakses dari container `channel-service` (internet/DNS OK).
- Pastikan `GENFITY_APP_CUSTOMER_API_KEY` valid (header: `Authorization: Bearer gf_...`).

**Webhook URL yang dipakai**
- Canonical: `https://channel.govconnect.my.id/webhook`
- Alternatif yang juga didukung: `/webhook/whatsapp` atau root `/`

**Request internal ditolak (401/403)**
- Samakan `INTERNAL_API_KEY` di Dashboard dan Channel Service.

## Referensi

Untuk detail arsitektur & endpoint, lihat: [GENFITY-WHATSAPP-INTEGRATION.md](./GENFITY-WHATSAPP-INTEGRATION.md)
