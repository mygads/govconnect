# Batas Operasional GovConnect

Dokumen ini mencatat batas operasional yang diketahui — bukan bug, tapi
trade-off desain yang perlu ditangani sebelum production multi-instance.

## W8: Rate Limit In-Memory (Tidak Fleet-Safe)

**Lokasi:**
- `govconnect-ai-service/src/pipeline/ingress-guard.ts` — `checkRateLimit()` (sliding window per tenant+user)
- `govconnect-ai-service/src/services/rate-limiter.service.ts` — rate limit laporan harian
- `govconnect-channel-service/src/middleware/webhook-rate-limit.middleware.ts` — rate limit webhook WhatsApp (W8)

**Batas:** Counter bersifat in-memory per process (`Map`).
- Pada deployment single-instance: berfungsi penuh.
- Pada deployment multi-instance (fleet): setiap instance punya counter sendiri,
  sehingga batas efektif = `batas_konfigurasi × jumlah_instance`.
  Penyerang dapat mem-bypass dengan menyebar request ke banyak instance.

**Mitigasi saat ini:**
- Pelanggaran rate limit dicatat ke audit trail (ai-service), sehingga fleet
  tetap melihat gambaran penuh secara asinkron.
- Fail-open: jika guard error, pesan tetap diproses (jangan matikan desa).

**Rencana production:** Ganti dengan Redis terdistribusi:
- Sliding window via Lua script atomik, atau
- Token bucket via `Redlock`/Redis Cell (`CL.THROTTLE`).
- Key: `{tenant}:{user}` dengan TTL = window.

**Status:** BELUM diimplementasikan (disengaja — butuh infrastruktur Redis).

## W4: Takeover State Machine

**Lokasi:** `govconnect-ai-service/src/pipeline/takeover.ts`

**Batas:**
- Transisi state (HANDOFF_PENDING timeout, NUDGE, auto-handback) dievaluasi
  secara lazy saat `getTakeover()` dipanggil — tanpa cron.
- `findTakeoversNeedingNudge()` tersedia untuk cron/proaktif, tapi cron-nya
  sendiri belum dijadwalkan. Jika butuh notifikasi nudge proaktif ke admin,
  tambahkan cron yang memanggil fungsi ini (mis. tiap 5 menit).

## Catatan Umum

- Semua batas di atas TIDAK menghalangi testing lokal single-instance.
- Sebelum production: selesaikan Redis untuk rate limit + cron untuk nudge.
