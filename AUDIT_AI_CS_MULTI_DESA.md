# Audit AI CS Multi-Desa, Case Service, Dashboard, dan Redundansi Kode

Tanggal audit: 2026-05-11

Scope yang diaudit:

- `govconnect-ai-service`
- `govconnect-case-service`
- `govconnect-dashboard`
- alur laporan/pengaduan, pelayanan/service request, kategori per desa, nomor penting, emergency/urgent, knowledge base, RAG, tool agent, intent detection, UI vs backend, dan kandidat dead code.

Catatan batasan:

- Dokumen ini hanya berisi temuan yang didukung bukti kode.
- Tidak ada implementasi logic yang dilakukan pada audit ini.
- Kandidat dead code hanya direkomendasikan untuk verifikasi/penghapusan, belum dihapus.

## Ringkasan Eksekutif

Sistem sudah punya fondasi yang cukup kuat untuk AI customer service pemerintahan multi-desa:

- Tool agent sudah mencakup data desa, layanan, kategori pengaduan, nomor penting, knowledge base, dokumen, laporan, status, pembatalan, dan link/edit service request.
- Banyak operasi sudah village-scoped dengan `villageId` atau `village_id`.
- Backend complaint creation sudah menjadikan database complaint type sebagai sumber otoritatif untuk `is_urgent`, `require_address`, dan auto-send important contacts.
- RAG/knowledge diposisikan sebagai sumber pelengkap, bukan sumber utama untuk fakta terstruktur.
- Tool mutation dibuat serial dan diblokir pada mode non-production/evaluation.

Namun ada beberapa gap penting:

- Intent detection masih banyak berbasis regex/heuristic di beberapa tempat, sehingga rawan salah klasifikasi dan terasa seperti bot/template.
- Complaint metadata belum seketat service catalog dalam pembatasan scope desa untuk admin read/write.
- Important contacts berada di dashboard DB, tetapi case-service hanya menyimpan ID/nama kategori kontak tanpa foreign-key/validasi lintas service.
- Auto-send nomor penting bergantung pada konfigurasi complaint type, tetapi validasi cross-service kategori kontak belum kuat.
- Public complaint creation belum menolak missing address ketika type mengharuskan alamat.
- Service request detail dashboard berpotensi tidak mengirim `village_id` ke backend yang membutuhkannya.
- Ada beberapa file/alias kompatibilitas dan runtime log yang layak diverifikasi sebagai dead/redundant code.

## Prioritas Tertinggi

1. Pusatkan dan uji intent detection agar AI tidak salah jalur karena regex/fast intent yang tersebar.
2. Samakan enforcement scope desa untuk complaint categories/types dengan service categories/items.
3. Validasi `important_contact_category_id` lintas service sebelum disimpan di complaint type.
4. Tambahkan guard backend untuk `require_address` saat membuat complaint.
5. Perkuat answer-policy untuk jawaban knowledge/RAG agar tidak mengarang fakta terstruktur.
6. Batasi learned policy agar tidak bisa mengaktifkan mutation tools tanpa dukungan deterministic intent.
7. Audit dan bersihkan dead/redundant code secara bertahap setelah build/type-check.

## AI Agent CS: Intent, Tooling, dan Risiko Bot

### Temuan: Intent Detection Masih Tersebar dan Brittle

Bukti:

- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:299-327` berisi deteksi intent-family berbasis regex.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:356-420` menangani mixed intent.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:603-739` menangani ambiguous/tool-choice intent.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:1300-1919` berisi heuristic tool selection besar.
- `govconnect-ai-service/src/services/important-contacts.service.ts:210-276` punya detector sendiri untuk kontak penting dan emergency exclusion.
- `govconnect-ai-service/src/services/answer-policy.service.ts:68-85` dan `answer-policy.service.ts:133-158` punya classifier regex lain.

Risiko:

- Pertanyaan warga yang natural, campur konteks, atau pakai bahasa lokal bisa salah masuk template/jalur tool.
- Detektor di orchestrator, contact service, dan answer policy bisa drift.
- AI bisa terlihat seperti bot karena fast path menjawab sebelum memahami kebutuhan sebenarnya.

Rekomendasi:

- Buat satu modul canonical intent detectors dengan nama eksplisit, misalnya `detectContactLookup`, `detectActiveEmergency`, `detectServiceInquiry`, `detectComplaintCreation`, `detectStatusLookup`, dan `detectKnowledgeQuestion`.
- Jangan jadikan regex sebagai final answer path. Regex hanya boleh menjadi sinyal/routing awal, lalu LLM/tool validation tetap mengecek kebutuhan user.
- Tambahkan regression test untuk variasi bahasa Indonesia sehari-hari, typo, pesan bertahap, dan mixed intent seperti “mau lapor jalan rusak, nomor daruratnya ada?”
- Untuk low-confidence atau ambiguous intent, agent harus bertanya klarifikasi, bukan langsung menjawab template.

### Temuan: Tool Surface Agent Sudah Luas dan Relatif Aman

Bukti:

- `govconnect-ai-service/src/services/agent/tool-definitions.ts:20-378` mendefinisikan tool schema canonical.
- Tool mencakup village profile, service info, complaint categories, emergency contacts, important contact lookup, knowledge/document search, user memory, complaint creation/update, service request link/edit/history/status/cancel.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:915-1002` menjalankan tool calls, deduplication, parallel read-only tools, dan serial mutation tools.
- `govconnect-ai-service/src/services/agent/tool-executor.ts:232-258` memblokir mutation tools di non-production/evaluation.
- `govconnect-ai-service/src/services/agent/tool-executor.ts:290-359` melakukan sanitasi error tool.

Risiko:

- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:1101-1121` masih mendukung parsing text tool calls dari output model. Jalur ini lebih berisiko daripada native function calling.

Rekomendasi:

- Untuk production mutation, gunakan native function call saja.
- Jika text-tool fallback tetap ada, hard-deny mutation tools dari jalur text-tool fallback.
- Tambahkan audit log/metric untuk setiap text-tool invocation.

### Temuan: DB-First Sudah Ada, Tetapi Fallback Broadening Bisa Membuka Risiko RAG

Bukti:

- `govconnect-ai-service/src/services/agent/agent-prompt.ts:60-65` menyatakan database/tool sebagai sumber utama dan retrieval sebagai pelengkap.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:123-170` memberi prioritas trust/source ke DB/action tools.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:1384-1390` dan `agent-orchestrator.ts:1883-1886` menekan RAG/document tools jika authoritative DB tools tersedia.
- `govconnect-ai-service/src/services/agent/tool-executor.ts:843-1021` menandai knowledge/document retrieval sebagai untrusted retrieval.
- `govconnect-ai-service/src/services/knowledge.service.ts:101-141` mencoba RAG lalu fallback keyword.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:1888-1895` membroadening tool ke `get_village_profile`, `get_service_info`, `search_knowledge`, `search_documents` saat heuristic kosong.

Risiko:

- Query warga yang vague bisa masuk RAG/document terlalu cepat dan menghasilkan jawaban generic atau tidak grounded.
- Jika KB bertentangan dengan DB, agent bisa ragu atau menyampaikan fakta dari retrieval yang bukan sumber utama.

Rekomendasi:

- Untuk pertanyaan vague/low-confidence, prefer klarifikasi daripada broad RAG fallback.
- RAG/document hanya dipakai jika ada cue knowledge/document atau DB tidak punya data.
- Tambahkan metric saat fallback menyertakan `search_documents` agar bisa dievaluasi apakah membantu atau menambah hallucination.

### Temuan: Hallucination Guard Kuat Untuk Fakta Terstruktur, Lemah Untuk Knowledge Umum

Bukti:

- `govconnect-ai-service/src/services/agent/agent-prompt.ts:60-65` dan `agent-prompt.ts:81` melarang mengarang dan mengklaim aksi berhasil saat tool gagal/data kurang.
- `govconnect-ai-service/src/services/answer-policy.service.ts:39-66` mendefinisikan grounding untuk contact, service, village profile.
- `govconnect-ai-service/src/services/answer-policy.service.ts:291-333` rewrite jawaban ungrounded untuk kontak, service detail, dan village profile.
- `govconnect-ai-service/src/services/answer-policy.service.ts:336-445` menangani structured fact branches.
- Belum ada rewrite setara untuk jawaban knowledge/RAG umum.

Risiko:

- Knowledge answer bisa menyisipkan nomor, biaya, alamat, jam layanan, atau syarat yang tidak berasal dari DB.

Rekomendasi:

- Perluas answer-policy untuk `KNOWLEDGE_QUERY` dan tools `search_knowledge`/`search_documents`.
- Jawaban retrieval-only harus mencantumkan ketidakpastian atau fallback “belum menemukan informasi cukup akurat” jika grounding lemah.
- Blok structured facts dari retrieval-only kecuali juga didukung DB tools.

### Temuan: Learning/Adaptasi Ada, Tetapi Harus Dibatasi

Bukti:

- `govconnect-ai-service/src/services/agent/tool-policy.service.ts:46-68` memuat learned policies dari DB.
- `tool-policy.service.ts:85-138` melakukan resolve learned tool policy.
- `tool-policy.service.ts:140-213` melakukan upsert golden-set policy.
- `agent-orchestrator.ts:41-55` mengekspos learned tools dan matched policy.

Risiko:

- Learned policy yang salah/stale bisa menambah allowed tools yang tidak sesuai.

Rekomendasi:

- Learned policy tidak boleh memperkenalkan mutation tools jika deterministic intent tidak mendukung mutation.
- Log `matchedPolicySource`, `matchedPolicyConfidence`, actual tool calls, success, dan answer-policy rewrite.
- Pakai golden-set curated, bukan online learning bebas dari semua percakapan warga.

### Temuan: Bubble/Duplicate Handling Sudah Ada, Tapi Timestamps Bisa Mengganggu Intent

Bukti:

- `govconnect-ai-service/src/services/ai-orchestrator.service.ts:120-124` register in-flight processing.
- `ai-orchestrator.service.ts:181-207` skip superseded messages sebelum AI.
- `ai-orchestrator.service.ts:233-276` dedupe dan gabung bubble messages.
- `ai-orchestrator.service.ts:310-330` suppress stale response setelah AI.
- `agent-orchestrator.ts:946-963` dedupe tool calls.
- `ai-orchestrator.service.ts:255-265` menambahkan timestamp-prefixed lines untuk bubble transcript.

Risiko:

- Timestamp dan gabungan multi-message bisa memicu regex intent secara tidak sengaja.

Rekomendasi:

- Pisahkan normalized latest user intent text dari transcript penuh.
- Heuristic intent sebaiknya memakai normalized text tanpa timestamp, sementara LLM tetap menerima transcript untuk konteks.

## Multi-Desa, Complaint, Emergency, dan Nomor Penting

### Temuan: Emergency/Urgent Sudah Database-Driven Untuk Complaint Type

Bukti:

- `govconnect-case-service/prisma/schema.prisma:95-118` mendefinisikan `ComplaintType` dengan `is_urgent`, `require_address`, `send_important_contacts`, `important_contact_category`, dan `important_contact_category_id`.
- `govconnect-case-service/prisma/schema.prisma:34-35` menyimpan `Complaint.is_urgent` dan `Complaint.require_address`.
- `govconnect-case-service/src/services/complaint.service.ts:217-268` melakukan server-side authoritative resolution dari complaint type DB.
- `complaint.service.ts:293-317` enqueue event auto-send important contacts jika type mengaktifkan `send_important_contacts`.
- `complaint.service.ts:319-338` enqueue urgent alert jika resolved type urgent.

Kesimpulan:

- Sistem tidak semata-mata mendefinisikan emergency dari regex sistem. Untuk creation complaint, `is_urgent` berasal dari konfigurasi complaint type desa di DB.

Gap:

- AI emergency contact lookup masih memakai filter hints nama/deskripsi/kategori di `govconnect-ai-service/src/services/agent/tool-executor.ts:657-717`, khususnya `tool-executor.ts:674-677`.
- Jika desa memakai nama kategori lokal yang tidak cocok hint, kontak darurat valid bisa tidak muncul.

Rekomendasi:

- Untuk kontak emergency/darurat, jangan hanya filter by regex/hints. Pakai atribut DB yang eksplisit jika tersedia.
- Jika belum ada atribut eksplisit pada contact category/contact, tambahkan `is_emergency` atau type/category kind yang dipilih admin desa.
- Pastikan `is_urgent` tetap dipilih admin desa pada complaint type, bukan hardcoded sistem.

### Temuan: Complaint Metadata Read/Write Scope Lebih Lemah Dari Service Catalog

Bukti:

- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:58-65` list complaint categories memakai `village_id` jika ada, tetapi tanpa `village_id` bisa mengembalikan semua.
- `complaint-meta.controller.ts:169-185` list complaint types juga optional `village_id`.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:115-139` punya `resolveAdminCollectionVillageScope` yang lebih ketat untuk service catalog.
- `service-catalog.controller.ts:214-223` dan `service-catalog.controller.ts:325-358` memakai resolver scope untuk service categories/items.
- `complaint-meta.controller.ts:72-95` create category memakai header `x-village-id` jika ada, tetapi fallback ke body `village_id`.
- `complaint-meta.controller.ts:210-214`, `258-262`, dan `300-305` hanya membatasi write saat header desa tersedia.

Risiko:

- Admin endpoint complaint metadata bisa tidak konsisten antar desa jika proxy/header tidak lengkap.
- Bypass UI/proxy berisiko membuat/mengubah kategori/type desa lain.

Rekomendasi:

- Terapkan pola scope service catalog ke complaint metadata.
- Village admin wajib memakai `x-village-id` dan tidak boleh override body/query.
- Superadmin wajib memberi `village_id` atau `scope=all` untuk read list.
- Write tanpa authenticated scoped header atau explicit superadmin harus ditolak.

### Temuan: Important Contacts Ada di Dashboard DB, Tetapi Complaint Type Ada di Case-Service DB

Bukti:

- `govconnect-dashboard/prisma/schema.prisma:374-405` mendefinisikan `important_contact_categories` dan `important_contacts`.
- `govconnect-case-service/prisma/schema.prisma:95-118` menyimpan hanya `important_contact_category` dan `important_contact_category_id` pada `ComplaintType`.
- `govconnect-case-service/src/services/complaint.service.ts:293-317` memasukkan kategori kontak ke outbox event.
- `govconnect-dashboard/app/dashboard/pengaduan/kategori-jenis/page.tsx:155-183` UI mengambil kategori kontak dari dashboard API.
- `page.tsx:395-407` UI mengirim `important_contact_category_id` ke complaint type payload.
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:207-209` dan `263-266` hanya validasi presence, bukan keberadaan lintas DB.

