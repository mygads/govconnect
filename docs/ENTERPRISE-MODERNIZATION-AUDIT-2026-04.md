# GovConnect Enterprise Modernization Audit
**Tanggal audit:** 17 April 2026  
**Sumber utama:** codebase aktual + perbandingan dengan dokumen lama + referensi praktik terbaru dari sumber resmi  
**Status:** Dokumen ini dimaksudkan sebagai referensi audit dan migrasi yang lebih akurat daripada dokumen audit lama yang sebagian sudah stale

---

## 1. Ringkasan Eksekutif

GovConnect saat ini **sudah jauh lebih matang** dibanding beberapa dokumen audit lama, tetapi **belum enterprise-ready** bila dilihat dari sudut:

1. **Reliability RAG**
   Sistem belum gagal karena “data kurang”, tetapi karena **retrieval pipeline terlalu kompleks, terlalu banyak gating, dan ada beberapa kebijakan ranking/caching yang secara struktural menurunkan recall**.

2. **Trust boundary antarlayanan**
   Masih ada **shared internal API key**, fallback secret yang tetap aktif, serta beberapa endpoint operasional/static asset yang masih **terbuka ke publik** pada service tertentu.

3. **Correctness lintas tenant**
   Ditemukan **bug cache katalog layanan lintas desa** di AI service yang bisa menyebabkan hasil layanan dari desa A dipakai di desa B selama TTL cache.

4. **Agent architecture**
   Sistem AI saat ini **bukan tool-calling agent enterprise**. Yang ada adalah **scripted orchestration pipeline**: micro-NLU -> prefetch RAG -> main LLM -> anti-hallucination gate -> handler -> kadang second LLM call. Ini kuat untuk MVP/iterasi cepat, tetapi makin sulit dipelihara, dievaluasi, dan ditune saat volume dan fitur bertambah.

5. **Eval maturity**
   Golden set sudah ada, tetapi **terlalu kecil**, histori hasil **hanya in-memory**, dan belum benar-benar menjadi loop kualitas yang persisten dan dapat dipakai sebagai release gate.

6. **Frontend/BFF discipline**
   Dashboard masih mengandung **banyak raw `fetch()`** dan tanggung jawab yang bercampur: admin UI, BFF, auth, proxy, observability, public form, dan internal bridge ke AI service.

Kesimpulan praktis:

- **Arsitektur sekarang masih bisa ditingkatkan tanpa rewrite total.**
- Namun jika targetnya benar-benar **enterprise-ready**, maka yang dibutuhkan bukan hanya “tune threshold RAG”, melainkan **pemecahan ulang arsitektur retrieval, tooling, observability, dan service-to-service trust**.

---

## 2. Realita Arsitektur Saat Ini

Audit ini dibuat berdasarkan **codebase aktual**, bukan asumsi dari instruksi lama.

### 2.1 Komponen aktual

- `govconnect-dashboard`: Next.js 16 + React 19
- `govconnect-ai-service`: Node.js/TypeScript, Prisma, pgvector, orchestrator AI/RAG
- `govconnect-channel-service`: WhatsApp/media/channel
- `govconnect-case-service`: complaint/service request/business case
- `govconnect-notification-service`: notifikasi

### 2.2 Bentuk arsitektur aktual

- Dashboard bertindak sebagai:
  - admin interface
  - BFF / proxy ke service lain
  - auth/session untuk admin
  - owner metadata knowledge base dashboard
  - beberapa internal API yang dipanggil AI service
  - public form/webchat endpoints
- AI service bertindak sebagai:
  - AI gateway consumer
  - vector store writer/query layer
  - orchestrator message processing
  - RAG pipeline
  - evaluator/stats/token usage collector
- Knowledge data saat ini tersebar ke dua lapis:
  - metadata utama di dashboard database
  - embeddings/vector chunks di AI service database

### 2.3 Implikasi arsitektur ini

- Keuntungannya: cepat dikembangkan, service boundary sudah mulai jelas.
- Kelemahannya:
  - ada **eventual consistency** antara dashboard knowledge metadata dan AI vectors
  - ada **banyak trust hop** berbasis shared secret
  - observability end-to-end belum matang
  - quality control retrieval dan response belum cukup deterministik

