# Audit Tambahan Lintas Service: Channel, Public Form, Delivery, dan Boundary Internal

Tanggal audit: 2026-05-11

Dokumen ini sengaja mengaudit area yang berbeda dari audit sebelumnya. Fokusnya bukan lagi kategori pengaduan, kontak penting DB-first, dan agent tool utama, tetapi area pendukung lintas service:

- Channel service webhook, batching, media, delivery callback, takeover.
- Public form dan service request flow.
- Notification template dan status delivery lifecycle.
- Dashboard public API proxy dan boundary internal API key.
- Dead/redundant code yang terlihat di area channel/public flow.

Audit ini berdasarkan pembacaan kode. Tidak ada implementasi perubahan logic dalam dokumen ini.

## Ringkasan Temuan Baru

Temuan yang berbeda dari audit sebelumnya:

- Webhook POST WhatsApp di channel service tidak terlihat melakukan verifikasi signature/token pada request masuk, hanya GET verification yang punya token check.
- Ada file backup `.bak` di source channel service yang berpotensi ikut terbaca tooling/build/test.
- Media-only WhatsApp message diproses sebagai placeholder `[Image]`, `[Audio]`, `[Sticker]`, dll; kualitas intent bisa turun jika media processing gagal.
- Public service request validation memperlakukan semua value requirement, termasuk `file`, sebagai string tanpa validasi metadata file yang kuat.
- Dashboard public API proxy memakai `INTERNAL_API_KEY || ""`; jika service internal juga misconfigured menerima kosong, boundary internal melemah.
- Public service by slug membaca JSON lalu mencoba membaca body text lagi pada response yang sama; detail error bisa hilang karena body sudah consumed.
- Template notification masih mengandung emoji dan label generik, serta service request message selalu menyebut update via WhatsApp meskipun channel bisa Webchat.
- Delivery callback hanya update `status_notified_at`/`status_delivered_at` untuk `sent/delivered/read`; failed delivery tidak tersimpan di entity status lifecycle selain notification log.
- Public complaint endpoint masih menerima `type_id`/`category_id`, tetapi validasi public route tidak memastikan type/category milik desa sebelum meneruskan ke case service.

## 1. Webhook POST WhatsApp Tidak Terlihat Memverifikasi Signature/Token

Referensi:

- `govconnect-channel-service/src/controllers/webhook.controller.ts:602-997`
- `govconnect-channel-service/src/controllers/webhook.controller.ts:1241-1276`

`verifyWebhook` untuk GET memiliki validasi `WA_WEBHOOK_VERIFY_TOKEN`, dan di production akan error jika token kosong. Namun handler POST `handleWebhook` langsung parse body dan proses payload. Dari file yang dibaca, tidak terlihat pengecekan header signature, shared secret, atau token untuk POST webhook.

Dampak:

- Jika endpoint webhook terekspos publik, pihak luar bisa mencoba mengirim payload palsu.
- Payload palsu bisa membuat pesan masuk tercatat, memicu AI, atau mengubah status session/delivery jika format cocok.
- Ini boundary security, bukan hanya bug logic.

Rekomendasi:

- Tambahkan verifikasi POST webhook: shared secret header, HMAC signature, atau token provider.
- Tolak payload POST tanpa validasi di production.
- Log percobaan invalid tanpa menyimpan message.
- Pastikan Cloudflare/tunnel path tidak menjadi satu-satunya kontrol keamanan.

## 2. File Backup `.bak` Masih Ada di Source

Referensi:

- `govconnect-channel-service/src/services/message-batcher.service.ts.bak`

File backup `.bak` berada di bawah `src/services`. Walaupun TypeScript biasanya tidak compile `.bak`, file ini tetap masuk repo/source tree dan bisa:

- Terindeks search/tooling.
- Membingungkan audit dan reviewer.
- Tidak sengaja dibaca oleh script custom.
- Mengandung logic lama yang dianggap masih aktif.

Rekomendasi:

- Verifikasi isi `.bak` apakah masih dibutuhkan.
- Jika tidak dibutuhkan, hapus dari repo dan pastikan `.gitignore` mencegah file backup serupa.
- Jika dibutuhkan untuk referensi, pindahkan ke docs/archive dengan konteks jelas.

## 3. Media-Only Message Bergantung pada Placeholder Jika Media Processing Gagal

Referensi:

- `govconnect-channel-service/src/controllers/webhook.controller.ts:837-856`
- `govconnect-channel-service/src/controllers/webhook.controller.ts:905-915`
- `govconnect-channel-service/src/controllers/webhook.controller.ts:1153-1170`

