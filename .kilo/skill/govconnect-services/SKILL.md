---
name: govconnect-services
description: >
  Referensi cepat semua service GovConnect: port, env, health endpoint, internal API key,
  cara migrate database, cara cek log, dan cara restart service yang error di lokal.
  Gunakan skill ini sebagai referensi saat mengelola service lokal GovConnect.
---

# GovConnect Services Reference

## Port Map

| Service | Port | Base URL |
|---|---|---|
| channel-service | 3001 | http://127.0.0.1:3001 |
| ai-service | 3002 | http://127.0.0.1:3002 |
| case-service | 3003 | http://127.0.0.1:3003 |
| notification-service | 3004 | http://127.0.0.1:3004 |
| dashboard (Next.js) | 3010 | http://127.0.0.1:3010 |

## Health Endpoints

```
GET http://127.0.0.1:3001/health
GET http://127.0.0.1:3002/health
GET http://127.0.0.1:3003/health
GET http://127.0.0.1:3004/health
GET http://127.0.0.1:3010/api/health
```

## Internal API Key

Semua service: `govconnect-internal-api-key-2025`

Header: `x-api-key: govconnect-internal-api-key-2025`

## Database Schemas

| Service | Schema |
|---|---|
| channel-service | channel |
| ai-service | ai |
| case-service | cases |
| notification-service | notification |
| dashboard | dashboard |

DB: `postgresql://govconnect:dbgovconnect2026@127.0.0.1:5432/govconnect`

## Dev Commands (JANGAN build)

```powershell
# channel-service
cd govconnect-channel-service && npx tsx watch src/server.ts

# ai-service
cd govconnect-ai-service && npx tsx watch src/server.ts

# case-service
cd govconnect-case-service && npx tsx watch src/server.ts

# notification-service
cd govconnect-notification-service && npx tsx watch src/server.ts

# dashboard
cd govconnect-dashboard && npx next dev -p 3010
```

## Migration Commands

```powershell
# Deploy migrations (production-safe, pakai ini untuk dev)
pnpm db:migrate:deploy

# Cek status migration
pnpm db:migrate:status

# Dev migration (buat migration baru)
pnpm db:migrate
```

## Log Files

```
scripts/dev-runtime/logs/channel-service.out.log
scripts/dev-runtime/logs/channel-service.err.log
scripts/dev-runtime/logs/ai-service.out.log
scripts/dev-runtime/logs/ai-service.err.log
scripts/dev-runtime/logs/case-service.out.log
scripts/dev-runtime/logs/case-service.err.log
scripts/dev-runtime/logs/notification-service.out.log
scripts/dev-runtime/logs/notification-service.err.log
scripts/dev-runtime/logs/dashboard.out.log
scripts/dev-runtime/logs/dashboard.err.log
```

## Scripts Tersedia

```powershell
# Start semua
.\scripts\start-local-dev.ps1

# Stop semua
.\scripts\stop-local-dev.ps1

# Cek status
.\scripts\check-local-dev.ps1
.\scripts\check-local-dev.ps1 -IncludeLogTail -TailLines 30
.\scripts\check-local-dev.ps1 -Json

# Restart satu service
.\scripts\restart-local-service.ps1 -Name ai-service
.\scripts\restart-local-service.ps1 -Name case-service -RunMigrate

# Tail log
.\scripts\tail-service-log.ps1 -Name ai-service
.\scripts\tail-service-log.ps1 -Name dashboard -Lines 50
```

## RabbitMQ

URL: `amqp://admin:genfityrabbitmq@127.0.0.1:5672/govconnect`
Management UI: http://127.0.0.1:15672 (admin/genfityrabbitmq)

## WA Dry Run

Channel service `.env`: `WA_DRY_RUN=false`

Untuk testing lokal tanpa WA aktif, set `WA_DRY_RUN=true` di `govconnect-channel-service/.env`.

## Testing Mode AI

AI service `.env`: `TESTING_MODE=false`

Set `TESTING_MODE=true` untuk disable side effects di AI service.

## Seed Accounts

| Role | Username | Password | Village |
|---|---|---|---|
| superadmin | superadmin | GovConnect2026! | - |
| village_admin | admin_sangreseng | SangresengAde2026! | Desa Sanreseng Ade |

## TypeScript Check (tanpa build)

```powershell
# Cek TypeScript tanpa build
cd govconnect-case-service && npx tsc --noEmit
cd govconnect-ai-service && npx tsc --noEmit
cd govconnect-channel-service && npx tsc --noEmit
cd govconnect-notification-service && npx tsc --noEmit
```

Dashboard: TypeScript dicek otomatis saat `next dev` berjalan.
