# Audit Final AI CS Multi-Desa, DB-First, Lintas Service, dan Redundansi

Tanggal audit: 2026-05-11

Dokumen ini adalah audit berbasis kode yang terbaca di repo pada saat audit. Tidak ada implementasi yang dilakukan karena instruksi terakhir adalah audit saja. Semua temuan di bawah ditulis hanya jika ada bukti file/kode; area yang belum cukup bukti ditandai sebagai risiko atau rekomendasi, bukan fakta bug.

## Scope

Service dan area yang diperiksa:

- `govconnect-ai-service`: unified message processor, agent orchestrator, tool definitions/executor, answer policy, RAG/KB, village behavior, case client, complaint handler.
- `govconnect-case-service`: schema complaint/service request/service catalog, complaint create/update/cancel, complaint metadata, service catalog controller, statistics.
- `govconnect-dashboard`: admin API untuk complaint categories/types, layanan, knowledge base, important contacts, internal important contacts API.
- `govconnect-notification-service`: handler event, pengiriman urgent alert dan important contacts.
- `govconnect-channel-service`: schema dan beberapa risiko village scoping messaging state yang sudah tercatat di audit lintas service sebelumnya.
- `docs/*`: audit sebelumnya dibaca agar dokumen ini tidak mengulang temuan yang sudah berubah atau bertentangan.

## Prinsip Target

Target sistem yang diminta:

- Setiap desa dapat memiliki kategori pengaduan, jenis pengaduan, penanda urgent, kontak penting, layanan publik, syarat layanan, mode online/offline, dan KB yang berbeda.
- DB resmi per desa harus menjadi source of truth untuk fakta terstruktur.
- KB/RAG hanya pelengkap saat DB tidak memiliki data, atau untuk SOP/narasi/dokumen yang tidak terstruktur.
- Jika DB dan KB konflik, agent harus memprioritaskan DB dan menandai konflik untuk review, bukan memilih sendiri.
- Emergency/darurat tidak boleh ditentukan hardcoded oleh sistem; status urgent berasal dari data admin desa di `ComplaintType.is_urgent`.
- Auto-kirim nomor penting harus mengikuti konfigurasi `ComplaintType.send_important_contacts` dan `important_contact_category_id` per desa/type.
- Regex/fast intent tidak boleh menjadi pengganti pemahaman agent; regex hanya guard aman, bukan template jawaban.
- Agent harus bertanya klarifikasi saat confidence rendah, bukan memaksa jawaban template.

## Ringkasan Eksekutif

Fondasi sistem sudah cukup kuat untuk AI CS pemerintahan multi-desa:

- Tool agent sudah mencakup profil desa, layanan, kategori/type pengaduan, kontak penting, KB/dokumen, history/status, create/update/cancel laporan, dan service request.
- Case service sudah membuat complaint dengan `village_id` wajib dan menyimpan `category_id`, `type_id`, `is_urgent`, `require_address` dari konfigurasi type DB.
- Case service sudah menerbitkan event `COMPLAINT_IMPORTANT_CONTACTS` saat type meminta auto-send kontak penting.
- Dashboard important contacts sudah village-scoped dan internal lookup mewajibkan `village_id`.
- Notification service sudah punya handler important contacts dengan dedupe/skip logging.
- Answer policy sudah menolak banyak jawaban fakta terstruktur yang tidak grounded via tool.

Gap terpenting yang masih perlu ditutup:

1. AI cache invalidation belum membersihkan cache complaint type dan service catalog/requirements, sehingga perubahan admin desa bisa stale beberapa menit.
2. Case-service metadata/service catalog endpoint masih permissive jika header role/scope tidak dikirim oleh internal caller.
3. AI service catalog dapat menerima layanan inactive dari endpoint `/services` karena endpoint list tidak memfilter `is_active` secara default.
4. Answer policy masih menganggap `toolsUsed` saja cukup untuk grounding, sebelum mengecek trace sukses/trust; ini bisa membuat tool gagal tetap terlihat grounded.
5. Knowledge/RAG low-confidence masih bisa dianggap cukup sebagai grounding untuk `knowledge_answer`.
6. Tool routing/fast intent masih sangat berbasis regex dan duplikasi heuristik, sehingga risiko salah jalur dan terasa bot masih ada.
7. `ServiceRequest.village_id` masih nullable di schema, belum sekuat `Complaint.village_id`.
8. KB create/update menandai `embedding_status='pending'`, tetapi kontrak worker/sync tidak eksplisit di CRUD.
9. Redundansi/dead path masih ada pada stale `complaint.created` consumer, fallback tenant `unknown`, route validator public complaint yang duplikatif, dan legacy important contact category by name.