---

## 3. Temuan Utama

## 3.1 P0 / Sangat Mendesak

### Temuan A — Cache katalog layanan di AI service berpotensi salah lintas tenant

**Bukti kode:**

- `govconnect-ai-service/src/services/case-client.service.ts:698-726`
- `govconnect-ai-service/src/services/knowledge-graph.service.ts:127`
- `govconnect-ai-service/src/services/service-handler.ts:31-33`

**Masalah:**

`getServiceCatalog(villageId?)` menerima `villageId`, tetapi cache-nya hanya:

- `let serviceCatalogCache: ServiceCatalogItem[] | null = null`
- `let serviceCatalogCacheTime = 0`

Artinya cache **global**, bukan per-desa.

Jika desa A memicu pengambilan katalog duluan, maka selama TTL 15 menit, permintaan desa B bisa memakai katalog yang sama.

**Dampak:**

- LLM prompt bisa berisi daftar layanan desa yang salah
- service matching bisa salah
- knowledge graph service nodes bisa tercampur lintas tenant
- ini bukan sekadar “akurasi turun”, tetapi **potensi pelanggaran isolasi multi-tenant**

**Penilaian:**

- Severity: **P0 correctness / multi-tenant integrity**
- Perbaikan: cache harus di-key per `villageId`, dan `knowledge-graph.service.ts` tidak boleh memanggil `getServiceCatalog()` tanpa konteks tenant

### Temuan B — “Data sudah ada” tetapi retrieval tetap miss karena recall dipotong terlalu dini

**Bukti kode:**

- `govconnect-ai-service/src/services/rag.service.ts:38-39`
- `govconnect-ai-service/src/services/rag.service.ts:184`
- `govconnect-ai-service/src/services/rag.service.ts:383-443`
- `govconnect-ai-service/src/services/vector-db.service.ts:258-307`
- `govconnect-ai-service/src/services/hybrid-search.service.ts:94-103`
- `govconnect-ai-service/src/services/hybrid-search.service.ts:157-166`
- `govconnect-ai-service/src/services/hybrid-search.service.ts:209-216`
- `govconnect-ai-service/src/services/unified-message-processor.service.ts:1292-1311`
- `govconnect-ai-service/src/services/unified-message-processor.service.ts:1756-1778`

**Masalah inti:**

1. `DEFAULT_MIN_SCORE = 0.65` cukup agresif.
2. Query satu kata tidak di-expand:
   - `rag.service.ts:184` -> `if (wordCount <= 1) return query`
3. SQL vector search membuang kandidat di level database:
   - `vector-db.service.ts:280-290`, `333-344`
   - kandidat yang tidak lolos `minScore` **tidak pernah sampai ke reranker**
4. Keyword search masih memakai `to_tsvector('simple', ...)`, bukan pipeline lexical yang lebih cocok untuk variasi Bahasa Indonesia:
   - `hybrid-search.service.ts:94-103`, `157-166`
5. Stopword list sangat kecil dan tidak diikuti lexical enrichment yang kuat:
   - `hybrid-search.service.ts:209-216`
6. Pertanyaan baru hanya diprefetch jika `rag_needed` dianggap true:
   - `unified-message-processor.service.ts:1292-1311`
7. Bahkan setelah RAG prefetch ada, `QUESTION` intent tetap baru masuk knowledge handler jika `needs_knowledge` dari LLM utama bernilai true, kecuali kategori `kontak`:
   - `unified-message-processor.service.ts:1756-1778`

**Dampak:**

- Data yang sebenarnya ada di vector store atau dokumen tetap tidak pernah muncul ke jawaban akhir
- Masalah paling terasa pada query singkat seperti:
  - `KTP`
  - `jam`
  - `biaya`
  - `alamat`
  - `sabtu buka?`

**Penilaian:**

- Severity: **P0 reliability**
- Perbaikan: lihat bagian target RAG architecture

### Temuan C — Trust boundary masih lemah dan belum cocok untuk enterprise

**Bukti kode:**

