# GovConnect - WhatsApp Integration (Per Desa)

Dokumen ini adalah referensi integrasi WhatsApp terbaru untuk GovConnect.

Prinsip utama:
- Satu webhook receiver: Channel Service menerima semua webhook di `POST /webhook`
- Isolasi tenant: semua proses wajib scoped oleh `(village_id, wa_user_id)`
- Satu sesi per desa: sesi WhatsApp disimpan di DB internal Channel Service (`wa_sessions`)

## Arsitektur

```
Admin (Dashboard)
  ↓ (cookie auth)
govconnect-dashboard /api/whatsapp/*
  ↓ (x-internal-api-key)
Channel Service /internal/whatsapp/*
  ↓ (WA_SUPPORT_URL = account/session API, x-api-key / internal key)
genfity-wa-support /v1/sessions
  ↓ (session_token)
genfity-wa-support /v1/wa/*
  ↓ (backend)
genfity-wa (WA server)
  ↓ (webhook)
Channel Service /webhook
```

Saat `POST /api/whatsapp/session` dipanggil, GovConnect sekarang melakukan bootstrap session penuh:

1. membuat session via `WA_SUPPORT_URL /v1/sessions` bila customer API aktif;
2. mengirim webhook URL publik GovConnect;
3. mengirim konfigurasi S3 session ke `POST /v1/wa/session/s3/config`;
4. menjalankan `POST /v1/wa/session/s3/test`;
5. baru menyimpan session ke database internal jika semua step berhasil.

## Endpoint yang digunakan Dashboard

Dashboard hanya memakai endpoint berikut:
- `POST /api/whatsapp/session` → buat sesi (1 sesi per desa)
- `DELETE /api/whatsapp/session` → hapus sesi
- `GET /api/whatsapp/status` → cek status (connected/loggedIn/jid/wa_number)
- `POST /api/whatsapp/connect` → connect session
- `GET /api/whatsapp/qr` → ambil QR
- `POST /api/whatsapp/disconnect` → disconnect
- `POST /api/whatsapp/logout` → logout (butuh scan ulang)

Semua endpoint di atas meneruskan request ke Channel Service menggunakan header `x-internal-api-key`.

## Webhook inbound (WA Provider → GovConnect)

Channel Service mendukung format webhook **form mode** dari genfity-wa:
- `instanceName` → **harus** berisi `village_id`
- `userID` → WA user id / nomor pengirim
- `jsonData` → payload event WA

Mapping tenant dilakukan dari `instanceName` (slug session) ke `village_id` internal sehingga pesan dari 2 desa dengan WA user yang sama tidak akan bertabrakan.

## ENV yang wajib

Isi di `govconnect/.env` (lihat juga `.env.example`):

```env
# Base URL WhatsApp gateway (wajib mengarah ke prefix `/v1/wa`)
WA_API_URL=https://api-wa.genfity.com/v1/wa

# Base URL account/session API genfity-wa-support
WA_SUPPORT_URL=https://api-wa.genfity.com
WA_SUPPORT_INTERNAL_API_KEY=your_wa_support_api_key

# Shared secret untuk antar-service auth
INTERNAL_API_KEY=your_internal_api_key

# URL publik channel-service (untuk webhook URL yang dipublish)
PUBLIC_CHANNEL_BASE_URL=https://channel.govconnect.my.id

# Object storage yang juga dipush ke session WA
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=govconnect-media
S3_ACCESS_KEY=your_s3_access_key
S3_SECRET_KEY=your_s3_secret_key
S3_PATH_STYLE=false
S3_PUBLIC_URL=https://cdn.govconnect.my.id
S3_MEDIA_DELIVERY=s3
S3_RETENTION_DAYS=365

# (Opsional) untuk testing tanpa outbound call
WA_DRY_RUN=false
```

## Catatan Docker

Jika `POSTGRES_PASSWORD` mengandung karakter khusus (misalnya `@`), set juga `POSTGRES_PASSWORD_URLENCODED` (contoh `Genfity@2025` → `Genfity%402025`) karena `docker-compose.yml` membangun `DATABASE_URL` dari variable env.