## Temuan Positif yang Sudah Sesuai Target

### 1. Complaint urgent sudah DB-driven di case service

Referensi:

- `govconnect-case-service/src/services/complaint.service.ts:217-254`
- `govconnect-case-service/src/services/complaint.service.ts:280-318`
- `govconnect-case-service/src/services/complaint.service.ts:327-346`
- `govconnect-case-service/prisma/schema.prisma` model `ComplaintType`

Bukti:

- Case service resolve type dari `type_id` atau kategori.
- `resolvedIsUrgent`, `resolvedRequireAddress`, `resolvedCategoryId`, dan `resolvedTypeId` ditentukan server-side dari config DB.
- Complaint tersimpan dengan `is_urgent`, `require_address`, `category_id`, `type_id`, dan `village_id`.
- Event urgent alert diterbitkan hanya jika `resolvedIsUrgent` true.

Implikasi:

- Sistem tidak sepenuhnya mengandalkan AI untuk menentukan darurat.
- Ini sesuai kebutuhan bahwa darurat/urgent ditentukan admin desa lewat DB.

### 2. Auto-send nomor penting sudah menjadi event domain

Referensi:

- `govconnect-case-service/src/services/complaint.service.ts:301-318`
- `govconnect-notification-service/src/services/notification.service.ts:114-153`
- `govconnect-notification-service/src/services/notification.service.ts:177-233`
- `govconnect-dashboard/app/api/internal/important-contacts/route.ts:59-85`

Bukti:

- Case service enqueue event `COMPLAINT_IMPORTANT_CONTACTS` saat `resolved.send_important_contacts` dan `resolved.important_contact_category_id` tersedia.
- Notification service mengambil contacts dari dashboard internal API dengan `village_id` dan `category_id`.
- Dashboard internal contacts query membatasi category dan contact ke `category.village_id = villageId`.
- Notification service punya dedupe untuk complaint important contacts.

Implikasi:

- Auto-send kontak penting tidak hanya bergantung pada teks balasan AI.
- Cross-village leakage contacts dicegah oleh dashboard internal lookup.

Caveat:

- Jika case-service menyimpan `important_contact_category_id` yang stale/mismatched, dashboard internal lookup akan mengembalikan kosong dan notification akan skip. Ini fail-safe, tetapi bisa membuat auto-send diam-diam tidak terkirim.

### 3. Service catalog sudah mendukung per-desa dan mode online/offline/both

Referensi:

- `govconnect-case-service/prisma/schema.prisma` model `ServiceCategory`, `ServiceItem`, `ServiceRequirement`, `ServiceRequest`.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:625-656`
- `govconnect-ai-service/src/services/agent/tool-executor.ts` tool `get_service_info` dan `create_service_request`.

Bukti:

- Service item punya `village_id`, `slug`, `mode`, `estimated_fee`, `processing_time`, `citizen_fields`, dan requirements.
- Lookup public service by slug mewajibkan `village_id` dan `slug`.
- Endpoint service-by-slug mengembalikan `410` jika service inactive.

Implikasi:

- Secara model, setiap desa bisa punya layanan, syarat, dan mode layanan berbeda.

### 4. Important contacts sudah punya table village-scoped

Referensi:

- `govconnect-dashboard/prisma/schema.prisma` model `important_contact_categories` dan `important_contacts`.
- `govconnect-dashboard/app/api/internal/important-contacts/route.ts:59-85`

Bukti:

- Category kontak punya `village_id`.
- Internal lookup mewajibkan `village_id`.
- Contact query memastikan `category.village_id` sesuai.

Implikasi:

- Pertanyaan nomor penting per desa dapat dijawab dari DB desa, bukan template global.

### 5. Tool surface AI agent sudah luas

Referensi:

- `govconnect-ai-service/src/services/agent/tool-definitions.ts`
- `govconnect-ai-service/src/services/agent/tool-executor.ts`

Tool yang tersedia:

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

Implikasi:

- Secara kemampuan dasar, agent sudah bisa bertindak sebagai CS warga: menjawab informasi, membuat laporan/layanan, cek status/history, update/cancel, dan memakai KB/dokumen.

## Bug / Gap Kritis

### 1. AI cache invalidation tidak membersihkan complaint type cache

Severity: High

Referensi:

- `govconnect-ai-service/src/app.ts:491-527`
- `govconnect-ai-service/src/services/ump-state.ts:151-152`
- `govconnect-ai-service/src/services/ump-utils.ts:246-254`
- `govconnect-dashboard/app/api/complaints/types/route.ts`
- `govconnect-dashboard/app/api/complaints/types/[id]/route.ts`

Bukti:

- Dashboard memanggil invalidasi cache AI setelah create/update/delete complaint type/category.
- Endpoint AI `/admin/cache/invalidate-village` hanya membersihkan response cache, retrieval cache, dan profile cache.
- `complaintTypeCache` dipakai `getCachedComplaintTypes()` dan `resolveComplaintTypeConfig()` untuk menentukan type/config complaint.
- Tidak terlihat pembersihan `complaintTypeCache` pada endpoint invalidasi tersebut.

Dampak:

- Setelah admin desa mengubah `is_urgent`, `require_address`, `send_important_contacts`, atau `important_contact_category_id`, AI dapat memakai data lama sampai TTL cache habis.
- Ini langsung berpengaruh ke emergency conversation, required address, dan auto-send contact notice.

Rekomendasi:

- Tambahkan helper `clearComplaintTypeCache(villageId?: string)`.
- Panggil helper itu di `/admin/cache/invalidate-village`.
- Response endpoint sebaiknya mengembalikan `complaintTypeCacheCleared`.
- Tambahkan test: update type dari non-urgent ke urgent, invalidasi cache, AI resolve config baru pada turn berikutnya.

### 2. AI cache invalidation tidak membersihkan service catalog dan requirements cache

Severity: High

Referensi:

- `govconnect-ai-service/src/app.ts:491-527`
- `govconnect-ai-service/src/services/case-client.service.ts:733-734`
- `govconnect-ai-service/src/services/case-client.service.ts:820-845`
- `govconnect-ai-service/src/services/case-client.service.ts:922-953`
- `govconnect-ai-service/src/services/case-client.service.ts:866-869`
- `govconnect-dashboard/app/api/layanan/route.ts`
- `govconnect-dashboard/app/api/layanan/[serviceId]/route.ts`
- `govconnect-dashboard/app/api/layanan/[serviceId]/requirements/route.ts`

Bukti:

- AI punya `serviceCatalogCacheMap` dan `serviceRequirementsCacheMap`.
- Ada function `clearServiceCatalogCache()` yang clear dua cache tersebut.
- Endpoint invalidasi desa di `app.ts` tidak memanggil `clearServiceCatalogCache()`.
- Dashboard layanan memanggil invalidasi AI setelah perubahan layanan/requirements.

Dampak:

- AI dapat menjawab syarat, status aktif, mode online/offline/both, biaya, estimasi, atau form fields yang stale sampai TTL cache service habis.
- Ini rawan membuat warga diarahkan ke layanan yang sudah berubah.

Rekomendasi:

- Panggil `clearServiceCatalogCache()` saat invalidasi desa untuk perubahan layanan.
- Jika ingin lebih presisi, ubah key requirements agar include `villageId:serviceId` lalu invalidasi per desa/service.
- Endpoint invalidasi perlu melaporkan `serviceCacheCleared`.

### 3. Case-service metadata endpoints terlalu permissive tanpa role/scope header

Severity: High untuk defense-in-depth

Referensi:

- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:23-83`
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:126-160`
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:234-293`
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:103-139`
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:214-245`
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:325-357`
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:475-586`