Jika pesan media tidak punya caption, parser mengisi text seperti:

- `[Image]`
- `[Video]`
- `[Audio]`
- `[Document]`
- `[Sticker]`

Media diproses non-blocking via promise, lalu ditunggu sebelum batching. Jika media processing gagal, flow tetap lanjut tanpa media URL.

Dampak:

- AI bisa hanya menerima `[Image]` tanpa konteks, lalu salah menjawab atau meminta ulang.
- Untuk pengaduan warga yang mengirim foto lokasi tanpa caption, informasi visual bisa hilang jika upload/processing gagal.
- Jika audio/voice gagal diproses, agent tidak punya transkrip dan bisa memberi jawaban generic.

Rekomendasi:

- Jika media-only dan media processing gagal, jangan teruskan ke AI sebagai `[Image]` saja; balas fallback yang jelas: “foto belum berhasil diproses, mohon kirim ulang atau tambahkan keterangan”.
- Bedakan image/video/audio/document/sticker handling.
- Untuk audio, pastikan ada pipeline transkripsi atau fallback spesifik.
- Simpan media processing error di message metadata agar RCA mudah.

## 4. Message Action dan System Activity Bisa Memakai Message ID Provider Langsung

Referensi:

- `govconnect-channel-service/src/controllers/webhook.controller.ts:711-764`
- `govconnect-channel-service/src/controllers/webhook.controller.ts:123-160`

Untuk reaction/edit/delete, service menyimpan livechat system activity memakai `messageId` provider. Duplicate check memakai `checkDuplicateMessage(messageId)`.

Risiko:

- Jika provider memakai ID sama untuk event berbeda atau action terhadap message yang sama, activity bisa dianggap duplicate dan tidak tercatat.
- Sebagian system activity lain sudah memakai prefixed ID seperti `system-delivery-${status}-${messageId}`; message action belum selalu memakai prefix.

Rekomendasi:

- Gunakan message id sintetis untuk system activity: `system-action-${kind}-${messageId}`.
- Simpan provider message id di metadata.
- Hindari collision antara real user message dan system activity.

## 5. Channel Disabled Masih Menyimpan Pesan Sebelum Skip AI

Referensi:

- `govconnect-channel-service/src/controllers/webhook.controller.ts:858-925`

Flow saat WA disabled:

1. Spam guard.
2. Save incoming message.
3. Update conversation.
4. Process media.
5. Cek `isWaChannelEnabled`.
6. Skip AI.

Dampak:

- Pesan tetap masuk history meski channel disabled.
- Ini bisa benar untuk audit, tapi perlu keputusan produk: disabled artinya “tidak menerima sama sekali” atau “terima tapi jangan AI”.
- Jika disabled untuk maintenance/privacy, menyimpan pesan mungkin tidak diharapkan.

Rekomendasi:

- Definisikan semantics `enabled_wa=false`.
- Jika disabled total, cek sebelum save DB.
- Jika disabled hanya AI, ubah label/UI menjadi “AI disabled, chat tetap tercatat”.

## 6. Public Service Request File Field Hanya Divalidasi Sebagai String

Referensi:

- `govconnect-case-service/src/services/service-request-schema.service.ts:3`
- `govconnect-case-service/src/services/service-request-schema.service.ts:248-252`
- `govconnect-case-service/src/services/service-request-schema.service.ts:323-337`

Schema mendukung `field_type: 'file'`, tetapi validasi payload menormalisasi semua value menjadi string. Tidak terlihat validasi file metadata seperti storage key, signed URL, MIME type, size, dan ownership upload.

Dampak:

- Field file bisa diisi string apapun selama non-empty.
- Potensi link eksternal atau URL tidak valid masuk ke `requirement_data_json`.
- Admin bisa melihat data file yang tidak benar-benar berasal dari upload resmi.

Rekomendasi:

- Untuk field `file`, validasi format value sebagai upload token/storage key resmi.
- Cross-check file berada di storage service dan village/service yang sama.
- Simpan metadata file terstruktur, bukan string polos: `url`, `storage_key`, `file_name`, `mime_type`, `size`.
- Batasi MIME dan ukuran sesuai policy.

## 7. Public Service By Slug Membaca Body Dua Kali

Referensi:

- `govconnect-dashboard/app/api/public/services/by-slug/route.ts:52-64`

Kode melakukan:

```ts
const payload = await safeReadJson(response);
const lastErrorStatus = response.status;
const lastErrorDetail = response.ok ? null : await response.text().catch(() => null);
```

