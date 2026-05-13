# GovConnect - AGENTS.md

Proyek ini adalah platform AI customer service pemerintahan multi-desa (GovConnect).

## Struktur Service

| Service | Dir | Port | Dev Command |
|---|---|---|---|
| channel-service | govconnect-channel-service | 3001 | `npx tsx watch src/server.ts` |
| ai-service | govconnect-ai-service | 3002 | `npx tsx watch src/server.ts` |
| case-service | govconnect-case-service | 3003 | `npx tsx watch src/server.ts` |
| notification-service | govconnect-notification-service | 3004 | `npx tsx watch src/server.ts` |
| dashboard | govconnect-dashboard | 3010 | `npx next dev -p 3010` |

## Aturan Wajib

- JANGAN jalankan `pnpm build` atau `next build` untuk development/testing lokal
- JANGAN restart semua service jika hanya satu yang error
- SELALU cek log sebelum restart: `.\scripts\tail-service-log.ps1 -Name <service>`
- SELALU tunggu health check sebelum lanjut setelah restart
- Gunakan `npx tsc --noEmit` untuk type-check tanpa build
- Migration: `pnpm db:migrate:deploy` (bukan `db:migrate`)

## Scripts Dev-Runtime

```powershell
.\scripts\start-local-dev.ps1          # Start semua service
.\scripts\stop-local-dev.ps1           # Stop semua service
.\scripts\check-local-dev.ps1          # Cek status semua service
.\scripts\check-local-dev.ps1 -IncludeLogTail -Json  # Status + log tail JSON
.\scripts\restart-local-service.ps1 -Name <service> -RunMigrate  # Restart satu service
.\scripts\tail-service-log.ps1 -Name <service>  # Lihat log service
```

## Akun Seed

| Role | Username | Password |
|---|---|---|
| superadmin | superadmin | GovConnect2026! |
| village_admin | admin_sangreseng | SangresengAde2026! |

Desa seed: Desa Sanreseng Ade (slug: `desa-sanreseng-ade`)

## Internal API Key

`govconnect-internal-api-key-2025` — header: `x-api-key`

## Database

`postgresql://govconnect:dbgovconnect2026@127.0.0.1:5432/govconnect`

Schema per service: `channel`, `ai`, `cases`, `notification`, `dashboard`

## Testing

Untuk testing, gunakan commands:
- `/testing-prd` — buat PRD testing lengkap sebelum mulai
- `/testing-session-1` — jalankan TC ganjil (session 1)
- `/testing-session-2` — jalankan TC genap (session 2)
- `/testing-continue` — lanjutkan testing dari titik terakhir

Dokumen shared testing:
- `docs/testing/TESTING-PRD.md` — PRD dan daftar test case
- `docs/testing/TESTING-STATUS.md` — checklist hasil testing (diedit kedua session)

## Konvensi Kode

- TypeScript strict di semua service
- Prisma ORM untuk database
- Express.js untuk backend services
- Next.js App Router untuk dashboard
- RabbitMQ untuk event-driven communication
- Village scoping wajib: semua data harus scoped ke `village_id`
- DB-first: database adalah sumber kebenaran, KB/RAG hanya pelengkap