- `govconnect-dashboard/lib/api-client.ts:32-47`
- `govconnect-ai-service/src/app.ts:66-72`
- `govconnect-channel-service/src/app.ts:27`
- `govconnect-case-service/src/app.ts:26`
- `govconnect-channel-service/src/app.ts:51-75`
- `govconnect-case-service/src/app.ts:32-82`
- `govconnect-ai-service/src/app.ts:423`
- `govconnect-ai-service/src/app.ts:950-951`
- `govconnect-channel-service/src/app.ts:34`

**Masalah:**

1. Dashboard masih punya fallback:
   - `INTERNAL_API_KEY = ... || 'dev-only-key-do-not-use-in-production'`
   - produksi tidak `throw`, hanya `console.error`
2. Internal auth di AI service masih compare `===` terhadap satu shared secret
3. Channel service memakai `cors()` terbuka
4. Case service dan channel service masih membuka:
   - `/metrics`
   - `/api-docs`
5. AI service masih membuka:
   - `/health/services`
   - `/uploads/documents`
6. Channel service masih membuka:
   - `/uploads`

**Dampak:**

- boundary antarservice lebih mirip “cluster internal yang saling percaya penuh” daripada zero-trust internal platform
- observability/docs/static assets masih menambah attack surface
- model enterprise dengan banyak tenant/lingkungan akan sulit diaudit dan diamankan bila tetap berbasis shared secret global

**Penilaian:**

- Severity: **P0 security / platform hardening**

---

## 3.2 P1 / Tinggi

### Temuan D — Knowledge creation di dashboard bersifat eventual-consistent dan bisa gagal diam-diam

**Bukti kode:**

- `govconnect-dashboard/app/api/knowledge/route.ts:196-205`

**Masalah:**

Saat knowledge baru dibuat di dashboard:

1. metadata disimpan di dashboard DB
2. sinkronisasi ke AI service vector DB dilakukan **fire-and-forget**
3. jika gagal, hanya `console.error`

**Implikasi langsung ke keluhan user:**

Admin melihat knowledge “sudah ada”, tetapi vector belum terbentuk atau gagal tersimpan. Dari sisi user, hasilnya terasa seperti:

> “Padahal datanya sudah lengkap, tapi AI masih gak ketemu.”

**Penilaian:**

- Severity: **P1 reliability**
- Perbaikan: ingestion harus asinkron tapi **observable**, punya job status, retry, dead-letter, dan state `pending_embedded` / `embedded` / `failed`

### Temuan E — Evaluasi kualitas belum layak jadi release gate

**Bukti kode:**

- `govconnect-ai-service/src/services/golden-set-eval.service.ts:49-50`
- `govconnect-ai-service/src/services/golden-set-eval.service.ts:177`
- `govconnect-ai-service/scripts/run-golden-set-eval.ts:5`
- `govconnect-ai-service/scripts/golden-set.json`
- `govconnect-dashboard/prisma/schema.prisma:72-104`

**Masalah:**

1. histori eval hanya disimpan di memory array:
   - `const history: GoldenSetSummary[] = []`
2. max histori hanya 10 run
3. script eval masih punya fallback secret hardcoded
4. sample golden set saat ini hanya **10 item**
5. padahal dashboard schema sudah punya tabel persistensi:
   - `ai_golden_set_runs`
   - `ai_golden_set_items`
   tetapi service belum memakainya

**Dampak:**

- tidak ada benchmark kualitas yang kuat sebelum deploy
- tidak ada slice per scenario, per tenant, per query type
- regression detection terlalu lemah untuk mengendalikan sistem sekompleks ini

**Penilaian:**

- Severity: **P1 quality assurance**

### Temuan F — Pipeline AI terlalu bertingkat untuk dijelaskan, diuji, dan ditune

**Bukti kode:**

- `govconnect-ai-service/src/services/unified-message-processor.service.ts`
- `govconnect-ai-service/src/services/knowledge-handler.ts`
- `govconnect-ai-service/src/services/context-builder.service.ts`
- `govconnect-ai-service/src/services/micro-llm-matcher.service.ts`

**Bentuk pipeline saat ini:**

1. spam/rate-limit checks
2. micro classifier
3. optional prefetch RAG
4. adaptive prompt build
5. main LLM
6. anti-hallucination validator
7. retry penuh bila perlu
8. handler routing
9. kadang second LLM khusus knowledge