Jika `safeReadJson(response)` sudah membaca body, `response.text()` berikutnya biasanya tidak bisa membaca ulang body.

Dampak:

- Detail error dari case service bisa hilang.
- Debug public form gagal menjadi lebih sulit.

Rekomendasi:

- Baca response sebagai text sekali, lalu parse JSON dari text.
- Gunakan helper shared untuk proxy response.

## 8. Public API Proxy Memakai Internal API Key Default Kosong

Referensi:

- `govconnect-dashboard/app/api/public/service-requests/route.ts:4-6`
- `govconnect-dashboard/app/api/public/complaints/route.ts:4-5`
- `govconnect-dashboard/app/api/public/services/by-slug/route.ts:4-6`
- hasil grep juga menunjukkan pola serupa di public complaints check/cancel/update.

Beberapa route public dashboard memakai:

```ts
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";
```

Lalu meneruskan header:

```ts
"x-internal-api-key": INTERNAL_API_KEY
```

Dampak:

- Jika dashboard env kosong dan service internal juga salah konfigurasi menerima kosong, public endpoint dapat meneruskan request sebagai internal.
- Meski service internal seharusnya menolak kosong, route publik tidak fail-fast saat konfigurasi critical kosong.
- Sulit membedakan salah konfigurasi dengan error downstream.

Rekomendasi:

- Public proxy harus fail-fast 500 jika `INTERNAL_API_KEY` kosong.
- Internal service auth harus menolak empty key walaupun env kosong di production.
- Tambahkan startup config validation.
- Jangan gunakan fallback kosong untuk secret.

## 9. Public Complaint Route Meneruskan `type_id` dan `category_id` Tanpa Validasi Lokal

Referensi:

- `govconnect-dashboard/app/api/public/complaints/route.ts:31-32`
- `govconnect-dashboard/app/api/public/complaints/route.ts:121-130`

Route public menerima `type_id` dan `category_id`, lalu meneruskan ke case service. Case service memang punya authoritative resolution, tetapi route public sendiri tidak memvalidasi bahwa type/category milik `village_id` sebelum forwarding.

Dampak:

- Beban validasi sepenuhnya ada di case service.
- Jika endpoint case lama/alternate tidak strict, bisa terjadi mismatch data.
- Error untuk user public bisa kurang spesifik.

Rekomendasi:

- Tetap jadikan case service authority, tapi dashboard public proxy bisa melakukan preflight minimal untuk UX.
- Pastikan case endpoint create complaint menolak `type_id/category_id` beda village.
- Tambahkan test public route dengan `type_id` dari desa lain.

## 10. Service Request Public Form Sudah Memblokir Offline, Tetapi Mode Naming Perlu Konsisten

Referensi:

- `govconnect-case-service/src/controllers/service-catalog.controller.ts:820-823`
- `govconnect-case-service/src/services/service-request-schema.service.ts:231-235`

`buildServiceRequestSchema` menentukan:

```ts
allowsPublicSubmission: (service.mode || 'both') !== 'offline'
```

Create service request menolak jika tidak allow public submission.

Ini sudah benar untuk kebutuhan layanan online/offline/both.

Gap:

- Jika mode invalid tersimpan di DB, schema akan menganggap non-offline sebagai allow public submission.
- Tidak terlihat enum DB untuk mode; field `mode` string bebas.

Rekomendasi:

- Tambahkan validation di create/update service item untuk hanya menerima `online|offline|both`.
- Tambahkan DB check constraint jika memungkinkan.
- Jika mode invalid, default aman sebaiknya `offline`, bukan allow.

## 11. Notification Template Kurang Channel-Aware

Referensi:

- `govconnect-notification-service/src/services/template.service.ts:21-31`
- `govconnect-notification-service/src/handlers/event.handler.ts:118-140`

Template service request selalu menyebut:

```txt
Anda akan mendapat update status melalui WhatsApp ini.
```

Padahal event mendukung `channel: WHATSAPP | WEBCHAT`, dan notification service bisa kirim ke Webchat.

Dampak:

- User webchat bisa menerima pesan yang menyebut WhatsApp.
- UX terasa tidak konsisten lintas channel.

Rekomendasi:

- Template menerima channel dan menyesuaikan teks.
- Untuk webchat gunakan “melalui percakapan ini”.
- Untuk WhatsApp gunakan “melalui WhatsApp ini”.

## 12. Notification Template Masih Menggunakan Emoji

Referensi:

- `govconnect-notification-service/src/services/template.service.ts:13-18`
- `govconnect-notification-service/src/services/template.service.ts:25-30`
- `govconnect-notification-service/src/services/template.service.ts:57-87`
- `govconnect-notification-service/src/services/template.service.ts:121-138`