Risiko:

- Stale ID kategori kontak bisa tersimpan.
- ID kategori dari desa lain bisa tersimpan jika endpoint dibypass.
- Auto-send nomor penting bisa gagal atau salah kategori jika consumer tidak memvalidasi village scope.

Rekomendasi:

- Pilih ownership model jelas:
- Opsi A: pindahkan important contacts ke case-service/shared service agar bisa foreign key dan transactional validation.
- Opsi B: tetap di dashboard DB, tetapi case-service harus memanggil internal validation endpoint untuk `important_contact_category_id + village_id` sebelum save.
- Opsi C: simpan snapshot category name/key dan village_id, lalu jalankan audit/sync eksplisit.
- Minimal: validasi lintas service sebelum create/update complaint type dengan `send_important_contacts`.

### Temuan: Auto-Send Nomor Penting Sesuai Type, Tetapi UI Wording Mencampur Kontak Penting dan Darurat

Bukti:

- `govconnect-dashboard/prisma/seed.ts:162-180` seeded important contact category termasuk non-emergency seperti `Pelayanan`.
- `govconnect-dashboard/app/dashboard/pengaduan/kategori-jenis/page.tsx:355-359` memakai wording “kontak darurat”.
- `page.tsx:378-382` mengulang wording “kontak darurat”.

Risiko:

- Admin desa bisa salah mengira `send_important_contacts` hanya untuk emergency, padahal field backend general.

Rekomendasi:

- Ubah wording UI menjadi “nomor penting/kontak penting”.
- Pakai “darurat” hanya jika complaint type/kategori memang urgent/emergency.

### Temuan: Address Required Belum Ditegakkan Saat Public Complaint Create

Bukti:

- `govconnect-case-service/prisma/schema.prisma:102` punya `ComplaintType.require_address`.
- `govconnect-case-service/src/services/complaint.service.ts:220-250` resolve `require_address` dari DB.
- `complaint.service.ts:284-285` menyimpan `require_address`.
- `govconnect-dashboard/app/api/public/complaints/route.ts:80-114` hanya validasi `village_id`, `kategori`, `deskripsi`, dan channel identity, bukan alamat.

Risiko:

- Complaint type yang butuh alamat tetap bisa dibuat tanpa alamat melalui public proxy/backend.

Rekomendasi:

- Backend case-service harus reject create complaint jika resolved type `require_address === true` dan `alamat`/location kosong.
- Validasi UI tetap boleh ada, tetapi sumber kebenaran harus backend.

## Layanan Publik, Public Form, dan Service Request

### Temuan: Setiap Desa Bisa Punya Layanan dan Syarat Berbeda, Backend Sudah Mendukung

