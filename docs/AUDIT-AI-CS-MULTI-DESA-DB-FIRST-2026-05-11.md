# Audit AI Agent CS, Multi-Desa, DB-First, dan Konsistensi Lintas Service

Tanggal audit: 2026-05-11

Scope audit ini dibuat dari pembacaan kode di repo, bukan asumsi. Area yang diperiksa:

- `govconnect-ai-service`: unified message processor, agent tools, answer policy, kontak penting, consistency checker.
- `govconnect-case-service`: schema complaint/service, create/update/cancel complaint, outbox event.
- `govconnect-dashboard`: schema admin/KB/contact, internal important contacts API, complaint type/category UI/API.
- `govconnect-notification-service`: event handler, notification sending, urgent alert.

Audit ini tidak melakukan implementasi. Dokumen ini mencatat bug, gap, inkonsistensi, risiko halusinasi, dan rekomendasi roadmap agar AI menjadi CS pemerintahan yang lebih adaptif, DB-first, tidak template, dan aman untuk multi-desa.

## Ringkasan Eksekutif

Sistem sudah punya fondasi yang bagus:

- Multi-desa sudah menjadi konsep utama lewat `village_id` di banyak model.
- Complaint type sudah punya konfigurasi resmi per desa: `is_urgent`, `require_address`, `send_important_contacts`, dan `important_contact_category_id`.
- Service catalog sudah dinamis per desa dengan `mode` `online|offline|both`, requirements, dan public form.
- Agent sudah punya tool surface untuk profil desa, layanan, kategori pengaduan, kontak penting, knowledge, dokumen, history, status, cancel, update, dan create.
- Ada guard anti-halusinasi: answer policy, DB-vs-RAG reconciler, knowledge consistency pipeline, tool traces, dan stuck-user tracker.

Namun masih ada bug/gap penting:

- Ada mismatch pemanggilan fungsi update/cancel complaint dari AI tool terhadap signature case service.
- Auto-kirim nomor penting untuk warga setelah laporan masih bergantung pada response AI, belum menjadi event domain yang konsisten lintas channel/API.
- Emergency contacts masih memakai hint hardcoded dan fallback ke semua kontak jika tidak ada match, berisiko salah untuk multi-desa.
- `create_complaint` belum mengirim `type_id` resmi ke case service, sehingga case service resolve ulang dari string kategori.
- Banyak regex/fast fallback masih terlalu dominan dan bisa membuat agent terasa bot atau salah jalur sebelum LLM/tool reasoning berjalan.
- Knowledge consistency sudah ada, tetapi doc-vs-DB belum mencakup layanan dan persyaratan layanan.
- Dashboard masih menyimpan path legacy link kategori kontak via nama, padahal sudah ada `important_contact_category_id`.
- Beberapa unique constraint per desa belum ada, sehingga duplikasi kategori/kontak/KB bisa terjadi.

## Prinsip Target yang Harus Dijaga

Untuk kebutuhan ini, aturan sistem seharusnya seperti berikut:

- DB resmi per desa adalah sumber kebenaran utama untuk kategori pengaduan, jenis pengaduan, emergency, kontak penting, layanan publik, syarat layanan, mode online/offline, profil desa, dan status/history user.
- KB/RAG hanya pelengkap jika DB tidak punya informasi, atau untuk informasi naratif/SOP/panduan yang tidak terstruktur.
- Jika DB dan KB konflik, AI harus memakai DB dan menyatakan data di knowledge perlu dikonfirmasi/diperbarui.
- Agent tidak boleh mendefinisikan sendiri kategori darurat. Darurat harus berasal dari `ComplaintType.is_urgent` yang diisi admin desa.
- Auto-kirim nomor penting harus mengikuti konfigurasi desa/type di DB, bukan hardcoded oleh sistem.
- Regex/fast intent hanya boleh menjadi guard untuk kasus sangat aman, bukan pengganti pemahaman LLM/tool-calling.
- Agent harus bertanya klarifikasi jika ragu, bukan memaksakan template.
- Semua jawaban terstruktur seperti nomor, syarat, layanan, jam buka, dan status harus grounded via tool resmi.

## Temuan Kritis

### 1. Bug pemanggilan `updateComplaintByUser` dari AI tool

Referensi:

- `govconnect-ai-service/src/services/agent/tool-executor.ts:1444-1452`
- `govconnect-case-service/src/services/complaint.service.ts:719-722`

