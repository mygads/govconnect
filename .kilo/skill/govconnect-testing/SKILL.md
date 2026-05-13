---
name: govconnect-testing
description: >
  Panduan lengkap testing autonomous GovConnect di lokal: menjalankan semua service,
  mengelola dev-runtime, testing API lintas service, testing UI dengan Playwright,
  testing AI agent/webhook, dan menulis hasil ke dokumen shared checklist.
  Gunakan skill ini setiap kali diminta melakukan testing GovConnect.
---

# GovConnect Local Testing Skill

## Arsitektur dan Port

| Service | Dir | Port | Dev Command | Health |
|---|---|---|---|---|
| channel-service | govconnect-channel-service | 3001 | `npx tsx watch src/server.ts` | GET /health |
| ai-service | govconnect-ai-service | 3002 | `npx tsx watch src/server.ts` | GET /health |
| case-service | govconnect-case-service | 3003 | `npx tsx watch src/server.ts` | GET /health |
| notification-service | govconnect-notification-service | 3004 | `npx tsx watch src/server.ts` | GET /health |
| dashboard (Next.js) | govconnect-dashboard | 3010 | `npx next dev -p 3010` | GET /api/health |

**JANGAN pernah jalankan `pnpm build` atau `next build` untuk testing lokal.**
Selalu gunakan `tsx watch` untuk Express services dan `next dev` untuk dashboard.

## Akun Seed

Dari `.env` dashboard:

| Role | Username | Password |
|---|---|---|
| superadmin | superadmin | GovConnect2026! |
| village_admin | admin_sangreseng | SangresengAde2026! |

Desa seed: **Desa Sanreseng Ade** (slug: `desa-sanreseng-ade`)

Internal API Key semua service: `govconnect-internal-api-key-2025`

## Script Dev-Runtime

Semua script ada di `scripts/`:

```powershell
# Start semua service sekaligus (migrate + run)
.\scripts\start-local-dev.ps1

# Stop semua service
.\scripts\stop-local-dev.ps1

# Cek status semua service
.\scripts\check-local-dev.ps1 -IncludeLogTail

# Restart satu service saja (jika error)
.\scripts\restart-local-service.ps1 -Name <service-name> -RunMigrate

# Tail log satu service
.\scripts\tail-service-log.ps1 -Name <service-name>
```

Nama service valid: `channel-service`, `case-service`, `notification-service`, `ai-service`, `dashboard`

Log ada di: `scripts/dev-runtime/logs/<service-name>.out.log` dan `.err.log`
PID ada di: `scripts/dev-runtime/pids/<service-name>.pid`

## Alur Testing Autonomous

### 1. Pastikan Infrastruktur Docker Berjalan

```powershell
docker ps --filter "name=infra-postgres" --filter "name=rabbitmq"
```

Jika tidak running:
```powershell
docker start infra-postgres rabbitmq
```

### 2. Start Semua Service

```powershell
.\scripts\start-local-dev.ps1
```

Tunggu semua health check hijau. Jika timeout, cek log:
```powershell
.\scripts\check-local-dev.ps1 -IncludeLogTail -Json
```

### 3. Jika Ada Service Error

**JANGAN restart semua.** Hanya restart service yang error:

```powershell
# Cek log dulu
.\scripts\tail-service-log.ps1 -Name <service-name>

# Jika ada TypeScript error atau migration error, perbaiki kodenya dulu
# Lalu restart hanya service itu
.\scripts\restart-local-service.ps1 -Name <service-name> -RunMigrate
```

Ulangi cek log → perbaiki → restart sampai service healthy.

### 4. Login dan Ambil Token

```powershell
# Login superadmin
$r = Invoke-RestMethod -Uri "http://127.0.0.1:3010/api/auth/login" `
  -Method POST -ContentType "application/json" `
  -Body '{"username":"superadmin","password":"GovConnect2026!"}'
$SUPERADMIN_TOKEN = $r.token

# Login village admin
$r2 = Invoke-RestMethod -Uri "http://127.0.0.1:3010/api/auth/login" `
  -Method POST -ContentType "application/json" `
  -Body '{"username":"admin_sangreseng","password":"SangresengAde2026!"}'
$VILLAGE_TOKEN = $r2.token
```