Template memakai emoji seperti `✅`, `🎫`, `🔄`, `🚨`, `📎`, `⚠️`.

Dampak:

- Ini bukan bug fungsional, tapi untuk layanan pemerintahan formal bisa perlu mode formal tanpa emoji.
- Jika channel tertentu tidak render emoji baik, pesan terlihat tidak profesional.

Rekomendasi:

- Tambahkan village/channel template style: formal vs friendly.
- Jangan hardcode emoji jika desa ingin tone resmi.
- Gunakan template configurable di DB atau behavior config.

## 13. Delivery Callback Tidak Mencatat Failed ke Entity Lifecycle

Referensi:

- `govconnect-case-service/src/controllers/internal.controller.ts:34-56`
- `govconnect-case-service/src/controllers/internal.controller.ts:89-161`
- `govconnect-notification-service/src/services/notification.service.ts:229-255`

Jika delivery status `failed`, `buildDeliveryUpdateData` hanya set `last_delivery_message_id` bila ada, tidak ada field entity untuk last delivery failure.

Dampak:

- Entity complaint/service request tidak tahu status update gagal dikirim kecuali melihat notification log.
- Dashboard entity detail mungkin tidak bisa menampilkan “notifikasi gagal terkirim”.
- Operator bisa mengira status sudah dikomunikasikan padahal failed.

Rekomendasi:

- Tambahkan field entity atau join view untuk last notification status.
- Minimal dashboard detail harus query notification log by reference number.
- Pertimbangkan `last_delivery_status`, `last_delivery_error`, `last_delivery_attempt_at` di case schema.

## 14. Delivery Callback Hanya Infer `LAY-` untuk Service Request

Referensi:

- `govconnect-case-service/src/controllers/internal.controller.ts:8-16`

```ts
if (referenceNumber.startsWith('LAP-')) return 'complaint';
if (referenceNumber.startsWith('LAY-')) return 'service_request';
```

Di AI tool reference inference juga mengenali `TIK`, `LYN`, `RPT` sebagai service request di tempat lain. Jika format service request berkembang, delivery callback bisa gagal infer entity type.

Dampak:

- Delivery callback untuk prefix layanan lain bisa ditolak jika `entity_type` tidak dikirim.
- Inconsistency lintas service dalam daftar prefix reference.

Rekomendasi:

- Centralize reference prefix parsing di shared utility.
- Notification service sebaiknya selalu mengirim `entity_type`.
- Case callback tetap support semua prefix valid.

## 15. Public Form Proxy Tidak Menambahkan Timeout

Referensi:

- `govconnect-dashboard/app/api/public/service-requests/route.ts:104-124`
- `govconnect-dashboard/app/api/public/complaints/route.ts:115-141`
- `govconnect-dashboard/app/api/public/services/by-slug/route.ts:46-50`

Fetch ke internal service tidak terlihat memakai timeout/AbortSignal.

Dampak:

- Public form bisa menggantung lama jika case/channel service lambat.
- User bisa submit berulang dan membuat risiko duplicate submission jika retry manual.

Rekomendasi:

- Gunakan shared `apiFetch` dengan timeout.
- Tambahkan idempotency key untuk public service request submission.
- UI disable submit + retry state sudah perlu dipastikan.

## 16. Service Request Creation Tidak Terlihat Punya Idempotency Key

Referensi:

- `govconnect-case-service/src/controllers/service-catalog.controller.ts:852-887`
- `govconnect-dashboard/app/api/public/service-requests/route.ts:104-124`

Setiap POST create service request generate request number baru. Tidak terlihat idempotency key dari frontend/public form.

Dampak:

- User double-click atau network retry bisa membuat permohonan ganda.
- WhatsApp/webchat flow yang mengirim form bisa menghasilkan duplicate jika user submit ulang.

Rekomendasi:

- Tambahkan idempotency key dari frontend per form load/session.
- Case service simpan idempotency key per user/service/village.
- Untuk duplicate within time window, return request existing.

## 17. Service Request History Tidak Mengecualikan Soft Deleted

Referensi:

- `govconnect-case-service/src/controllers/service-catalog.controller.ts:1391-1399`

`handleGetServiceHistory` query service request by user/village, tetapi tidak terlihat filter `deleted_at: null`.

Dampak:

- Riwayat user bisa menampilkan permohonan yang sudah diarsipkan/soft-deleted oleh admin.
- Endpoint list admin biasa sudah memfilter `deleted_at: null`, tetapi history user tidak.