Bukti:

- Helper scope hanya mewajibkan `x-village-id` jika `x-admin-role` ada dan bukan `superadmin`.
- Jika role header tidak ada, collection scope bisa `undefined` atau mengikuti query/body.
- Collection read bisa mengembalikan semua village saat scope undefined.
- Mutasi bisa menerima `village_id` dari body jika tidak ada scoped header.

Dampak:

- Dashboard path normal tampak mengirim header yang benar, tetapi service boundary internal masih fail-open.
- Internal caller yang salah konfigurasi dapat membaca/mengubah metadata lintas desa.

Rekomendasi:

- Endpoint admin metadata harus fail-closed: wajib `x-admin-role` dan `x-village-id`, kecuali `x-admin-role: superadmin` dengan `scope=all` eksplisit.
- Buat endpoint internal read khusus untuk AI yang mewajibkan `village_id`.
- Tambahkan audit log saat ada request metadata tanpa scope.

### 4. AI service catalog dapat menyertakan inactive services

Severity: Medium

Referensi:

- `govconnect-case-service/src/controllers/service-catalog.controller.ts:331-357`
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:372-394`
- `govconnect-ai-service/src/services/case-client.service.ts:798-845`

Bukti:

- Endpoint `/services` mengembalikan field `is_active`, tetapi tidak memfilter `is_active: true` secara default.
- Endpoint search punya default active-only, tetapi AI `getServiceCatalog()` memakai list `/services`.
- Service-by-slug public sudah menolak inactive dengan `410`, tetapi listing AI bisa tetap melihat inactive.

Dampak:

- AI bisa menyebut atau menawarkan layanan inactive.
- UI/admin dan public lookup bisa benar, tetapi percakapan AI tetap tidak konsisten.

Rekomendasi:

- Filter active-only di endpoint AI-facing atau di AI client.
- Untuk dashboard admin, gunakan parameter `include_inactive=true` eksplisit.
- Tambahkan test: layanan inactive tidak muncul saat warga tanya daftar layanan.

### 5. `ServiceRequest.village_id` masih nullable

Severity: Medium-High

Referensi:

- `govconnect-case-service/prisma/schema.prisma` model `ServiceRequest`, field `village_id String?`.

Dampak:

- Service request adalah entitas warga-facing multi-desa, tetapi schema masih mengizinkan data tanpa desa.
- Data tanpa desa bisa hilang dari dashboard desa, statistik, atau menurunkan isolation.

Rekomendasi:

- Backfill semua row null.
- Ubah `village_id` menjadi required.
- Pertimbangkan `village_id` dalam idempotency uniqueness jika ada risiko cross-village collision.

### 6. Case-service tidak memvalidasi `important_contact_category_id` ke dashboard source of truth

Severity: Medium

Referensi:

- `govconnect-dashboard/app/api/complaints/types/route.ts:182-208`
- `govconnect-dashboard/app/api/complaints/types/[id]/route.ts:63-84`
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:276-296`
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:333-347`
- `govconnect-dashboard/app/api/internal/important-contacts/route.ts:59-85`

Bukti:

- Dashboard memvalidasi category contact sebelum proxy ke case service.
- Case service sendiri hanya menyimpan `important_contact_category_id` sebagai string.
- Contacts authoritative ada di dashboard DB, bukan case-service DB.

Dampak:

- Direct internal caller bisa menyimpan ID kontak kategori yang tidak ada atau milik desa lain.
- Notification tidak bocor karena lookup dashboard tetap village-scoped, tetapi auto-send akan skip.

Rekomendasi:

- Tambahkan endpoint dashboard internal validation untuk contact category.
- Case service harus memanggil validation itu sebelum menerima `important_contact_category_id`.
- Tambahkan dashboard health/consistency warning untuk type yang `send_important_contacts=true` tetapi category id tidak valid.

### 7. Answer policy menerima `toolsUsed` sebagai grounding sebelum cek trace sukses

Severity: Medium-High

Referensi:

- `govconnect-ai-service/src/services/answer-policy.service.ts:278-304`
- `govconnect-ai-service/src/services/answer-policy.service.ts:484-489`

Bukti:

- `hasTrustedGrounding()` langsung return true jika `toolsUsed` mengandung tool yang allowed.
- Baru setelah itu cek `metadata.grounding` dan `toolTrace` yang punya `trace.success` dan `trustLevel`.

Dampak:

- Jika tool dipanggil tetapi gagal/hasil kosong, final answer bisa tetap dianggap grounded karena nama tool ada di `toolsUsed`.
- Ini khususnya berbahaya untuk contact/service/profile/knowledge structured facts.

Rekomendasi:

- Prioritaskan `toolTrace` yang `success=true` dan trust/source sesuai.
- `toolsUsed` tanpa trace hanya fallback legacy dan tidak boleh cukup untuk klaim fakta terstruktur.
- Untuk `search_knowledge`/`search_documents`, grounding harus mempertimbangkan `found` dan confidence.

### 8. Knowledge/RAG low-confidence masih dapat dianggap cukup untuk jawaban knowledge

Severity: Medium

Referensi:

- `govconnect-ai-service/src/services/agent/tool-executor.ts:914-950`
- `govconnect-ai-service/src/services/agent/tool-executor.ts:985-1021`
- `govconnect-ai-service/src/services/answer-policy.service.ts:484-489`
- `govconnect-ai-service/src/services/rag.service.ts` threshold retrieval/rerank.

Bukti:

- Tool output knowledge/documents membawa `confidence_level`.
- Answer policy untuk `knowledge_answer` hanya mengecek used knowledge tool/structured tool/uncertainty.
- Tidak terlihat enforcement bahwa low/none confidence harus dijawab uncertain atau fallback.

Dampak:

- Agent bisa menjawab terlalu yakin dari retrieval lemah.
- Untuk pemerintahan/desa, ini rawan salah prosedur, jadwal, atau ketentuan.

Rekomendasi:

- Masukkan confidence retrieval ke `metadata.grounding`.
- Treat `confidence_level: low|none` sebagai insufficient grounding kecuali response eksplisit mengatakan belum menemukan info cukup.
- Untuk DB-first, jika KB konflik dengan DB, final response harus memakai DB dan mencatat conflict.

### 9. Fast intent, regex routing, dan tool policy masih duplikatif dan terlalu panjang

Severity: Medium-High untuk kualitas agent

Referensi:

- `govconnect-ai-service/src/services/pre-agent-state-router.service.ts`
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts`
- `govconnect-ai-service/src/services/micro-llm-matcher.service.ts`

