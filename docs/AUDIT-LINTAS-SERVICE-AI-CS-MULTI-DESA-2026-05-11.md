# Audit Lintas Service: Multi-Desa, DB-First, AI Agent CS, dan Redundansi

Tanggal audit: 2026-05-11

Dokumen ini hanya mencatat temuan yang didukung langsung oleh kode yang terbaca di repo saat audit ini dilakukan. Jika suatu area belum cukup bukti, area itu tidak ditulis sebagai bug.

## Scope yang diperiksa

- `govconnect-ai-service`
- `govconnect-case-service`
- `govconnect-dashboard`
- `govconnect-channel-service`
- `govconnect-notification-service`

Fokus audit:

- konsistensi source of truth per-desa
- prioritas DB/tool resmi di atas KB
- perilaku agent agar tidak terasa seperti bot/template
- gap lintas service pada complaint, important contacts, emergency, service request, dan public form
- kandidat dead code / redundansi yang high-confidence

## Ringkasan Eksekutif

Fondasi inti sistem sudah jauh lebih benar dibanding batch awal:

- AI reply selection sudah trust-aware, bukan lagi last-tool-wins.
- Answer policy sudah memblok jawaban fakta terstruktur yang tidak grounded ke tool resmi.
- Internal important contacts sudah benar-benar village-scoped dan mewajibkan `village_id`.
- Notification untuk complaint important contacts sudah punya dedupe dan skip logging yang jelas.
- Public service form create/edit sudah satu kontrak untuk citizen fields dan requirement fields, termasuk file upload terstruktur.

Tetapi masih ada gap nyata yang tersisa:

1. `ServiceRequest.village_id` masih nullable di schema, padahal ini entitas warga-facing multi-desa.
2. Channel-service masih punya fallback `village_id='unknown'` dan history query yang bisa jalan tanpa filter desa.
3. Jalur event `complaint.created` sudah tidak diproduksi lagi, tetapi consumer/handler/config-nya masih hidup di service lain.
4. Public complaint proxy masih menduplikasi logic channel/identity validation di beberapa route.
5. Tool contract `update_complaint` di AI masih terlalu rigid karena memaksa semua field patch sebagai required.

## Temuan yang Sudah Benar / Kekuatan yang Sudah Ada

### 1. AI precedence sudah DB-first dan trust-aware

Referensi:

- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:123-214`
- `govconnect-ai-service/src/services/answer-policy.service.ts:395-446`

Bukti:

- `TOOL_REPLY_BASE_PRIORITY` dan `TOOL_REPLY_TRUST_PRIORITY` sudah dipakai untuk memilih reply tool berdasarkan prioritas sumber dan trust, bukan sekadar urutan terakhir.
- `answer-policy` sudah menolak service detail dan village profile yang tidak grounded via tool resmi.

Implikasi:

- Ini sudah sesuai dengan prinsip DB/tool resmi dulu, KB belakangan.
- Risiko KB menimpa fakta resmi sudah jauh berkurang.

### 2. Important contacts internal API sudah village-scoped

Referensi:

- `govconnect-dashboard/app/api/internal/important-contacts/route.ts:55-91`

Bukti:

- Endpoint mewajibkan `village_id`.
- Query category dan contact sama-sama dibatasi ke `village_id` tersebut.

Implikasi:

- Kontak penting per desa sudah tidak bercampur secara default.

### 3. Complaint important contacts notification sudah punya dedupe

Referensi:

- `govconnect-notification-service/src/services/notification.service.ts:177-233`

Bukti:

- Notification service mengecek apakah notifikasi `complaint_important_contacts` untuk complaint yang sama sudah pernah selesai dikirim/skipped.
- Jika kontak tidak ada, sistem menulis log skip yang eksplisit.

Implikasi:

- Jalur auto-send kontak penting sudah tidak buta-duplikasi.
- Jika data resmi tidak ada, sistem gagal dengan jujur, bukan mengarang.

## Gap / Error yang Masih Tersisa

### 1. `ServiceRequest.village_id` masih nullable di schema

Referensi:

- `govconnect-case-service/prisma/schema.prisma:197-241`

Bukti:

```prisma
model ServiceRequest {
  ...
  village_id            String?
  ...
}
```

Dampak:

- Complaint sudah menjadikan desa sebagai atribut wajib, tetapi service request belum setegas itu di level schema.
- Secara runtime memang banyak path yang mengisi `service.village_id`, tetapi schema masih mengizinkan data service request tanpa desa.
- Ini membuat batas tenant untuk service request masih lebih lemah dibanding complaint.

Prioritas:

- Tinggi untuk konsistensi multi-desa.

### 2. Channel-service masih punya fallback `village_id = 'unknown'`

Referensi:

- `govconnect-channel-service/src/services/message.service.ts:82-84`

Bukti:

```ts
function resolveVillageId(villageId?: string): string {
  return villageId || 'unknown';
}
```

Dampak:

- Message bisa tersimpan dengan tenant sintetis `unknown` alih-alih gagal tertahan.
- Untuk sistem multi-desa yang menuntut source-of-truth per desa, fallback ini terlalu longgar.
- Jika ada jalur yang lupa mengirim `village_id`, error tenant bisa tersamarkan menjadi data valid palsu.

Prioritas:

- Tinggi.

### 3. Message history di channel-service masih boleh tanpa scope desa

Referensi:

- `govconnect-channel-service/src/services/message.service.ts:318-327`

Bukti:

```ts
const resolvedVillageId = village_id ? resolveVillageId(village_id) : undefined;
const where: any = { channel, channel_identifier };
if (resolvedVillageId) {
  where.village_id = resolvedVillageId;
}
```

Dampak:

- Jika caller tidak mengirim `village_id`, query hanya dibatasi oleh `channel` dan `channel_identifier`.
- Itu berarti tenant boundary untuk history masih conditional, bukan fail-closed.
- Ini tidak otomatis bug eksploitabel tanpa path pemanggil yang salah, tetapi boundary-nya masih lemah.

Prioritas:

- Tinggi.

### 4. Jalur `complaint.created` sudah tidak diproduksi, tetapi consumer/handler/config masih hidup

Referensi:

- `govconnect-case-service/src/services/complaint.service.ts:343-345`
- `govconnect-notification-service/src/handlers/event.handler.ts:49-55`

Bukti:

Case service menulis jelas bahwa event ini sudah tidak dipublish lagi:

```ts
// NOTE: We don't publish COMPLAINT_CREATED event anymore because AI Service
// already sends the response to user via publishAIReply.
// would cause double response to the user.
```

Tetapi notification service masih menyimpan handler kompatibilitas lama:

```ts
case RABBITMQ_CONFIG.routingKeys.complaintCreated:
  await handleComplaintCreated(data as ComplaintCreatedEvent);
  break;