AI tool memanggil `updateComplaintByUser` dengan pola tiga argumen:

```ts
const result = await updateComplaintByUser(referenceNumber, {
  wa_user_id: ctx.channel === 'whatsapp' ? ctx.userId : undefined,
  channel: ctx.channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
  channel_identifier: ctx.channel === 'webchat' ? ctx.userId : undefined,
}, {
  alamat,
  deskripsi,
  rt_rw: rtRw,
});
```

Definisi case service yang ditemukan hanya menerima dua argumen:

```ts
export async function updateComplaintByUser(
  id: string,
  data: UpdateComplaintByUserData
)
```

Dampak:

- Update laporan lewat AI agent berisiko gagal atau tidak membawa payload update.
- Jika typing client tidak menutupinya, bug ini bisa lolos runtime.
- Fitur “warga bisa update laporan via chat” tidak dapat dianggap valid sampai ini diverifikasi/fix.

Rekomendasi:

- Samakan kontrak client AI dan fungsi case service.
- Bentuk final sebaiknya satu object yang memuat ownership dan patch data.
- Tambahkan test integrasi tool `update_complaint` terhadap case service client.

### 2. Bug pemanggilan `cancelComplaint` dari AI tool

Referensi:

- `govconnect-ai-service/src/services/agent/tool-executor.ts:1892-1896`
- `govconnect-case-service/src/services/complaint.service.ts:601-604`

AI tool memanggil `cancelComplaint` dengan tiga argumen:

```ts
const result = await cancelComplaint(referenceNumber, {
  wa_user_id: ctx.channel === 'whatsapp' ? ctx.userId : undefined,
  channel: ctx.channel === 'whatsapp' ? 'WHATSAPP' : 'WEBCHAT',
  channel_identifier: ctx.channel === 'webchat' ? ctx.userId : undefined,
}, cancelReason);
```

Definisi case service yang ditemukan:

```ts
export async function cancelComplaint(
  id: string,
  data: CancelComplaintData
)
```

Dampak:

- Alasan pembatalan bisa tidak pernah masuk.
- Cancel dari AI agent bisa tidak sesuai kontrak.
- Workflow warga “batalkan laporan” belum aman dianggap konsisten.

Rekomendasi:

- Masukkan `cancel_reason` ke object `CancelComplaintData`.
- Tambahkan test untuk pembatalan laporan dari WA dan webchat.
- Pastikan pending confirmation tidak bisa bypass.

### 3. `create_complaint` belum mengirim `type_id` resmi

Referensi:

- `govconnect-ai-service/src/services/agent/tool-executor.ts:1055-1178`
- `govconnect-case-service/src/services/complaint.service.ts:217-250`
- `govconnect-case-service/prisma/schema.prisma:83-103`

Case service sudah punya authoritative resolver:

- Jika `type_id` ada, resolve dengan `resolveComplaintTypeById`.
- Jika tidak ada, resolve dari string `kategori` via micro LLM.
- `is_urgent` dan `require_address` final diambil dari config DB.

Namun AI tool create complaint hanya mengirim `kategori` dan `is_urgent`, tidak mengirim `type_id`/`category_id`.

Dampak:

- Type yang sudah dipilih AI bisa di-resolve ulang oleh case service dari string.
- Pada desa dengan type mirip, typo, bahasa lokal, atau kategori berbeda, resolver bisa mismatch.
- Audit trail complaint kehilangan type yang dipilih agent jika resolver gagal.

Rekomendasi:

- `get_complaint_categories` sebaiknya mengembalikan `type_id`, `category_id`, dan nama type/category secara eksplisit.
- `create_complaint` harus menerima dan mengirim `type_id` resmi.
- Case service tetap menjadi authority untuk `is_urgent`, `require_address`, dan `send_important_contacts`.
- Jika agent belum yakin type mana, agent wajib tanya klarifikasi, bukan mengarang kategori.

### 4. Auto-kirim nomor penting ke warga belum menjadi event domain

Referensi:

- `govconnect-ai-service/src/services/agent/tool-executor.ts:1207-1227`
- `govconnect-case-service/src/services/complaint.service.ts:293-312`
- `govconnect-notification-service/src/handlers/event.handler.ts:49-55`

AI tool membangun `importantContactsMessage` setelah complaint dibuat jika type config punya `send_important_contacts` dan kategori kontak penting.