Bukti:

- Ada routing/heuristic di pre-agent router.
- Ada routing/allowed-tools selector besar di agent orchestrator.
- Emergency/contact/service/document patterns tersebar di beberapa tempat.

Dampak:

- Risiko satu intent dihapus/dilarang di satu tempat lalu diizinkan ulang di tempat lain.
- Pertanyaan warga yang natural/ambigu dapat salah diarahkan ke template.
- Agent bisa terasa seperti bot karena terlalu cepat masuk fast path.

Rekomendasi:

- Buat shared intent-family classifier yang dipakai pre-agent dan tool policy.
- Ubah allowed-tools menjadi declarative matrix: intent, required tools, optional tools, hard-denied tools, mutation allowed.
- Fast path hanya untuk guard aman: spam, unsupported media, exact pending confirmation, exact reference number, greeting sangat pendek.
- Selain itu biarkan agent reasoning + tool DB-first bekerja.

### 10. Mutation timing masih terlalu bergantung prompt, belum sepenuhnya enforced executor-side

Severity: Medium

Referensi:

- `govconnect-ai-service/src/services/agent/tool-definitions.ts`
- `govconnect-ai-service/src/services/agent/tool-executor.ts`
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts`

Bukti:

- Tool `create_service_request` dan `create_complaint` dijelaskan lewat prompt/tool description.
- Routing bisa mengizinkan mutation tools bersama info tools dalam beberapa kondisi.
- Executor-side precondition eksplisit seperti “user sudah minta lanjut/buat/form” perlu diperketat.

Dampak:

- Model bisa terlalu cepat membuat link service request atau laporan sebelum warga benar-benar setuju.
- Untuk CS manusia, agent seharusnya konfirmasi natural saat data belum cukup, bukan langsung action.

Rekomendasi:

- Tambahkan deterministic precondition di executor:
  - `create_service_request` butuh explicit proceed/form intent atau pending offer confirmation.
  - `create_complaint` butuh explicit reporting intent atau active incident jelas plus minimum details.
- Simpan precondition result di tool trace.

## Konsistensi Per-Desa yang Harus Dijaga

### Complaint categories/types

Source of truth:

- `govconnect-case-service` model `ComplaintCategory` dan `ComplaintType`.

Yang sudah benar:

- Type punya `village_id` via category.
- Type punya `is_urgent`, `require_address`, `send_important_contacts`, `important_contact_category_id`.
- Case service final authority untuk urgent/address/contact config saat create complaint.

Gap:

- AI complaint type cache stale setelah admin update.
- Case-service endpoint masih permissive tanpa scope header.
- Contact category ID belum divalidasi di case-service.

### Emergency/darurat

Source of truth:

- `ComplaintType.is_urgent` per desa/type.

Yang sudah benar:

- Case service memakai DB-resolved urgent.
- AI complaint handler juga mencatat emergency detection sebagai DB-driven via config type.

Gap:

- Cache stale bisa membuat percakapan AI tidak sinkron dengan DB baru.
- Tool `get_emergency_contacts` perlu dipastikan tidak fallback ke semua kontak dan harus mengikuti konfigurasi data admin desa.

### Important contacts dan auto-send

Source of truth:

- Dashboard `important_contact_categories` dan `important_contacts`.
- Complaint type di case-service menyimpan link category ID untuk auto-send.

Yang sudah benar:

- Internal lookup contacts mewajibkan `village_id`.
- Notification important contacts sudah event-driven dan dedupe.

Gap:

- Case-service belum validate ID terhadap dashboard.
- Perlu consistency check rutin untuk broken mapping.
- Strategi dedupe antara dashboard internal API dan AI service perlu disamakan jika masih berbeda.

### Public services/forms

Source of truth:

- Case-service `ServiceCategory`, `ServiceItem`, `ServiceRequirement`, `ServiceRequest`.

Yang sudah benar:

- Mode online/offline/both sudah ada.
- Requirements dan citizen fields dinamis.
- Public service-by-slug reject inactive.

Gap:

- AI list catalog bisa menyertakan inactive services.
- Service cache stale setelah admin update.
- `ServiceRequest.village_id` masih nullable.
- Service category belum sekuat complaint category dalam normalisasi/unique per desa jika tidak ada unique constraint nama/key.

### KB dan DB-first

Source of truth:

- DB untuk fakta terstruktur.
- KB/RAG untuk narasi/SOP/dokumen tambahan.

Yang sudah benar:

- Ada vector schema dengan `village_id`/scope.
- Ada consistency pipeline dan DB-vs-RAG reconciler.
- Tool definition menyatakan `search_knowledge` bukan untuk deterministic DB facts.

Gap:

- KB create/update menandai pending tanpa kontrak sync yang terlihat eksplisit di route CRUD.
- Delete KB melakukan DB delete lalu async vector delete; jika delete vector gagal, orphan vector bisa tersisa.
- Answer policy belum confidence-aware untuk retrieval low/none.
- Doc-vs-DB perlu diperluas ke service list, requirements, complaint types, dan contacts.

## Agent CS Manusia: Audit Kualitas dan Roadmap

### Yang sudah mendukung agent pintar

- Tool surface luas dan action-capable.
- DB-first prompt dan tool definitions.
- Answer policy anti-halusinasi untuk kontak/layanan/profil.
- DB-vs-RAG reconciler.
- Memory/history dan stuck-user tracker.
- Test/evaluation mode dapat memblok side effect.
- Mutation tools dieksekusi sequential, read-only tools bisa parallel.

### Risiko agent terasa seperti bot

- Banyak regex/fast intent sebelum reasoning penuh.
- Tool policy panjang dengan add/delete tools berulang.
- Deterministic fallback dapat menjawab template untuk topik yang seharusnya tool/DB.
- Tool contract `update_complaint` masih cenderung kaku untuk patch parsial.
- Broad fallback dapat membuka beberapa tools untuk pesan vague, bukan bertanya klarifikasi.

### Rekomendasi desain hybrid adaptif

1. Pre-agent hanya guard aman: spam, unsupported media, exact pending confirmation, reference number jelas, greeting singkat.
2. Intent classifier bersama mengeluarkan intent family + confidence + ambiguity flags.
3. Tool policy declarative menentukan DB tools wajib, KB fallback optional, mutation hard-denied kecuali precondition terpenuhi.
4. Agent selalu DB-first untuk fakta terstruktur.
5. Jika DB kosong, pakai KB/RAG dengan confidence gate.
6. Jika DB dan KB konflik, jawab DB dan buat inconsistency event.
7. Jika confidence rendah atau ada dua kandidat mirip, tanya klarifikasi natural.
8. Jangan auto-learn langsung ke policy produksi; simpan failed turns ke dataset evaluasi dan admin review.

### Auto-learning yang aman

Fondasi yang bisa dipakai:

- Golden set/evaluation data di dashboard schema.
- Tool traces dan policy events.
- Knowledge gaps/conflicts.
- Stuck-user tracker.
- Memory per user/session.

Batas aman:

- Agent tidak boleh mengubah DB resmi sendiri dari satu percakapan.
- Learning output berupa rekomendasi: new KB draft, alias kandidat, intent test case, atau tool policy proposal.
- Semua perubahan knowledge/policy harus admin-reviewed dan diuji golden regression.

## Dead Code dan Redundansi Kandidat

Audit ini tidak menghapus file/kode. Kandidat berikut butuh cleanup terencana atau validasi tambahan sebelum removal.

### 1. Stale compatibility path `complaint.created`

Referensi:

- `govconnect-case-service/src/services/complaint.service.ts:351-353`
- `govconnect-notification-service/src/handlers/event.handler.ts:49-55`

Bukti:

- Case service mencatat `COMPLAINT_CREATED` tidak dipublish lagi agar AI reply tidak dobel.
- Notification service masih punya handler untuk route lama.

Rekomendasi:

- Tandai sebagai legacy compatibility secara eksplisit atau hapus setelah dipastikan tidak ada producer lain.
- Dokumentasikan event topology final: urgent alert dan important contacts event tetap hidup.

### 2. Public complaint route validation duplicate

Referensi:

- `govconnect-dashboard/app/api/public/complaints/route.ts`
- `govconnect-dashboard/app/api/public/complaints/[id]/update/route.ts`

Bukti:

- Logic validasi channel/identity/WA/session tersebar di lebih dari satu route.

Rekomendasi:

- Pusatkan ke helper public complaint identity validator.
- Tambahkan tests untuk WA/webchat conflict dan missing session.

### 3. Channel-service fallback `village_id='unknown'`

Referensi:

- `govconnect-channel-service/src/services/message.service.ts` fungsi `resolveVillageId` yang tercatat di audit lintas service.

Risiko:

- Tenant missing dapat tersamarkan menjadi tenant sintetis.

Rekomendasi:

- Fail-closed untuk jalur persistence/history yang harus scoped.
- Jangan simpan pesan warga multi-desa tanpa `village_id` valid.

### 4. Legacy important contact category by name

Referensi:

- `govconnect-dashboard/app/api/important-contacts/categories/[id]/route.ts`
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts` field `important_contact_category` dan `important_contact_category_id`.