```

Dampak:

- Ini dead path / stale path yang membingungkan audit berikutnya.
- Template/helper terkait complaint-created berpotensi hanya hidup untuk flow yang sudah dimatikan.
- Ini menambah noise saat reasoning lintas service dan memperbesar peluang regression saat orang mengira event ini masih aktif.

Prioritas:

- Menengah.

### 5. Public complaint routes masih menduplikasi logic channel/identity validation

Referensi:

- `govconnect-dashboard/app/api/public/complaints/route.ts:6-115`
- `govconnect-dashboard/app/api/public/complaints/[id]/update/route.ts:6-109`

Bukti:

Di kedua route ini masih ada blok yang hampir sama untuk:

- `isValidWaNumber(...)`
- `normalizeChannel(...)`
- resolusi `channel_identifier/session_id/sessionId`
- validasi konflik WhatsApp vs Webchat
- validasi nomor WA

Dampak:

- Risiko drift antar endpoint complaint public masih ada.
- Jika satu route dibenerin dan route lain lupa ikut, boundary UI/BE bisa pecah lagi.
- Ini lebih ke redundancy risk daripada bug runtime saat ini, tetapi jelas kandidat refactor bersama.

Prioritas:

- Menengah.

### 6. Tool contract `update_complaint` masih terlalu rigid untuk agent yang ingin terasa natural

Referensi:

- `govconnect-ai-service/src/services/agent/tool-definitions.ts:248-276`

Bukti:

```ts
required: ['reference_number', 'alamat', 'deskripsi', 'rt_rw']
```

Padahal tiga field patch itu sendiri didefinisikan sebagai `string | null`.

Dampak:

- Agent dipaksa selalu mengisi semua field patch saat mau update complaint.
- Ini membuat pengalaman terasa seperti form bot, bukan CS manusia yang bisa menerima patch parsial seperti “tolong update RT/RW saja”.
- Walaupun bisa diisi `null`, kontrak tool tetap kaku dan mendorong slot-filling yang tidak natural.

Prioritas:

- Menengah-tinggi untuk kualitas AI agent.

## Kandidat Dead Code / Redundansi High-Confidence

### 1. Stale compatibility path untuk `complaint.created`

Referensi:

- `govconnect-notification-service/src/handlers/event.handler.ts:49-55`
- `govconnect-case-service/src/services/complaint.service.ts:343-345`

Catatan:

- Ini tidak otomatis berbahaya, tetapi sudah tidak punya producer aktif di case-service.
- Layak dibersihkan atau setidaknya dipindahkan menjadi legacy path yang sangat eksplisit.

### 2. Redundansi validator public complaint route

Referensi:

- `govconnect-dashboard/app/api/public/complaints/route.ts:6-115`
- `govconnect-dashboard/app/api/public/complaints/[id]/update/route.ts:6-109`

Catatan:

- High-confidence duplication.
- Layak dipusatkan ke helper bersama agar boundary WA/webchat tidak drift lagi.

## Implikasi terhadap Target “AI Agent CS Manusia yang Pintar, Adaptif, Tidak Bot”

Dari kode yang sudah ada sekarang, masalah utama bukan lagi “AI tidak punya tool”, melainkan:

1. **Boundary beberapa tempat masih terlalu longgar di sisi tenant scoping**
   - contoh paling nyata: `unknown` village fallback dan conditional village filter di message history.

2. **Sebagian kontrak tool masih terlalu kaku untuk percakapan natural**
   - contoh paling nyata: `update_complaint` memaksa payload lengkap untuk patch yang seharusnya bisa parsial.

3. **Masih ada legacy path yang memperkeruh mental model lintas service**
   - contoh paling nyata: complaint-created event yang sudah dimatikan produsernya tetapi konsumennya masih ada.

Secara arsitektur besar, fondasinya sudah condong ke arah agent yang benar:

- tool surface luas
- DB-first grounding
- anti-halusinasi untuk fakta terstruktur
- village-scoped important contacts
- notification dedupe

Jadi gap tersisa sekarang lebih banyak pada **ketegasan boundary** dan **ergonomi kontrak percakapan**, bukan lagi “AI belum bisa apa-apa”.

## Prioritas Lanjutan yang Paling Masuk Akal

1. Jadikan `ServiceRequest.village_id` wajib di schema dan fail-closed di seluruh path.
2. Hapus fallback tenant `unknown` dan paksa caller mengirim `village_id` untuk jalur message persistence/history yang harus scoped.
3. Rapikan dead path `complaint.created` agar event topology lebih jernih.
4. Satukan helper validasi public complaint route supaya WA/webchat boundary tidak drift.
5. Longgarkan kontrak `update_complaint` menjadi patch-friendly agar agent terasa lebih natural.

## Catatan Penutup

Saya sengaja tidak menandai area lain sebagai bug kalau belum ada bukti kuat dari kode yang terbaca. Untuk audit lanjutan, area yang paling layak didalami berikutnya adalah:

- seluruh fast-path / regex routing sebelum agent penuh
- coverage tool vs kebutuhan CRUD warga/admin yang benar-benar dipakai di produksi
- kandidat dead code tambahan di jalur livechat/channel yang tidak lagi punya producer aktif
- konsistensi uniqueness constraint per-desa untuk data referensi selain yang sudah jelas diverifikasi di audit ini