Bukti:

- `govconnect-case-service/prisma/schema.prisma:152-176` mendefinisikan `ServiceItem` dengan `village_id`, kategori, slug, mode, requirements, dan fields.
- `govconnect-case-service/src/services/service-request-schema.service.ts:3-36`, `207-248`, dan `393-431` membangun schema submission dari service item.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:195-210`, `355-358`, dan `423-426` attach submission schema.
- `service-catalog.controller.ts:917-932` memvalidasi public service request terhadap schema backend.
- `service-catalog.controller.ts:917-920` menolak layanan offline-only untuk public submission.
- `govconnect-dashboard/app/form/[villageSlug]/[serviceSlug]/page.tsx:267-276` public form load service by slug.
- `page.tsx:432-448` submit public service request.

Kesimpulan:

- Public form service request sudah backend-driven dan mendukung per-desa/per-layanan berbeda.

Rekomendasi:

- Pastikan UI disable submit jika `submission_schema.submissionPolicy.allowsPublicSubmission === false`.
- Backend tetap menjadi source of truth untuk offline-only/online submission.

### Temuan: Service Request Detail Dashboard Berpotensi Tidak Mengirim `village_id`

Bukti:

- `govconnect-dashboard/lib/api-client.ts:306-310` `getServiceRequestById(id)` tidak menambahkan `village_id`.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:1037-1064` detail request enforce village isolation dan membandingkan `data.service?.village_id !== village_id`.
- `govconnect-dashboard/app/dashboard/pelayanan/[id]/page.tsx:327-337` memanggil local API detail by id.

Risiko:

- Detail service request bisa gagal jika Next API route tidak inject `village_id`.
- Jika ada bypass yang tidak scoped, isolation bisa lemah.

Rekomendasi:

- Jadikan `caseService.getServiceRequestById(id, village_id)` konsisten dengan `getLaporanById(id, village_id)`.
- API route dashboard harus resolve admin session/village dan pass `village_id` ke case-service.

### Temuan: `ServiceRequest.village_id` Nullable Meski Logic Menganggap Wajib

Bukti:

- `govconnect-case-service/prisma/schema.prisma:197-242` mendefinisikan `ServiceRequest.village_id String?`.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:971-983` creation selalu set `village_id` dari service.
- `service-catalog.controller.ts:787-790` listing membutuhkan `village_id`.
- `service-catalog.controller.ts:1130-1141` status update membutuhkan `village_id`.

Risiko:

- Data legacy/null bisa orphan dan tidak muncul di query normal.

Rekomendasi:

- Backfill `ServiceRequest.village_id` dari `service.village_id`.
- Migrasikan schema menjadi non-null.

### Temuan: History Complaint Ada, Service Request Belum Setara

Bukti:

- `govconnect-case-service/prisma/schema.prisma:120-132` punya `ComplaintUpdate`.
- `govconnect-case-service/src/services/complaint.service.ts:366-395` include updates pada complaint detail.
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:313-337` punya endpoint complaint updates.
- `govconnect-case-service/prisma/schema.prisma:197-242` `ServiceRequest` hanya punya latest fields seperti `status`, `admin_notes`, `result_file_url`, `result_file_name`, `result_description`.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:1171-1216` update status overwrite fields.

Risiko:

- Pelayanan tidak punya audit trail setara pengaduan.

Rekomendasi:

- Tambahkan `ServiceRequestUpdate` atau tabel generic `CaseStatusHistory` untuk complaint dan service request.
- Simpan old status, new status, admin id/name/role, note, attachment, delivery status, timestamp.

### Temuan: Status Validation Semantics Tidak Konsisten

Bukti:

- `govconnect-case-service/src/services/complaint.service.ts:524-527` invalid transition complaint throw `Error`.
- `govconnect-case-service/src/controllers/complaint.controller.ts:327-335` catch semua error menjadi 500.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:1165-1169` invalid service transition return 400.

Risiko:

- UI/admin mendapat 500 untuk kesalahan validasi business rule.

Rekomendasi:

- Complaint invalid status transition harus return 400 seperti service request.

## Knowledge Base dan Konsistensi DB vs KB

### Temuan: Knowledge/RAG Sudah Village-Scoped

Bukti:

- `govconnect-ai-service/src/services/knowledge.service.ts:12-17` punya context `villageId`.
- `knowledge.service.ts:98-100` memakai village context.
- `govconnect-ai-service/src/services/agent/tool-executor.ts:901-906` pass `villageId` ke knowledge search.
- `tool-executor.ts:972-977` pass `villageId` ke document search.