Risiko:

- Ada fallback name legacy yang membuat mental model relasi ganda.

Rekomendasi:

- Jadikan `important_contact_category_id` canonical.
- Migrasikan row legacy dari name ke id.
- Setelah data bersih, hapus fallback by name atau jadikan read-only dengan warning.

### 5. KB vector delete async setelah DB delete

Referensi:

- `govconnect-dashboard/app/api/knowledge/[id]/route.ts`
- `govconnect-dashboard/lib/ai-service.ts`

Risiko:

- Jika vector delete gagal setelah DB row hilang, AI vector orphan bisa tetap muncul di retrieval.

Rekomendasi:

- Gunakan outbox/tombstone delete.
- Buat reconciliation orphan vectors.

## Prioritas Perbaikan

### P0 - Konsistensi DB-first dan emergency/contact

1. Invalidate `complaintTypeCache` saat admin ubah kategori/type pengaduan.
2. Invalidate service catalog/requirements cache saat admin ubah layanan/requirements.
3. Filter inactive services dari AI-facing catalog.
4. Enforce answer-policy berdasarkan successful trusted tool trace, bukan sekadar `toolsUsed`.
5. Confidence gate untuk `search_knowledge` dan `search_documents`.

### P1 - Tenant isolation dan cross-service validation

1. Fail-closed role/scope headers di case-service metadata/service catalog endpoints.
2. Require `ServiceRequest.village_id` di schema setelah backfill.
3. Validate `important_contact_category_id` terhadap dashboard village ownership dari case-service.
4. Hapus/fail closed fallback `village_id='unknown'` untuk channel message persistence/history.