**Masalah:**

- banyak keputusan kualitas dipecah ke banyak titik
- trace reasoning sulit diikuti
- biaya dan latency sulit diprediksi
- bug recall lebih susah diisolasi karena bukan satu failure point

**Penilaian:**

- Severity: **P1 architecture complexity**

### Temuan G — Conflict analytics tidak menyimpan similarity yang sebenarnya

**Bukti kode:**

- `govconnect-ai-service/src/services/rag.service.ts:736-762`

**Masalah:**

Saat conflict metadata dibangun, field:

- `similarityScore: 0`

diisi nol, bukan nilai jaccard/similarity aktual.

**Dampak:**

- dashboard conflict analytics menjadi kurang berguna
- admin sulit memprioritaskan konflik yang benar-benar mirip/berbahaya

**Penilaian:**

- Severity: **P1 analytics correctness**

### Temuan H — Dashboard FE belum disiplin terhadap API abstraction

**Bukti audit:**

- hasil pencarian `fetch(` di `govconnect-dashboard`: **160 occurrences**
- wrapper FE ada di `govconnect-dashboard/lib/frontend-api.ts`, tetapi belum menjadi satu-satunya jalur

**Masalah:**

- request policy tersebar
- error handling dan auth header management mudah drift
- refactor API lebih mahal
- sulit menambahkan tracing, retry, timeout, analytics secara konsisten

**Penilaian:**

- Severity: **P1 frontend maintainability**

---

## 3.3 P2 / Menengah

### Temuan I — `innerHTML` ada, tetapi temuan XSS lama perlu dikoreksi

**Bukti kode:**

- `govconnect-dashboard/app/dashboard/livechat/page.tsx:739`
- `govconnect-dashboard/components/seo/JsonLd.tsx:61`

**Penilaian ulang:**

- `innerHTML` di livechat memang **bad practice** dan harus dihapus
- tetapi potongan saat ini mengisi **HTML fallback statis**, bukan menyuntik konten user langsung
- jadi temuan lama yang menyebut ini sebagai XSS langsung perlu **diturunkan severity-nya**

**Status yang lebih akurat:**

- bukan “bukti eksploitasi XSS langsung”
- tetap “DOM mutation smell” dan harus direfactor ke JSX biasa

### Temuan J — Dokumentasi dan instruksi internal sudah drift dari codebase

**Contoh drift yang terverifikasi:**

- beberapa dokumen masih menyebut AI service “stateless”, padahal sudah ada:
  - `conversation_sessions`
  - `rate_limit_blacklist`
  - `ai_token_usage`
  - vector tables
- `docs/arsitektur-backend-lengkap.md` masih menyebut dashboard sebagai **Next.js 14+**, padahal package saat ini **Next.js 16**
- dokumen lama security masih menyebut `/api/status` dan `/metrics` AI service terbuka, padahal:
  - `/api/status` sekarang sudah diproteksi
  - `/metrics` AI service sekarang sudah diproteksi
- `govconnect-dashboard/README.md` masih boilerplate default dan tidak mencerminkan sistem nyata

**Dampak:**

- engineer baru bisa mengambil keputusan berdasarkan asumsi yang salah
- audit lama sulit dipakai sebagai backlog tanpa verifikasi ulang

---

## 4. Analisis Mendalam: Kenapa RAG Sering Tidak Menemukan Jawaban Padahal Datanya Ada

Bagian ini menjawab pertanyaan inti user:  
**“Kenapa user masih sering bilang jawaban dari RAG tidak ketemu padahal data RAG sudah lengkap?”**

Jawabannya: **karena masalah utama ada pada retrieval policy, orchestration, dan data flow, bukan hanya pada kelengkapan data.**

### 4.1 Jalur request knowledge saat ini

Secara sederhana, alurnya:

1. message masuk
2. unified micro classifier menilai `rag_needed`
3. jika iya, AI service memanggil `getRAGContext(...)`
4. query bisa di-expand
5. hybrid search berjalan
6. hasil bisa direrank
7. context disuntik ke prompt LLM utama
8. LLM utama menjawab
9. jika intent tertentu, knowledge handler bisa memanggil logic tambahan atau LLM kedua

