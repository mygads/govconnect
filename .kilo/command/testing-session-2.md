---
description: Jalankan testing GovConnect session 2 (test case genap) secara autonomous
---

Baca skill `govconnect-testing`, `govconnect-services`, dan `govconnect-api-testing` terlebih dahulu.

Kamu adalah **Testing Session 2**. Kamu mengerjakan **test case bernomor GENAP** (TC-002, TC-004, TC-006, ...) dari `docs/testing/TESTING-PRD.md`.

## Langkah Awal

1. Baca `docs/testing/TESTING-PRD.md` untuk mendapatkan daftar semua test case
2. Baca `docs/testing/TESTING-STATUS.md` untuk melihat progress terkini
3. Pastikan semua service running dengan `.\scripts\check-local-dev.ps1 -IncludeLogTail`
4. Jika ada service yang tidak running atau error, jalankan `.\scripts\start-local-dev.ps1`
5. Jika ada service yang crash/error setelah start, restart hanya service itu: `.\scripts\restart-local-service.ps1 -Name <service> -RunMigrate`

## Aturan Testing

- Kerjakan HANYA test case bernomor GENAP
- Jangan kerjakan test case yang sudah di-claim session lain di TESTING-STATUS.md
- Setelah setiap test case selesai, langsung update `docs/testing/TESTING-STATUS.md`
- Format update: `- [x] TC-002: <judul> - PASS/FAIL (session-2, 2026-05-12 HH:MM)`
- Jika FAIL, tambahkan detail error di bawahnya: `  - Error: <detail>`
- Jika service error saat testing, perbaiki dulu sebelum lanjut
- Jangan stop sampai semua TC genap selesai

## Alur Jika Service Error

1. Cek log: `.\scripts\tail-service-log.ps1 -Name <service>`
2. Identifikasi error (TypeScript, migration, runtime)
3. Perbaiki kode jika perlu (tsx watch akan auto-reload)
4. Jika perlu restart: `.\scripts\restart-local-service.ps1 -Name <service> -RunMigrate`
5. Tunggu health check hijau
6. Lanjut testing

## Setelah Semua TC Genap Selesai

1. Update `docs/testing/TESTING-STATUS.md` dengan summary session 2
2. Tulis ringkasan: berapa PASS, berapa FAIL, service apa yang bermasalah
3. Jika ada bug ditemukan, catat di bagian "Bugs Found" di TESTING-STATUS.md

Mulai sekarang. Jangan berhenti sampai semua TC genap selesai.
