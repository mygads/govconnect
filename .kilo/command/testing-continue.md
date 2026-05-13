---
description: Lanjutkan testing GovConnect dari titik terakhir yang belum selesai
---

Baca skill `govconnect-testing`, `govconnect-services`, dan `govconnect-api-testing` terlebih dahulu.

## Langkah Awal

1. Baca `docs/testing/TESTING-STATUS.md` untuk melihat TC mana yang sudah selesai dan mana yang belum
2. Baca `docs/testing/TESTING-PRD.md` untuk detail TC yang belum selesai
3. Cek status semua service: `.\scripts\check-local-dev.ps1 -IncludeLogTail`
4. Restart service yang tidak healthy sebelum lanjut

## Aturan

- Lanjutkan dari TC yang belum di-check (masih `- [ ]`)
- Jika kamu session-1, ambil TC ganjil yang belum selesai
- Jika kamu session-2, ambil TC genap yang belum selesai
- Update TESTING-STATUS.md setelah setiap TC
- Jangan stop sampai semua TC yang menjadi tanggung jawabmu selesai

Mulai sekarang dari TC yang belum selesai.
