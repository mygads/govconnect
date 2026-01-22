# Panduan Seed Data Layanan

## Overview

File ini berisi panduan untuk mengisi data layanan ke database di server production.

## Daftar Layanan yang Akan Di-seed

| Kode | Nama Layanan | Kategori | Kuota/Hari |
|------|--------------|----------|------------|
| SKD | Surat Keterangan Domisili | Administrasi | 30 |
| SKU | Surat Keterangan Usaha | Administrasi | 20 |
| SKTM | Surat Keterangan Tidak Mampu | Sosial | 15 |
| SKBM | Surat Keterangan Belum Menikah | Administrasi | 20 |
| IKR | Izin Keramaian | Perizinan | 10 |
| SPKTP | Surat Pengantar KTP | Kependudukan | 25 |
| SPKK | Surat Pengantar Kartu Keluarga | Kependudukan | 20 |
| SPSKCK | Surat Pengantar SKCK | Kependudukan | 25 |
| SPAKTA | Surat Pengantar Akta | Kependudukan | 15 |
| SKK | Surat Keterangan Kematian | Sosial | 10 |
| SPP | Surat Pengantar Pindah | Kependudukan | 10 |

## Langkah-langkah Seed di Server

### 1. SSH ke Server

```bash
ssh -i C:\Users\USER\.ssh\deploy_key deploy@129.212.228.210
```

### 2. Masuk ke Container Case Service

```bash
# Cek container yang running
docker ps | grep case

# Masuk ke container
docker exec -it govconnect_case-service bash
```

### 3. Jalankan Seed

```bash
# Di dalam container
cd /app
npx prisma db seed
```

Atau jika menggunakan ts-node:

```bash
npx ts-node prisma/seed-services.ts
```

### 4. Verifikasi Data

```bash
# Masuk ke database
docker exec -it govconnect_postgres psql -U postgres -d govconnect_case

# Cek data services
SELECT code, name, category, is_active, daily_quota FROM services ORDER BY code;

# Hitung jumlah layanan
SELECT COUNT(*) FROM services;
```

Output yang diharapkan: 11 layanan

## Alternatif: Seed via Docker Compose

Jika seed script sudah dikonfigurasi di package.json:

```bash
# Di server, masuk ke folder govconnect
cd /path/to/govconnect

# Jalankan seed via docker compose
docker compose exec case-service npx prisma db seed
```

## Alternatif: Seed Manual via SQL

Jika perlu seed manual via SQL:

```sql
-- Masuk ke database
docker exec -it govconnect_postgres psql -U postgres -d govconnect_case

-- Insert services
INSERT INTO services (id, code, name, description, category, is_active, is_online_available, requirements, sop_steps, estimated_duration, daily_quota, operating_hours, created_at, updated_at)
VALUES 
  (gen_random_uuid(), 'SKD', 'Surat Keterangan Domisili', 'Surat resmi dari kelurahan yang menyatakan bahwa seseorang benar-benar bertempat tinggal di alamat tertentu.', 'administrasi', true, true, ARRAY['KTP asli dan fotokopi (2 lembar)', 'Kartu Keluarga (KK) asli dan fotokopi', 'Surat Pengantar dari RT/RW', 'Pas foto 3x4 (2 lembar)', 'Bukti tempat tinggal'], ARRAY['Minta surat pengantar dari RT/RW', 'Datang ke kelurahan', 'Ambil nomor antrian', 'Serahkan berkas', 'Tunggu verifikasi', 'Ambil SKD'], 30, 30, '{"senin":{"open":"08:00","close":"15:00"},"selasa":{"open":"08:00","close":"15:00"},"rabu":{"open":"08:00","close":"15:00"},"kamis":{"open":"08:00","close":"15:00"},"jumat":{"open":"08:00","close":"15:00"},"sabtu":{"open":"08:00","close":"12:00"},"minggu":null}', NOW(), NOW()),
  -- ... (tambahkan layanan lainnya)
;
```

## Troubleshooting

### Error: Database connection refused
```bash
# Cek apakah postgres container running
docker ps | grep postgres

# Cek logs
docker logs govconnect_postgres
```

### Error: Table "services" does not exist
```bash
# Jalankan migration dulu
docker exec -it govconnect_case-service npx prisma migrate deploy
```

### Error: Duplicate key
```bash
# Hapus data lama dulu
docker exec -it govconnect_postgres psql -U postgres -d govconnect_case -c "DELETE FROM services;"

# Jalankan seed ulang
docker exec -it govconnect_case-service npx prisma db seed
```

## Verifikasi Setelah Seed

### 1. Cek via API

```bash
# Dari server
curl http://localhost:3002/services

# Atau dari luar (jika ada reverse proxy)
curl https://case.govconnect.my.id/services
```

### 2. Cek via Dashboard

Buka dashboard admin dan navigasi ke menu Layanan untuk melihat daftar layanan yang sudah di-seed.

### 3. Test Permohonan Layanan via WhatsApp

Kirim pesan ke bot WhatsApp:
- "Mau buat surat domisili"
- "Mau urus SKTM"
- "Butuh izin keramaian"

Bot seharusnya bisa mengenali intent dan memulai proses permohonan layanan.

## Catatan Penting

1. **Backup dulu** sebelum menjalankan seed di production
2. Seed script menggunakan `upsert` atau skip jika data sudah ada
3. Jika perlu update data, edit file `services.ts` lalu jalankan seed ulang
4. Pastikan Knowledge Base (KB files) sudah di-upload ke vector database untuk RAG