Masalahnya: ada **terlalu banyak titik di mana recall bisa hilang**.

### 4.2 Penyebab konkret miss-rate

#### 1. Query singkat tidak di-expand

`rag.service.ts:184`

Jika query satu kata, expansion dihentikan. Padahal banyak query warga memang pendek:

- `ktp`
- `kk`
- `jam`
- `biaya`
- `alamat`

Untuk query seperti ini, yang dibutuhkan justru enrichment paling agresif.

#### 2. Hard filter diterapkan sebelum rerank

`vector-db.service.ts:280-290`, `333-344`

Kandidat dengan skor di bawah `minScore` dibuang langsung di SQL. Akibatnya:

- reranker tidak pernah melihat kandidat borderline yang sebenarnya relevan
- hybrid search kehilangan recall sebelum tahap yang seharusnya mengoreksi ranking

#### 3. Lexical retrieval belum cukup kuat untuk Bahasa Indonesia operasional

`hybrid-search.service.ts:94-103`, `157-166`, `209-216`

Saat knowledge ditulis sebagai:

- `Senin-Jumat 08.00-16.00`
- `Gratis`
- `Jl. Merdeka No. 1`

sedangkan user bertanya:

- `kapan buka`
- `sabtu buka gak`
- `berapa biaya`
- `kantornya dimana`

vector search saja sering tidak cukup, dan lexical search saat ini belum kuat menjembatani gap natural language ke data semi-terstruktur.

#### 4. Structured knowledge belum diproses sebagai structured facts

Ada banyak knowledge yang secara nature lebih cocok jadi **deterministic data**, misalnya:

- jam operasional
- alamat kantor
- link maps
- nomor penting
- daftar layanan aktif

Sebagian sudah punya deterministic handler, tetapi sistem keseluruhan masih terlalu sering memperlakukan knowledge sebagai **teks untuk diparse LLM**, bukan **facts untuk ditanya via tool/query**

#### 5. Knowledge prefetch tidak otomatis menjamin knowledge handler dipakai

`unified-message-processor.service.ts:1756-1778`

Untuk `QUESTION`, knowledge handler baru dipaksa jika:

- `needs_knowledge === true` dari LLM utama, dan ada preloaded context
- atau kategori `kontak`

Jadi ada situasi:

- RAG sebenarnya sudah menemukan context
- tetapi LLM utama memutuskan `needs_knowledge = false`
- hasil akhir memakai jawaban LLM biasa

Inilah salah satu akar **“RAG ada, tapi jawaban tetap meleset.”**

#### 6. Knowledge baru belum tentu langsung searchable

`dashboard/app/api/knowledge/route.ts:196-205`

Karena sync vector bersifat fire-and-forget, knowledge “terlihat ada” di dashboard tetapi belum tentu sudah embedded dan siap dicari.

#### 7. Evaluasi tidak cukup representatif

Dengan golden set 10 item, sistem bisa terlihat “baik” pada demo/test terbatas tetapi gagal di query nyata seperti:

- singkatan lokal
- typo warga
- pertanyaan singkat
- pertanyaan jam/alamat/biaya
- pertanyaan multi-intent
- data yang berada di dokumen PDF/table

#### 8. Retrieval dan generation masih terlalu terikat

Saat retrieval lemah, generation mencoba menambal. Saat generation salah, ada validator. Saat validator memicu retry, latency naik.  
Ini menghasilkan sistem yang tampak pintar, tetapi **sulit dipastikan konsisten**.

### 4.3 Diagnosis inti

Jika diringkas:

- **bukan terutama masalah data kurang**
- **bukan terutama masalah embedding model jelek**
- masalah utamanya adalah:
  - recall dipotong terlalu awal
  - deterministic facts belum dipisah tegas dari free-text RAG
  - orchestration terlalu berlapis
  - ingestion dan eval belum cukup observable

---

## 5. Hybrid RAG: Perbandingan Dengan Base Practice yang Lebih Baik

### 5.1 Apa yang saat ini sudah benar

Beberapa hal sudah sejalan dengan praktik modern:

- sudah ada **hybrid retrieval**
- sudah ada **reranking lane**
- sudah ada **query expansion**
- sudah ada **conflict/gap analytics**
- sudah ada **anti-hallucination layer**

