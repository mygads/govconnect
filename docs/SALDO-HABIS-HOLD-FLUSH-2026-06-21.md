# Saldo Habis → Hold & Flush Pesan Tertunda

**Status:** Implemented 2026-06-21
**Services:** ai-service, channel-service, dashboard

## Masalah lama

Saat saldo AI desa habis, gate wallet (`canProcessVillageAI`) menolak pesan dan
mengirim balasan keras ke warga:

> "Maaf, saldo AI desa sedang habis. Silakan hubungi admin desa untuk mengisi
> saldo agar layanan AI bisa digunakan kembali."

Pesan asli warga **hilang** — tidak pernah dijawab meski admin topup kemudian.

## Perilaku baru

Saat saldo habis dan warga **tidak** secara eksplisit minta bantuan manusia:

1. Pesan warga **ditahan** (tidak ada balasan dikirim — silent hold).
2. Percakapan ditandai `ai_status='pending_balance'` (terlihat di dashboard).
3. Setelah admin topup, admin menekan tombol flush:
   - **Kirim Semua Tertunda** — semua warga di desa itu.
   - **Kirim Warga Ini** — satu percakapan saja (expand badge "Pesan Tertunda").
4. Pesan diproses ulang AI secara penuh (LLM + RAG + tools) dan dikirim ke warga.

Jika warga eksplisit minta manusia (mis. "mau ngomong sama petugas") saat saldo
habis, perilaku lama tetap: auto-handoff ke takeover.

## Alur teknis

### Hold (saat saldo habis)
- `unified-message-processor.service.ts` wallet gate → `holdMessageForWallet()`
  (`held-message-client.service.ts`) → POST `channel-service /internal/held-messages/hold`.
- Intent yang dikembalikan: `AI_BALANCE_HELD`, `response: ''` (kosong).
- Tidak hold saat `isEvaluation` / `sideEffectMode='knowledge_test'`.

### Suppress balasan
- WhatsApp: `ai-orchestrator.service.ts` — intent `AI_BALANCE_HELD` → tidak publish reply.
- Webchat: `webchat.routes.ts` POST handler — intent `AI_BALANCE_HELD` → `response:''`,
  set `pending_balance`, tidak simpan pesan OUT.

### Store
- Tabel baru `held_messages` (schema `channel`), migration
  `20260621020000_add_held_messages`. Idempotent on `message_id`.
- Service: `held-message.service.ts` (channel-service).

### Flush
- Dashboard → `POST /api/superadmin/ai-wallets/[villageId]/held-messages/flush`
  (body kosong = semua desa; `{channel_identifier}` = per-warga).
- channel-service `held-message.controller.ts` → `flushConversation()`:
  - **WhatsApp**: re-publish `whatsapp.message.received` ke RabbitMQ (consumer AI biasa), lalu hapus held row.
  - **Webchat**: POST ke ai-service `/api/webchat/internal/flush-held-webchat`,
    yang menjalankan agent per pesan dan POST balik ke channel-service
    `/internal/held-messages/deliver-webchat` (persist + livechat SSE `actor:'ai'` + hapus held row).
- Webchat SSE forwarder (`webchat.routes.ts GET /:session_id/events`) diperlebar
  untuk meneruskan pesan `actor:'ai'` ke browser (sebelumnya hanya `source:'ADMIN'`).

## Endpoint channel-service (internal)
- `POST /internal/held-messages/hold`
- `GET  /internal/held-messages?channel_identifier=`
- `GET  /internal/held-messages/conversations`
- `POST /internal/held-messages/flush?channel_identifier=`
- `POST /internal/held-messages/flush-all`
- `POST /internal/held-messages/deliver-webchat`

## Catatan / batasan
- Pengiriman SSE webchat bersifat best-effort; jaminan durabilitas ada di
  persistensi pesan (muncul di history saat reload + dashboard live chat).
- Tidak ada auto-flush saat topup (sesuai keputusan: flush manual via 2 tombol).
- Held rows dihapus setelah berhasil di-flush; tidak ada cleanup 24 jam (beda
  dari `pending_messages` yang merupakan antrian retry AI).