Kesimpulan:

- KB/RAG sudah dirancang per desa.

### Temuan: KB Sebagai Pelengkap Sudah Ada, Tetapi Perlu Conflict Policy Yang Lebih Tegas

Bukti:

- `govconnect-ai-service/src/services/agent/agent-prompt.ts:60-65` menyatakan DB/tool lebih utama daripada retrieval.
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:1384-1390` suppress RAG/document saat DB authoritative tersedia.
- `govconnect-dashboard/app/api/knowledge-consistency/scan/route.ts` dan `app/api/knowledge-consistency/[id]/resolve/route.ts` ada sebagai API konsistensi knowledge.
- Ada juga API `knowledge-conflicts` dan `knowledge-gaps` di dashboard routes.

Risiko:

- Jika DB dan KB berbeda makna, agent harus eksplisit memilih DB untuk fakta terstruktur, bukan “ragu” atau mencampur.
- Audit kode menemukan fasilitas consistency/conflict ada, tetapi audit ini belum menjalankan data scan aktual DB/KB.

Rekomendasi:

- Untuk layanan, syarat layanan, kategori pengaduan, nomor penting, dan profil desa: DB selalu menang.
- KB hanya menjawab jika DB tidak punya data atau user memang tanya dokumen/penjelasan umum.
- Tambahkan answer-policy yang mendeteksi konflik DB-vs-KB dan memaksa jawaban mengikuti DB sambil menyebut data dokumen perlu ditinjau admin.
- Jalankan scheduled knowledge consistency scan per desa dan tampilkan status konflik ke admin.

## Nomor Penting dan Anti-Duplikasi Jawaban

### Temuan: Contact Lookup Cukup Robust, Tetapi Emergency Filter Masih Hint-Based

Bukti:

- `govconnect-ai-service/src/services/agent/tool-definitions.ts:94-100` membedakan lookup nomor penting dari active emergency.
- `tool-definitions.ts:78-82` menyatakan emergency tool hanya untuk keadaan darurat berlangsung.
- `govconnect-ai-service/src/services/important-contacts.service.ts:221-245` mengecualikan active emergency dari directory lookup.
- `important-contacts.service.ts:330-382` scoring contact memakai aliases dan category hints.
- `govconnect-ai-service/src/services/agent/tool-executor.ts:757-833` mengembalikan confident vs ambiguous contact replies.
- `tool-executor.ts:657-717` emergency contacts filter local important contacts by emergency hints.

Risiko:

- Kategori lokal desa yang tidak cocok hint bisa tidak terkirim.
- Permintaan “nomor pelayanan X” harus bisa datang dari DB kontak penting atau KB, tetapi tidak boleh duplikat.

Rekomendasi:

- Tambahkan identity key untuk dedupe kontak sebelum menjawab, misalnya normalized phone + normalized name + category.
- Prioritas jawaban nomor: important contacts DB, lalu village profile DB jika relevan, lalu KB sebagai pelengkap.
- Jika DB dan KB mengandung nomor yang sama, tampilkan sekali dan sebut sumber paling otoritatif.
- Jika DB dan KB berbeda untuk entitas yang sama, jangan gabungkan. Jawab berdasarkan DB dan flag inconsistency untuk admin.

## UI vs Backend Consistency

### Konsisten: Public Complaint Types Village-Scoped

Bukti:

- `govconnect-dashboard/app/api/public/complaints/types/route.ts:9-20` mewajibkan `village_id`.
- `govconnect-case-service/src/controllers/complaint-meta.controller.ts:171-181` filter complaint types by village.

### Konsisten: Backend Otoritatif Untuk Complaint Classification

Bukti:

- `govconnect-dashboard/app/api/public/complaints/route.ts:20-36` dan `122-141` forward `type_id`, `category_id`, `is_urgent`.
- `govconnect-case-service/src/services/complaint.service.ts:217-268` resolve type/category/urgent dari DB dan mengabaikan klasifikasi payload jika tidak valid.

Catatan:

- Kontrak public form sebaiknya disederhanakan: kirim `type_id` dan label display saja, backend derive `category_id`, `is_urgent`, `require_address`, dan auto-send behavior.
- Jika `category_id` dikirim dan tidak match resolved type, backend sebaiknya reject.

### Tidak Konsisten: Service Category Belum Punya Scoped Uniqueness

Bukti:

- `govconnect-case-service/prisma/schema.prisma:136-150` `ServiceCategory` tidak punya `name_key` dan unique `[village_id, name_key]`.
- `govconnect-case-service/prisma/schema.prisma:75-93` `ComplaintCategory` punya `name_key` dan `@@unique([village_id, name_key])`.
- `govconnect-dashboard/prisma/schema.prisma:376-390` important contact categories juga punya scoped unique key.

Risiko:

- Satu desa bisa punya duplicate service category dengan nama sama/variasi kapitalisasi.

Rekomendasi:

- Tambahkan `name_key` ke `ServiceCategory` dan enforce `@@unique([village_id, name_key])`.

### Tidak Konsisten: Status Constants Tersebar

Bukti:

- `govconnect-case-service/prisma/schema.prisma:39` complaint status string comment.
- `govconnect-case-service/prisma/schema.prisma:207` service request status string comment.
- `govconnect-case-service/src/services/complaint.service.ts:497-503` transition map complaint.
- `govconnect-case-service/src/controllers/service-catalog.controller.ts:81-87` transition map service.
- `govconnect-dashboard/app/dashboard/pelayanan/[id]/page.tsx:97-198` label/options status di UI.

Risiko:

- Typos dan drift antar UI/backend.

Rekomendasi:

- Gunakan shared enum/module atau Prisma enum.
- Minimal, centralize status constants dan transition map.

## Dead Code dan Redundansi Kandidat

Catatan: belum dihapus. Perlu verifikasi build/type-check dan status git sebelum removal.

### Kandidat: `govconnect-dashboard/lib/api-cache.ts`

Bukti:

- Tidak ditemukan consumer nyata untuk `@/lib/api-cache`, `apiCache`, atau `createCacheKey`.
- File hanya punya contoh komentar dan export utility.

Rekomendasi:

- Verifikasi search ulang, hapus sementara, jalankan dashboard build/type-check.

### Kandidat: `govconnect-dashboard/app/form/laporan/page.tsx`

Bukti:

- File hanya import `notFound` dan langsung memanggil `notFound()`.
- `govconnect-dashboard/app/form/page.tsx` menyatakan pengaduan diarahkan via WhatsApp/Webchat.
- Link form aktif memakai `/form/${villageSlug}/${service.slug}` dari `govconnect-dashboard/app/dashboard/layanan/page.tsx:858`.

Rekomendasi:

- Cek access logs untuk `/form/laporan`, lalu hapus jika tidak ada kebutuhan kompatibilitas.

### Kandidat: Log Runtime AI Service

Paths:

- `govconnect-ai-service/ai-service-start.out.log`
- `govconnect-ai-service/ai-service-start.err.log`
- `govconnect-ai-service/ai-service-dev.out.log`
- `govconnect-ai-service/ai-service-dev.err.log`
- `govconnect-ai-service/ai-service-dev.log`

Bukti:

- Tidak ada referensi repo untuk filename tersebut.
- `govconnect-ai-service/package.json` script tidak mendeklarasikannya.

Rekomendasi:

- Jalankan `git status --short` dan `git ls-files govconnect-ai-service/*.log`.
- Jika untracked, hapus lokal dan pastikan `.gitignore` mencakup `*.log`.
- Jika tracked, inspeksi sensitive data sebelum remove dari git.

### Kandidat: `govconnect-dashboard/lib/seo-utils.ts`

Bukti:

- Tidak ada import `@/lib/seo-utils` atau `seo-utils`.
- `govconnect-dashboard/app/layout.tsx:5` memakai `@/lib/seo`, bukan `seo-utils`.

Rekomendasi:

- Search export names seperti `createPageMetadata`, hapus sementara, jalankan build/type-check.

### Kandidat: `components/seo/SeoHead.tsx`

Bukti:

- Diekspor dari `govconnect-dashboard/components/seo/index.ts:10`.
- Tidak ditemukan usage `<SeoHead>` atau import `SeoHead` selain barrel export.
- App Router sudah memakai Next metadata API.

Rekomendasi:

- Hapus export dulu, build/type-check, lalu hapus file jika aman.

### Kandidat: JSON-LD Wrappers Tidak Terpakai

Bukti:

- `FAQJsonLd`, `BreadcrumbJsonLd`, dan `ArticleJsonLd` hanya muncul di `components/seo/index.ts` dan definisi sendiri.
- `HomePageJsonLd` aktif dipakai di `govconnect-dashboard/app/page.tsx:43`.

Rekomendasi:

- Jangan hapus `JsonLd` dan `HomePageJsonLd`.
- Verifikasi lalu hapus wrapper yang tidak dipakai jika cleanup diinginkan.

### Kandidat: Compatibility API Aliases

Bukti:

- `govconnect-dashboard/lib/frontend-api.ts:805-834` punya block `BACKWARD COMPATIBLE EXPORTS`, `apiClient`, default export.
- `govconnect-dashboard/lib/api-client.ts:1216-1250` punya compatibility `apiClient` shorthand methods.
- Tidak ditemukan active usage untuk shorthand methods seperti `apiClient.getComplaints`, `apiClient.getComplaintById`, `apiClient.updateComplaintStatus`, `apiClient.getStatistics`, `apiClient.getTrends`.

Rekomendasi:

- Verifikasi import default/named `apiClient` dari kedua file.
- Jika tidak ada, hapus compatibility block bertahap.

## Roadmap Agar AI Menjadi CS Manusia yang Lebih Baik

### Prinsip Arsitektur

1. DB-first untuk fakta terstruktur: layanan, syarat, nomor penting, kategori pengaduan, urgent/emergency, profil desa, status laporan, status pelayanan.
2. KB/RAG hanya pelengkap: dokumen, kebijakan, penjelasan panjang, atau saat DB tidak punya data.
3. Jangan bergantung pada regex sebagai pengambil keputusan final.
4. Intent detection harus menghasilkan confidence dan alasan, bukan template answer.
5. AI harus tahu kapan bertanya klarifikasi.
6. Mutation tools harus membutuhkan data eksplisit, dan untuk aksi berisiko perlu confirmation policy yang enforce di executor/FSM, bukan hanya prompt.
7. Semua tool result harus membawa metadata scope: `village_id_used`, source, confidence, dan authoritative/non-authoritative.

### Fitur Yang Perlu Diprioritaskan

1. Central intent module + regression test bahasa warga.
2. RAG answer-policy verifier.
3. DB-vs-KB conflict detector runtime untuk structured facts.
4. Explicit emergency/contact category field di DB, bukan keyword hints.
5. Cross-service validation untuk important contact category.
6. Service request status history.
7. Strict per-village admin scope untuk complaint metadata.
8. Dedupe nomor penting lintas DB/KB.
9. Normalized bubble routing text.
10. Analytics untuk tool choice, fallback RAG, answer-policy rewrite, failed/ambiguous intent.

### Contoh Target Behavior

- Jika warga tanya “nomor bidan desa berapa?”: cari important contacts DB desa dulu, lalu KB jika DB kosong. Jika ditemukan di keduanya dan sama, kirim satu. Jika beda, jawab DB dan flag konflik.
- Jika warga tanya “mau lapor kebakaran”: jangan hanya kirim nomor penting. Buat flow emergency/urgent complaint sesuai complaint type DB desa, minta data minimum, dan kirim kontak penting yang dikonfigurasi admin desa untuk type tersebut.
- Jika warga tanya “syarat bikin surat domisili?”: cari service DB desa dulu. Jika service offline-only, jelaskan hanya diproses di kantor. Jika public submission allowed, tawarkan link form tool-generated.
- Jika warga memberi pesan campur “mau lapor jalan rusak, nomor PU ada?”: tangani sebagai mixed intent dengan complaint flow dan contact lookup, bukan salah satu saja.
- Jika pertanyaan ambigu “urus surat gimana?”: tanya jenis surat/layanan, jangan jawab template umum.

## Checklist Implementasi Lanjutan

1. Buat modul shared intent detectors dan test suite.
2. Tambahkan scope resolver complaint metadata setara service catalog.
3. Tambahkan validasi backend `require_address` saat complaint create.
4. Validasi important contact category lintas service.
5. Tambahkan answer-policy untuk RAG/knowledge.
6. Batasi learned policy untuk mutation tools.
7. Tambahkan dedupe contact answer.
8. Perbaiki `getServiceRequestById` agar pass `village_id`.
9. Tambahkan `ServiceRequestUpdate` atau generic history.
10. Backfill dan jadikan `ServiceRequest.village_id` non-null.
11. Tambahkan `ServiceCategory.name_key` dan unique `[village_id, name_key]`.
12. Centralize status constants.
13. Bersihkan dead/redundant code setelah verifikasi build/type-check.