Case service hanya enqueue `URGENT_ALERT` jika `resolvedIsUrgent` true. Tidak ada event khusus “send important contacts to citizen”. Handler `complaintCreated` di notification service juga diberi catatan tidak dipublish lagi karena AI service langsung membalas user.

Dampak:

- Jika laporan dibuat dari kanal selain AI response, nomor penting tidak otomatis terkirim ke warga.
- Jika AI response gagal/terpotong, laporan tetap tercatat tetapi nomor penting tidak terkirim.
- Tidak ada delivery log khusus untuk auto-kirim nomor penting.
- Logic penting per desa/type tersebar: DB config di case, pengiriman kontak di AI response.

Rekomendasi:

- Case service harus menerbitkan event domain saat complaint created jika `send_important_contacts=true`.
- Notification service harus menangani event itu dan mengirim kontak ke channel warga.
- AI response boleh menyebut kontak juga, tetapi event domain tetap sumber pengiriman resmi.
- Tambahkan log delivery untuk `important_contacts_auto_send`.

### 5. Emergency contacts masih hardcoded dan bisa fallback ke semua kontak

Referensi:

- `govconnect-ai-service/src/services/agent/tool-executor.ts:624-679`
- `govconnect-ai-service/src/services/agent/tool-executor.ts:641-643`

Kode mengambil semua kontak desa, lalu memprioritaskan kontak yang match `EMERGENCY_CONTACT_HINTS`. Jika tidak ada match, fallback ke semua kontak:

```ts
const contacts = await getImportantContacts(ctx.villageId);
const prioritized = contacts.filter((contact) => matchContactHints(contact, EMERGENCY_CONTACT_HINTS));
const finalContacts = (prioritized.length > 0 ? prioritized : contacts).slice(0, 8);
```

Dampak:

- Jika kategori darurat di desa tidak memakai kata “damkar/polisi/ambulans”, kontak darurat bisa tidak terdeteksi.
- Jika tidak ada match, sistem bisa mengirim nomor non-darurat sebagai kontak darurat.
- Ini bertentangan dengan kebutuhan bahwa emergency ditentukan oleh admin desa/database.

Rekomendasi:

- Jangan fallback ke semua kontak untuk emergency.
- Tambahkan konfigurasi DB untuk kategori kontak darurat, atau gunakan `ComplaintType.important_contact_category_id` dari type yang urgent.
- Untuk pertanyaan “nomor darurat apa saja”, ambil kategori kontak yang ditandai admin sebagai emergency, bukan hint global.
- Jika belum ada data emergency resmi, jawab jujur bahwa kontak darurat belum tersedia di DB.

### 6. Directory contact lookup masih terlalu bergantung pada role alias dan regex global

Referensi:

- `govconnect-ai-service/src/services/important-contacts.service.ts:162-225`
- `govconnect-ai-service/src/services/important-contacts.service.ts:236-276`
- `govconnect-ai-service/src/services/important-contacts.service.ts:402-512`

Ada daftar role dan kategori hint hardcoded seperti `damkar`, `polisi`, `puskesmas`, `kades`, `sekdes`, `pln`, `pdam`. Ini membantu, tetapi tidak cukup untuk multi-desa dengan istilah lokal dan struktur organisasi berbeda.

Dampak:

- Pertanyaan natural warga bisa miss intent, misalnya “kalau sakit malam hubungi siapa?” atau “air mati lapor mana?”.
- Kontak lokal dengan nama unik bisa tidak masuk alias.
- Agent bisa terasa seperti bot karena hanya paham pola tertentu.

Rekomendasi:

- Tambahkan alias/keyword per contact/category di DB.
- Gunakan semantic ranking terhadap seluruh kontak desa sebagai default setelah guard ringan.
- Jika confidence rendah, agent tanya klarifikasi atau tampilkan 2-3 kandidat.
- Pertahankan regex hanya sebagai negative guard untuk mencegah “nomor KTP/KK” salah dianggap kontak.

### 7. Dedupe kontak tidak konsisten antara dashboard internal API dan AI service

Referensi:

- `govconnect-dashboard/app/api/internal/important-contacts/route.ts:29-43`
- `govconnect-ai-service/src/services/important-contacts.service.ts:73-87`

Dashboard internal API dedupe memakai key `category_id + normalizedPhone`:

```ts
const key = `${contact.category_id || contact.category?.id || 'uncategorized'}:${normalizedPhone || `id:${contact.id}`}`
```

AI service dedupe hanya memakai normalized phone:

```ts
const key = normalizedPhone || `id:${contact.id}`;
```

Dampak:

- Kontak dengan nomor sama tapi kategori berbeda dipertahankan oleh dashboard, tetapi digabung oleh AI.
- Agent bisa tidak menampilkan kategori yang relevan jika nomor sama dipakai oleh beberapa role.
- Bisa menyebabkan hasil tidak konsisten antara UI admin dan jawaban warga.

Rekomendasi:

- Samakan strategi dedupe.
- Untuk directory lookup, dedupe final boleh by phone tetapi metadata kategori/role harus digabung, bukan dibuang.
- Tambahkan test “same phone different category”.

### 8. Dashboard masih punya path legacy link kategori kontak by name

Referensi:

- `govconnect-dashboard/app/api/important-contacts/categories/[id]/route.ts:12-21`
- `govconnect-dashboard/app/api/important-contacts/categories/[id]/route.ts:56-58`
- `govconnect-dashboard/app/api/important-contacts/categories/[id]/route.ts:119-147`
- `govconnect-dashboard/app/api/important-contacts/categories/[id]/route.ts:193-214`

Kode masih mendukung link complaint type ke important contact category via nama jika `important_contact_category_id` tidak ada. Bahkan komentar menyebut “table uses category NAME”, meski schema case service sudah punya `important_contact_category_id`.

Dampak:

- Rename kategori kontak bisa memicu sync legacy yang rentan gagal.
- Delete kategori perlu clear linked type via API loop, bukan FK relation.
- Nama kategori yang sama antar desa/duplikat bisa menyebabkan drift.

Rekomendasi:

- Jadikan `important_contact_category_id` satu-satunya sumber relasi baru.
- Buat migrasi data legacy dari name ke id.
- Setelah migrasi, hapus path legacy name atau jadikan read-only fallback sementara dengan observability.
- Tambahkan validasi bahwa `important_contact_category_id` harus milik village yang sama.

### 9. Schema belum punya unique constraint penting per desa

Referensi:

- `govconnect-case-service/prisma/schema.prisma:66-103`
- `govconnect-dashboard/prisma/schema.prisma:354-401`

Belum terlihat unique constraint untuk:

- `ComplaintCategory` per `village_id + name`.
- `ComplaintType` per `category_id + name`.
- `important_contact_categories` per `village_id + name`.
- `knowledge_categories` per `village_id + name`.

Dampak:

- Admin bisa membuat kategori/type duplikat.
- Resolver AI dan micro LLM bisa ambigu.
- UI bisa menampilkan data ganda.
- Auto-send kontak penting bisa salah kategori.

Rekomendasi:

- Tambahkan unique constraints dengan migrasi aman setelah dedupe data existing.
- Tambahkan validasi API sebelum create/update.
- Tampilkan error ramah di dashboard jika nama sudah dipakai di desa yang sama.

### 10. Notification urgent alert ke admin sengaja disabled by default

Referensi:

- `govconnect-notification-service/src/services/notification.service.ts:315-381`

Komentar menyatakan auto-send WA urgent alert disabled agar tidak spam/blocking dan baru aktif jika `ENABLE_URGENT_WA_ALERT=true`.

Dampak:

- Laporan urgent tetap dibuat dan event urgent alert diproses, tetapi alert WA admin bisa hanya logged/skipped.
- Jika operator mengira urgent alert selalu terkirim, bisa ada gap operasional.

Rekomendasi:

- Dashboard admin harus menampilkan status konfigurasi urgent WA alert per environment.
- Jika disabled, AI/admin UI jangan mengklaim “petugas sudah dikabari via WA”; gunakan “laporan sudah tercatat sebagai darurat”.
- Pertimbangkan channel alternatif seperti dashboard realtime notification saat WA urgent alert disabled.

## Audit Layanan Publik dan Form Online

### Yang sudah benar

Referensi:

- `govconnect-case-service/prisma/schema.prisma:121-180`
- `govconnect-case-service/prisma/schema.prisma:182-222`
- `govconnect-ai-service/src/services/agent/tool-executor.ts:447-599`
- `govconnect-ai-service/src/services/agent/tool-executor.ts:1257-1381`

Model sudah mendukung:

- Kategori layanan per desa.
- Service item per desa.
- Slug unique per desa: `@@unique([village_id, slug])`.
- Mode `online|offline|both`.
- Estimasi biaya dan waktu proses.
- Requirements dinamis per layanan.
- Citizen fields JSON.
- Public form untuk layanan online/both.
- Agent menolak kirim form untuk layanan offline.