Jadi fondasinya **bukan kosong**. Yang bermasalah adalah **cara penyusunan dan prioritasnya**.

### 5.2 Gap terhadap praktik yang lebih matang

Berdasarkan referensi resmi:

- Microsoft Azure AI Search menekankan bahwa hybrid search yang baik memakai **parallel retrieval + RRF**, dan relevance tuning perlu melihat **subscores/thresholds**, bukan hanya menaikkan cutoff mentah.
- Elastic juga merekomendasikan **RRF** sebagai baseline yang kuat untuk hybrid search.
- Microsoft juga menekankan **structure-aware chunking** dengan Document Layout / semantic chunking, terutama untuk dokumen yang memiliki heading, section, dan konten semi-terstruktur.

### 5.3 Arsitektur Hybrid RAG yang lebih cocok untuk GovConnect

Untuk case GovConnect, pola yang lebih sehat adalah:

1. **Deterministic facts first**
   Untuk:
   - alamat
   - jam operasional
   - kontak penting
   - daftar layanan aktif
   - profil desa inti

   jangan lewat jalur RAG bebas bila fact sudah ada di DB resmi.

2. **Recall-first retrieval**
   - naikkan kandidat awal
   - turunkan hard cutoff di tahap awal
   - rerank setelah recall terkumpul
   - lakukan abstain setelah rerank, bukan sebelum kandidat terlihat

3. **Structure-aware chunking**
   - heading + section + table-aware chunking
   - jam operasional dan persyaratan jangan pecah tanpa konteks heading

4. **Grounded generation**
   - generation harus menerima citations/sources yang jelas
   - untuk data konflik, tampilkan per sumber
   - untuk data kosong, abstain dengan alasan yang jelas

5. **Observable ingestion**
   - knowledge bukan “stored = ready”
   - knowledge harus punya status:
     - `created`
     - `chunked`
     - `embedded`
     - `indexed`
     - `failed`

6. **Eval by scenario**
   - per tipe query
   - per tenant
   - per language pattern
   - per knowledge source type

---

## 6. Penilaian Arsitektur Agent Saat Ini

### 6.1 Yang ada sekarang

Arsitektur saat ini lebih tepat disebut:

**AI orchestration pipeline**

bukan:

**enterprise tool-calling agent**

Karena keputusan utama masih digerakkan oleh:

- classifier + branching hardcoded
- prompt template besar
- handler khusus
- retry logic dan validator

bukan oleh agent yang:

- memiliki daftar tool eksplisit
- memilih tool berdasarkan kebutuhan
- memverifikasi hasil tool
- memberi jejak reasoning/action yang lebih eksplisit

### 6.2 Kelebihan arsitektur sekarang

- relatif cepat dibangun
- cocok untuk transisi dari chatbot rule-based ke AI-assisted service
- biaya bisa dikontrol dengan micro-LLM layers
- ada fondasi untuk analytics dan fallback

### 6.3 Kelemahan arsitektur sekarang

- sulit dijadikan platform agent umum
- sulit dijelaskan failure mode-nya
- terlalu banyak coupling antara retrieval, prompting, dan business handler
- semakin sulit ditest saat fitur tumbuh

### 6.4 Bentuk agent architecture yang lebih enterprise-ready

Untuk GovConnect, saya merekomendasikan **single orchestrator agent + deterministic tools + retrieval tools**, bukan langsung multi-agent penuh.

Urutan kedewasaannya:

1. **Single agent with tools**
   - tool `get_office_profile`
   - tool `get_office_hours`
   - tool `get_important_contacts`
   - tool `get_active_services`
   - tool `search_knowledge`
   - tool `search_documents`
   - tool `create_complaint`
   - tool `create_service_request`
   - tool `check_status`

2. **Verifier / judge only where useful**
   - bukan untuk semua jawaban
   - hanya untuk high-risk flows atau factual uncertainty

3. **Specialized sub-agents hanya jika benar-benar perlu**
   - misalnya document analyst
   - policy checker
   - summarizer untuk long history