Rekomendasi:

- Tambahkan `deleted_at: null` pada user history kecuali ada kebutuhan khusus menampilkan arsip.
- Jika tetap ditampilkan, label harus jelas “diarsipkan”.

## 18. Get Service Request By ID Hanya `findUnique` by DB id, Bukan Request Number

Referensi:

- `govconnect-case-service/src/controllers/service-catalog.controller.ts:894-918`

Handler `handleGetServiceRequestById` memakai:

```ts
const data = await prisma.serviceRequest.findUnique({ where: { id } })
```

Handler lain seperti update/status memakai `OR: [{ id }, { request_number: id }]`.

Dampak:

- API detail by id tidak konsisten dengan endpoint lain.
- Jika dashboard/user mengirim `request_number`, endpoint detail bisa 404 meskipun data ada.

Rekomendasi:

- Samakan lookup: support DB id dan `request_number`.
- Tambahkan test detail service request by `LAY-...`.

## 19. Public Complaint Foto Array Disimpan Sebagai JSON String ke `foto_url`

Referensi:

- `govconnect-dashboard/app/api/public/complaints/route.ts:127`

```ts
foto_url: Array.isArray(foto_url) ? JSON.stringify(foto_url) : foto_url
```

Schema complaint `foto_url` adalah string tunggal.

Dampak:

- Konsumen downstream mungkin mengira `foto_url` adalah URL tunggal, padahal berisi JSON array string.
- UI/detail/AI bisa menampilkan mentah atau gagal parse.

Rekomendasi:

- Buat model attachment/media terpisah untuk banyak foto.
- Jika belum, batasi satu foto atau gunakan field `attachments_json`.
- Jangan overload `foto_url` dengan JSON string tanpa kontrak jelas.

## 20. Banyak Public Route Menggunakan `console.error`

Referensi:

- `govconnect-dashboard/app/api/public/service-requests/route.ts:149`
- `govconnect-dashboard/app/api/public/complaints/route.ts:166`
- `govconnect-dashboard/app/api/public/services/by-slug/route.ts:116`

Ini bukan bug utama, tetapi observability lintas service lebih baik jika memakai logger/correlation id.

Rekomendasi:

- Gunakan logger shared yang menyertakan request id/correlation id.
- Jangan log PII penuh dari public form.

## Prioritas Perbaikan

### P0 - Security boundary

- Tambahkan verifikasi POST webhook WhatsApp.
- Fail-fast jika `INTERNAL_API_KEY` kosong pada public proxy.
- Pastikan internal services menolak empty API key di production.

### P1 - Data correctness

- Validasi file requirement sebagai upload resmi, bukan string bebas.
- Tambahkan idempotency key untuk public service request.
- Tambahkan `deleted_at: null` pada service history user.
- Samakan lookup service request detail agar support request number.

### P2 - Delivery lifecycle

- Simpan failed delivery status/error agar dashboard bisa menampilkan notifikasi gagal.
- Centralize reference prefix parser.
- Kirim `entity_type` eksplisit dari notification service.

### P3 - UX lintas channel

- Template notification harus channel-aware.
- Tambahkan mode template formal/friendly per desa.
- Media-only failure harus diberi fallback jelas.

### P4 - Cleanup

- Hapus/pindahkan `.bak` dari source.
- Ganti `console.error` public route dengan logger shared.
- Audit semua `INTERNAL_API_KEY || ""` di route publik.

## Checklist Validasi Setelah Fix

- POST webhook tanpa signature/token ditolak di production.
- Public form gagal cepat jika internal API key belum dikonfigurasi.
- Submit layanan dengan file palsu/string arbitrary ditolak.
- Double submit form layanan mengembalikan request yang sama atau dicegah.
- User history tidak menampilkan service request soft-deleted kecuali diberi label.
- Detail service request bisa dibuka dengan DB id dan `LAY-...` jika route memang dimaksud demikian.
- Webchat notification tidak menyebut “WhatsApp ini”.
- Delivery failed tampil di dashboard entity detail atau notification panel.
- Media-only image yang gagal diproses tidak diteruskan ke AI sebagai `[Image]` tanpa konteks.
- `.bak` tidak ada di `src`.

## Kesimpulan

Audit tambahan ini menemukan risiko berbeda dari audit DB-first agent sebelumnya. Area paling penting adalah webhook POST authentication, hardening public proxy secret, validasi file requirement, idempotency public form, dan delivery lifecycle untuk failed notification. Perbaikan area ini akan membuat sistem lebih aman dan konsisten sebelum fokus kembali ke kualitas agent dan KB.