### 5. Testing API

Gunakan `Invoke-RestMethod` atau `curl` untuk tembak API langsung ke service atau via dashboard proxy.

Contoh:
```powershell
# Via dashboard proxy (dengan auth)
$headers = @{ Authorization = "Bearer $VILLAGE_TOKEN" }
Invoke-RestMethod -Uri "http://127.0.0.1:3010/api/laporan" -Headers $headers

# Langsung ke case-service (internal)
$iHeaders = @{ "x-api-key" = "govconnect-internal-api-key-2025" }
Invoke-RestMethod -Uri "http://127.0.0.1:3003/laporan" -Headers $iHeaders
```

### 6. Testing AI/Webhook

Simulasi pesan WhatsApp masuk ke channel-service:
```powershell
$body = @{
  type = "message"
  village_id = "<village-id>"
  from = "6281234567890@s.whatsapp.net"
  message = @{ conversation = "halo, mau lapor jalan rusak" }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://127.0.0.1:3001/webhook/whatsapp" `
  -Method POST -ContentType "application/json" `
  -Headers @{ "x-api-key" = "govconnect-internal-api-key-2025" } `
  -Body $body
```

Cek log AI service untuk melihat tool calls, intent, dan response:
```powershell
.\scripts\tail-service-log.ps1 -Name ai-service
```

### 7. Testing UI dengan Playwright

```powershell
cd govconnect-dashboard
npx playwright test --headed
```

Atau test spesifik:
```powershell
npx playwright test tests/login.spec.ts --headed
```

### 8. Cek Database Langsung

```powershell
# Cek laporan terbaru
$env:PGPASSWORD = "dbgovconnect2026"
psql -h 127.0.0.1 -U govconnect -d govconnect -c "SELECT complaint_id, status, kategori, village_id FROM cases.complaints ORDER BY created_at DESC LIMIT 10;"

# Cek service requests
psql -h 127.0.0.1 -U govconnect -d govconnect -c "SELECT request_number, status, village_id FROM cases.service_requests ORDER BY created_at DESC LIMIT 10;"
```

## Aturan Penting

1. **Jangan build** - hanya `tsx watch` dan `next dev`
2. **Jangan restart semua** jika hanya satu service error - restart yang error saja
3. **Selalu cek log** sebelum restart
4. **Tunggu health check** sebelum lanjut testing
5. **Jika server 500/404** - cek apakah service masih starting atau crash
6. **Jika TypeScript error** - perbaiki kode, service akan auto-reload karena `tsx watch`
7. **Jika migration error** - jalankan `restart-local-service.ps1 -RunMigrate`
8. **Tulis hasil** ke `docs/testing/TESTING-STATUS.md` setelah setiap sesi

## Dokumen Shared Antar Session

Dua session testing menulis ke satu dokumen bersama:
- `docs/testing/TESTING-PRD.md` - PRD testing lengkap (dibuat session PRD)
- `docs/testing/TESTING-STATUS.md` - checklist hasil testing (diedit kedua session)

Format update checklist:
```markdown
- [x] TC-001: Login superadmin - PASS (session-1, 2026-05-12)
- [ ] TC-002: Login village admin - PENDING
- [x] TC-003: Buat laporan via AI - PASS (session-2, 2026-05-12)
```

## Pembagian Session

- **Session PRD**: Buat `TESTING-PRD.md` dengan semua test case sebelum testing dimulai
- **Session 1**: Jalankan test case ganjil (TC-001, TC-003, TC-005, ...)
- **Session 2**: Jalankan test case genap (TC-002, TC-004, TC-006, ...)
- Kedua session update `TESTING-STATUS.md` secara bergantian

## Jika Testing Gagal

1. Cek apakah service error → lihat log → perbaiki → restart service itu saja
2. Jika API return 500 → cek log service yang ditembak
3. Jika API return 404 → cek apakah route benar dan service running
4. Jika TypeScript compile error → perbaiki file, `tsx watch` akan auto-reload
5. Jika migration gagal → jalankan `restart-local-service.ps1 -Name <service> -RunMigrate`
6. Catat semua failure di `TESTING-STATUS.md` dengan detail error