### P2 - Agent quality agar tidak bot

1. Centralize intent classifier dan tool policy matrix.
2. Persempit fast path/regex agar hanya guard aman.
3. Executor-side precondition untuk mutation tools.
4. Patch-friendly `update_complaint` agar warga bisa update sebagian field.
5. Clarification-first untuk ambiguity dan low confidence.

### P3 - KB consistency dan learning

1. Buat kontrak/observability KB embedding pending.
2. Outbox/tombstone untuk vector delete.
3. Perluas doc-vs-DB ke layanan, requirements, complaint types, dan contact categories.
4. Admin-reviewed learning loop dari failed turns, gaps, conflicts, dan golden set.

### P4 - Cleanup dan simplifikasi

1. Rapikan stale `complaint.created` path.
2. Pusatkan validator public complaint route.
3. Migrasi legacy important contact category name ke ID.
4. Tambah uniqueness/normalization yang belum ada untuk service categories dan data referensi per desa.

## Checklist Validasi yang Disarankan

- Admin desa mengubah type menjadi urgent; setelah invalidasi cache, AI langsung memperlakukan type tersebut sebagai urgent.
- Admin desa mengubah `send_important_contacts`; laporan baru menerbitkan event important contacts sesuai category ID desa tersebut.
- Kategori kontak penting desa A tidak pernah dipakai untuk complaint desa B.
- Warga tanya nomor puskesmas; agent mengambil dari DB contacts desa, tidak menduplikasi nomor, dan tidak memakai KB jika DB ada.
- Warga tanya “nomor KTP saya berapa”; agent tidak salah route ke important contact.
- Warga tanya daftar layanan; inactive services tidak muncul.
- Layanan offline tidak diberi link form online.
- Layanan online/both diberi link form sesuai service slug dan village slug yang benar.
- KB menyebut syarat berbeda dari DB; agent menjawab syarat DB dan menandai conflict.
- Tool knowledge low confidence menghasilkan jawaban jujur/uncertain, bukan klaim pasti.
- Message/history/channel tanpa village_id gagal atau ditolak, bukan masuk tenant `unknown`.
- Update complaint bisa patch parsial tanpa memaksa warga mengisi semua field.

## Kesimpulan

Sistem sudah mengarah ke AI CS pemerintahan multi-desa yang benar: DB-first, tool-capable, punya event notification, punya KB/RAG, dan punya guard anti-halusinasi. Gap utama bukan lagi ketiadaan fitur, tetapi ketegasan source of truth, cache invalidation, tenant scoping, confidence-aware grounding, dan pengurangan regex/template path.

Prioritas paling penting adalah memastikan perubahan admin desa langsung tercermin di AI, semua fakta terstruktur hanya dijawab dari tool DB yang sukses, emergency/contact sepenuhnya mengikuti konfigurasi DB desa, layanan inactive tidak ditawarkan, dan agent lebih banyak menggunakan reasoning + klarifikasi daripada fast template.