Ini sesuai kebutuhan bahwa tiap desa bisa punya layanan, syarat, dan mode proses berbeda.

### Gap yang masih ada

- Resolver layanan masih punya hardcoded KTP logic di `tool-executor.ts:2002-2044`.
- Tool definition `get_service_info` masih memberi contoh layanan umum, tetapi tidak memaksa agent selalu cek DB dulu untuk nama yang mirip.
- Knowledge consistency doc-vs-DB belum memeriksa service requirements karena komentar menyebut long free-text.

Referensi doc-vs-DB:

- `govconnect-ai-service/src/services/doc-vs-db-pipeline.service.ts:8-16`
- `govconnect-ai-service/src/services/doc-vs-db-pipeline.service.ts:14-15`

Rekomendasi:

- Ganti hardcoded KTP resolver dengan semantic service resolver general untuk semua layanan desa.
- Tambahkan consistency checker untuk service list, mode, biaya, waktu, dan requirements minimal berbasis normalized bullet/fuzzy match.
- Jika KB menyebut layanan yang tidak ada di DB, tandai inconsistency.
- Jika DB punya syarat berbeda dari KB, agent harus prioritas DB dan report conflict.

## Audit Knowledge Base dan DB-First

### Yang sudah benar

Referensi:

- `govconnect-ai-service/src/services/knowledge-consistency.service.ts:1-16`
- `govconnect-ai-service/src/services/knowledge-consistency.service.ts:262-327`
- `govconnect-ai-service/src/services/doc-vs-db-pipeline.service.ts:1-16`
- `govconnect-ai-service/src/services/unified-message-processor.service.ts:2184-2229`

Sudah ada:

- Doc-vs-doc consistency pipeline.
- KB-vs-KB periodic sweep.
- Doc-vs-DB pipeline untuk phone, operating hours, address, office role holder.
- Runtime DB-vs-RAG reconciler sebelum jawaban dikirim.
- Response cache juga direconcile ulang dengan DB.

Ini sangat bagus untuk anti-halusinasi.

### Gap yang masih ada

- Doc-vs-DB belum mencakup layanan dan persyaratan layanan.
- Dashboard schema juga punya `knowledge_conflicts`, sedangkan AI service punya `ai_knowledge_inconsistencies`. Perlu dipastikan UI admin membaca sumber yang sama atau ada sinkronisasi.
- Tidak terlihat dari file yang dibaca apakah inconsistency punya dashboard review flow lengkap.
- Hardcoded fallback knowledge masih bisa menjawab sebelum DB/RAG pada beberapa kasus.

Referensi hardcoded fallback:

- `govconnect-ai-service/src/services/unified-message-processor.service.ts:715-799`
- `govconnect-ai-service/src/services/unified-message-processor.service.ts:1827-1844`

Rekomendasi:

- Perluas doc-vs-DB ke `services_dynamic`, `service_requirements`, `complaint_types`, dan `important_contact_categories`.
- Pastikan admin dashboard punya halaman review untuk semua inconsistency.
- Kurangi deterministic knowledge fallback untuk topik desa/layanan/kontak.
- Tambahkan metadata jawaban: `source_priority=db|kb|document|memory|fallback`.

## Audit Regex, Fast Intent, dan Agent CS Manusia

### Risiko yang ditemukan

Referensi:

- `govconnect-ai-service/src/services/unified-message-processor.service.ts:1462-1773`
- `govconnect-ai-service/src/services/unified-message-processor.service.ts:680-713`
- `govconnect-ai-service/src/services/unified-message-processor.service.ts:715-799`
- `govconnect-ai-service/src/services/answer-policy.service.ts:68-85`
- `govconnect-ai-service/src/services/important-contacts.service.ts:217-276`

Pre-agent layer melakukan banyak shortcut:

- protocol guard
- greeting shortcut
- fast intent decision
- pending offer handling
- late pre-agent state
- service clarification
- active service follow-up
- out-of-scope guard
- service listing shortcut
- deterministic knowledge fallback

Sebagian guard ini perlu, tetapi jika terlalu luas, agent bisa:

- Salah mendeteksi maksud warga.
- Menjawab template tanpa memahami konteks.
- Tidak memanggil tool DB padahal perlu.
- Terasa seperti bot, bukan CS manusia.