OpenAI juga merekomendasikan memulai dari **single agent** dan naik ke multi-agent hanya saat kompleksitas benar-benar menuntutnya. Ini sangat relevan untuk GovConnect karena saat ini kompleksitas utamanya justru berasal dari pipeline bercabang, bukan dari kebutuhan sub-agent yang nyata.

---

## 7. Target Arsitektur Enterprise-Ready

## 7.1 Target Backend / AI Platform

### A. Knowledge Source Layer

Pisahkan jelas:

- **System of record / official facts**
  - profil desa
  - jam operasional
  - kontak penting
  - layanan aktif
  - kategori layanan
- **Knowledge narrative**
  - SOP
  - FAQ
  - panduan
  - dokumen PDF/Word
- **Derived retrieval artifacts**
  - chunks
  - embeddings
  - rerank candidates

### B. Ingestion Pipeline

Gunakan pipeline job-based:

- create knowledge/document
- parse
- chunk
- embed
- index
- verify sample retrieval
- mark ready

Semua tahap harus observable di dashboard.

### C. Retrieval Plane

Pisahkan retrieval menjadi:

1. **Fact tools**
   - query database resmi
2. **Knowledge retrieval**
   - hybrid search
   - rerank
   - citation packaging
3. **Failure feedback**
   - gap capture
   - conflict capture
   - low-confidence capture

### D. Response Plane

Jawaban akhir harus:

- memakai fact tool bila ada
- memakai citation bila dari knowledge/document
- abstain bila confidence rendah
- tidak menyembunyikan konflik data

### E. Evaluation Plane

Minimal:

- persistent eval runs
- 200+ golden queries bertahap
- slice per:
  - fact query
  - SOP query
  - short query
  - typo query
  - emergency/contact query
  - multi-tenant query
  - fresh-ingest query

### F. Security / Trust

Target enterprise:

- service-to-service identity per service, bukan shared global key
- internal endpoints dibatasi oleh network + identity + authz
- signed URL untuk file/document
- public observability endpoints dihapus atau diproteksi
- shared correlation id lintas dashboard -> channel -> AI -> case -> notification

### G. Untrusted Data Boundary

Untuk agent yang benar-benar production-grade, sistem harus membedakan dengan tegas:

- **trusted instructions**
  - system prompt
  - tool contract
  - business policy
- **trusted facts**
  - database resmi
  - service catalog resmi
  - kontak resmi
- **untrusted external content**
  - isi dokumen upload
  - hasil retrieval dokumen
  - URL dari konten
  - pesan user

Implikasinya:

- hasil retrieval tidak boleh diperlakukan setara dengan instruksi sistem
- tool berisiko tinggi harus punya policy/approval/human override
- agent tidak boleh “percaya” begitu saja pada link atau instruksi yang muncul di dokumen/user content
- untuk tindakan sensitif, gunakan prinsip: **beri kontrol yang sama atau lebih ketat daripada operator manusia**

## 7.2 Target Frontend / Dashboard

Dashboard sebaiknya diposisikan jelas sebagai:

- admin UI
- BFF ringan

Bukan sebagai tempat penumpukan semua concern.

Target FE:

- satu client abstraction untuk browser -> `/api/*`
- satu server client abstraction untuk BFF -> downstream services
- typed response contract yang konsisten
- knowledge ingestion status tampil eksplisit
- eval dashboard tampil per run/slice/trend

---

## 8. Roadmap Migrasi yang Disarankan

## Fase 0 — Stabilize dan ukur ulang

Target: 3-5 hari

- perbaiki cache katalog layanan menjadi per-village
- tambahkan correlation id lintas service
- tambahkan status ingestion knowledge yang nyata
- hapus fallback secret di production path
- proteksi endpoint publik yang tidak perlu

## Fase 1 — Naikkan kualitas retrieval sebelum rewrite agent

Target: 1-2 minggu

- turunkan early threshold recall
- jangan skip query expansion untuk single-word query
- perbesar candidate pool sebelum rerank
- simpan actual similarity score untuk conflict analytics
- perkuat lexical search Indonesia
- buat dashboard “why retrieval failed” berbasis trace

## Fase 2 — Pisahkan deterministic facts dari free-text RAG

Target: 2-3 minggu