### Rekomendasi arsitektur hybrid adaptif

Pre-agent boleh langsung handle hanya untuk kasus berikut:

- Spam/input terlalu panjang/unsupported media.
- Pending confirmation yang sangat eksplisit seperti “YA” untuk cancel setelah ada pending cancel state.
- Exact reference number `LAP-...` atau `LAY-...` untuk status jika konteks jelas.
- Security/ownership guard.
- Greeting singkat tanpa active state.

Selain itu, alur sebaiknya:

1. Bangun context: village, active state, history, memory, profile.
2. LLM agent memahami maksud warga.
3. Tool policy memberi hint tool yang mungkin dibutuhkan, bukan memaksa jawaban template.
4. Agent memanggil DB tools dulu untuk data resmi.
5. Jika DB kosong, agent boleh pakai KB/RAG.
6. Jika DB dan KB konflik, agent memakai DB dan mencatat conflict.
7. Jika confidence rendah, agent bertanya klarifikasi natural.
8. Jika user frustrasi atau berulang gagal, handoff ke petugas.

### Auto-learning yang realistis

Sudah ada fondasi:

- `ai_golden_set_runs` dan `ai_golden_set_items` di dashboard schema.
- Tool policy events dan execution traces di AI service.
- Hybrid memory.
- Stuck-user tracker.
- Knowledge gaps/conflicts.

Agar “auto belajar” tidak berbahaya:

- Jangan langsung mengubah policy dari satu percakapan.
- Simpan failed turns sebagai dataset evaluasi.
- Admin review untuk knowledge gap dan conflict.
- Jalankan golden-set regression sebelum policy/prompt baru aktif.
- Learning output harus berupa rekomendasi rule/tool policy, bukan agent mengubah DB resmi sendiri.

## Audit Tool Surface AI Agent

Tool yang ada di `govconnect-ai-service/src/services/agent/tool-definitions.ts`:

- `get_village_profile`
- `get_service_info`
- `get_complaint_categories`
- `get_emergency_contacts`
- `get_important_contact`
- `search_knowledge`
- `search_documents`
- `search_user_memory`
- `create_complaint`
- `create_service_request`
- `update_complaint`
- `get_service_request_edit_link`
- `get_my_history`
- `check_status`
- `cancel_request`

Untuk warga, tool surface ini sudah cukup luas.

Gap tool naming/contract:

- `get_complaint_categories` sebenarnya mengembalikan complaint types, bukan categories murni.
- `create_complaint` description masih menyebut “pengaduan infrastruktur”, terlalu sempit untuk multi-desa.
- `create_complaint` parameter kategori masih memberi contoh hardcoded seperti `jalan_rusak`, `lampu_mati`, `sampah`, `drainase`.
- Tool belum mengharuskan `type_id` resmi.

Rekomendasi:

- Rename atau tambah tool `get_complaint_types`.
- Payload harus menyertakan `type_id`, `type_name`, `category_id`, `category_name`, `is_urgent`, `require_address`, `send_important_contacts`, `important_contact_category_id`.
- Update description agar agent tidak bias ke infrastruktur.
- Buat agent policy: sebelum `create_complaint`, pakai type resmi dari DB atau tanya klarifikasi.

## Dead Code dan Redundansi Potensial

Audit ini tidak menghapus file karena user meminta audit saja. Kandidat yang perlu audit lanjutan sebelum removal:

### 1. Legacy Gemini BYOK tables

Referensi:

- `govconnect-dashboard/prisma/schema.prisma:427-459`
- `govconnect-dashboard/prisma/schema.prisma:461-485`

Komentar schema menyatakan tabel ini historical dan runtime gateway-only tidak lagi menggunakan tabel ini.

Risiko:

- Jika benar tidak dipakai, ini dead schema dan bisa membingungkan admin/dev.
- Namun perlu search penuh dan migrasi data sebelum dihapus.

Rekomendasi:

- Audit semua reference `gemini_api_keys` dan `gemini_api_key_usage`.
- Jika tidak ada runtime reference, tandai deprecated di docs dan buat migration cleanup terpisah.

### 2. Legacy important contact category link by name

Referensi:

- `govconnect-dashboard/app/api/important-contacts/categories/[id]/route.ts:12-21`
- `govconnect-dashboard/app/api/important-contacts/categories/[id]/route.ts:119-147`