- jadikan office profile/hours/contacts/services sebagai tool/data query resmi
- jangan lewatkan pertanyaan fact sederhana ke LLM bebas
- RAG fokus ke SOP, FAQ, dan dokumen naratif

## Fase 3 — Refactor ke tool-calling orchestration

Target: 3-5 minggu

- satu orchestrator agent
- tools eksplisit
- citations sebagai first-class output
- fallback/human escalation rule yang jelas

## Fase 4 — Enterprise hardening

Target: 2-4 minggu

- service identity / mTLS / workload identity
- signed URL media/documents
- central tracing + logs + metrics + dashboards
- persistent eval store + release gate

---

## 9. Status Dokumen Lama

| Dokumen | Status | Catatan |
|---|---|---|
| `docs/FULL-SYSTEM-AUDIT.md` | Perlu disupersede | Banyak insight masih berguna, tetapi beberapa severity dan status fix perlu diperbarui |
| `docs/SECURITY-AUDIT-REPORT.md` | Parsial stale | Beberapa temuan AI service sudah fixed, tetapi isu trust boundary dan static/public surface masih relevan |
| `docs/temuan.md` | Parsial stale | Masih berguna sebagai daftar temuan, tapi perlu verifikasi ulang per item |
| `docs/arsitektur-backend-lengkap.md` | Parsial stale | Secara konsep cukup baik, tetapi beberapa detail versi/platform/status service sudah drift |
| `docs/pengembangan.md` | Perlu review | Belum dijadikan referensi utama dalam audit ini |
| `docs/AI-GATEWAY-BEST-PRACTICES.md` | Masih relevan | Masih berguna untuk lane/gateway strategy, tetapi belum cukup menjawab masalah retrieval dan agent architecture end-to-end |

---

## 10. Rekomendasi Prioritas

Jika hanya memilih **5 pekerjaan pertama**, pilih ini:

1. **Fix cache katalog layanan per-village**
2. **Ubah knowledge ingestion menjadi observable dan tidak fire-and-forget diam-diam**
3. **Refactor retrieval menjadi recall-first, threshold-late**
4. **Pisahkan deterministic facts dari RAG narrative**
5. **Bangun eval set persisten dan representatif sebelum migrasi agent lebih jauh**

---

## 11. Kesimpulan

GovConnect tidak perlu dibuang dan ditulis ulang dari nol.

Yang dibutuhkan adalah:

- **membenahi kontrak antar lapisan**
- **membedakan fact system vs narrative knowledge**
- **menyederhanakan orchestration AI**
- **mematangkan trust boundary dan eval loop**

Masalah “RAG sering tidak ketemu” pada sistem ini **lebih banyak disebabkan arsitektur retrieval dan orchestration** daripada sekadar kualitas data.

Jika roadmap di dokumen ini diikuti, target realistisnya adalah:

- recall naik
- false negative turun
- jawaban factual lebih stabil
- tenant isolation lebih aman
- latency dan cost lebih mudah diprediksi
- sistem menjadi lebih mudah diaudit, di-scale, dan dimigrasikan ke model enterprise-ready

---

## 12. Referensi Eksternal

Referensi berikut dipakai sebagai pembanding praktik yang lebih baik pada tanggal audit ini:

- Microsoft Learn, *Relevance scoring in hybrid search using Reciprocal Rank Fusion (RRF)*  
  https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking
- Microsoft Learn, *Relevance in vector search*  
  https://learn.microsoft.com/en-us/azure/search/vector-search-ranking
- Microsoft Learn, *Chunk and Vectorize by Document Layout*  
  https://learn.microsoft.com/en-us/azure/search/search-how-to-semantic-chunking
- Elastic Docs, *Hybrid search*  
  https://www.elastic.co/docs/solutions/search/hybrid-search
- OpenAI, *Evaluation best practices*  
  https://developers.openai.com/api/docs/guides/evaluation-best-practices
- OpenAI, *A practical guide to building agents*  
  https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- OpenAI, *Designing AI agents to resist prompt injection*  
  https://openai.com/index/designing-agents-to-resist-prompt-injection/
- Anthropic, *Building agents with the Claude Agent SDK*  
  https://claude.com/blog/building-agents-with-the-claude-agent-sdk