Ini bukan dead code sepenuhnya karena masih dipakai untuk legacy fallback, tetapi redundan setelah ada `important_contact_category_id`.

Rekomendasi:

- Migrasikan semua type lama ke id.
- Tambahkan warning jika masih ada row yang hanya punya name.
- Hapus fallback setelah data bersih.

### 3. Deterministic resident knowledge fallback

Referensi:

- `govconnect-ai-service/src/services/unified-message-processor.service.ts:715-799`

Ini bukan dead code, tetapi redundant dengan agent/RAG dan rawan template.

Rekomendasi:

- Kurangi menjadi fallback universal non-desa.
- Pindahkan konten yang bersifat kebijakan/panduan ke KB.
- Jangan pakai fallback untuk layanan/kontak/status/prosedur desa.

## Roadmap Perbaikan Prioritas

### P0 - Bug dan keamanan data

- Fix kontrak `updateComplaintByUser` dari AI tool.
- Fix kontrak `cancelComplaint` dari AI tool.
- Pastikan ownership check bekerja untuk WA dan webchat.
- Tambahkan test integrasi update/cancel/status/history.

### P1 - DB-first emergency dan auto contact

- `create_complaint` harus membawa `type_id` resmi.
- Case service publish event auto-send important contacts berdasarkan `ComplaintType.send_important_contacts`.
- Notification service kirim kontak penting ke warga dan log delivery.
- `get_emergency_contacts` jangan fallback ke semua kontak.
- Emergency category/contact harus DB-driven per desa.

### P2 - Multi-desa consistency

- Unique constraints per desa/category.
- Validasi `important_contact_category_id` satu desa dengan complaint type.
- Samakan dedupe contacts dashboard dan AI.
- Migrasi legacy category-name link ke id.

### P3 - Agent quality

- Persempit fast intent/regex final answer.
- Jadikan tool policy sebagai hint, bukan template answer.
- Tambahkan confidence gate dan clarification behavior.
- Kurangi hardcoded KTP resolver dan jadikan semantic resolver general.
- Update tool descriptions agar tidak bias kategori tertentu.

### P4 - Knowledge consistency dan learning

- Perluas doc-vs-DB ke service catalog, requirements, complaint types, dan contact categories.
- Hubungkan `ai_knowledge_inconsistencies` ke dashboard admin review.
- Jadikan knowledge gap/conflict sebagai feedback loop admin-reviewed.
- Golden set harus mencakup variasi desa, bahasa lokal, typo, pertanyaan ambigu, emergency, kontak, layanan online/offline, dan update/cancel/status.

## Checklist Validasi Setelah Perbaikan

- Warga bertanya “nomor puskesmas” dan agent mengambil dari kontak DB desa, tidak dari KB jika DB ada.
- Warga bertanya “nomor pelayanan KTP” dan agent tidak salah menganggap nomor KTP sebagai kontak.
- Warga membuat laporan type urgent yang dikonfigurasi admin desa, lalu complaint tersimpan `is_urgent=true` dari DB.
- Warga membuat laporan type non-urgent dengan kata “darurat” di teks, tetapi type DB non-urgent, sistem tidak otomatis mengubah jadi urgent tanpa type resmi.
- Type yang `send_important_contacts=true` mengirim kontak ke warga via event notification, bukan hanya text response AI.
- Jika kategori kontak penting dihapus/rename, linked complaint type tetap konsisten via id atau diblokir dengan pesan admin.
- Layanan offline tidak pernah diberi link form.
- Layanan online/both diberi link form sesuai `village_slug` dan `service_slug` desa tersebut.
- Jika KB menyebut syarat layanan berbeda dari DB, agent memakai DB dan conflict tercatat.
- Jika agent ragu antara dua layanan/type, agent bertanya klarifikasi, bukan memilih paksa.

## Kesimpulan

Sistem sudah berada di arah yang benar untuk menjadi AI CS pemerintahan multi-desa: ada agent tools, DB-first guard, RAG, memory, handoff, status/history, dan consistency checker. Tetapi masih ada gap yang perlu ditutup agar tidak menjadi bot template dan tidak salah untuk tiap desa.

Prioritas paling penting adalah membenahi kontrak update/cancel, membuat complaint type benar-benar DB-driven via `type_id`, menjadikan auto-kirim nomor penting sebagai event domain, menghapus fallback emergency ke semua kontak, dan mempersempit regex/fast intent agar LLM agent tetap memahami konteks warga secara adaptif.
