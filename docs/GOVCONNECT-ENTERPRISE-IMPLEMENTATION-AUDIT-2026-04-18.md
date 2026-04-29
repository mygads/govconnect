# GovConnect Enterprise Implementation Audit

Tanggal audit: 18 April 2026  
Status 2026-04-29: baseline implementasi historis; status AI gateway/provider runtime diperbarui oleh `govconnect-ai-service/docs/audit-2026-04-29.md` dan `govconnect-ai-service/docs/smart-routing.md`.  
Workspace: `C:\Yoga\Programming\containers\govconnect`

## 1. Scope

Audit ini memeriksa:

- `govconnect-ai-service`
- `govconnect-case-service`
- `govconnect-dashboard`
- kesesuaian dengan:
  - `docs/ENTERPRISE-MODERNIZATION-AUDIT-2026-04.md`
  - `docs/GOVCONNECT-DEFINITIVE-AUDIT-2026-04.md`
- praktik resmi publik dari Anthropic, OpenAI, Google Gemini, LangChain, LlamaIndex, dan Azure AI Search

Audit ini berbasis:

- inspeksi kode aktual
- perubahan implementasi yang dilakukan pada sesi ini
- verifikasi `npx tsc --noEmit`
- dokumentasi resmi primer yang ditautkan pada bagian akhir

## 2. Executive Verdict

### Status umum

GovConnect sekarang **sudah berada pada arsitektur single-agent with tools sebagai jalur reasoning utama**, bukan lagi pipeline intent-routing lama untuk query fakta umum.

### Kesimpulan utama

1. **Single agent with tools**: `sudah`
2. **Complaint/service tool coverage operasional**: `sudah`
3. **Hybrid memory durable + semantic recall**: `sudah`
4. **Hybrid RAG + RRF + threshold-late**: `sudah`
5. **Observability retrieval**: `durable dan aktif`, termasuk `candidate-level retrieval debug`
6. **Frontend-backend sync untuk biaya/SLA layanan**: `sudah diperbaiki`
7. **Cleanup deprecated/orphan lama**: `yang jelas orphan/deprecated sudah dibersihkan`

### Verdict akhir

Implementasi aktif **sudah layak disebut modern single-agent tool-calling architecture** dan **sudah jauh lebih dekat ke enterprise-ready** dibanding audit awal April 2026. Namun statusnya belum “sempurna tanpa gap”.

Gap yang masih tersisa sekarang bersifat **non-blocking tetapi penting untuk roadmap enterprise**:

- outer guard deterministik masih berada di luar agent loop, walau sekarang sudah durable dan observable
- trace/eval observability sudah durable dan punya release gate, tetapi belum sampai evaluator-grade per-step / model-judge
- memory observability sudah tampil di dashboard analytics, tetapi belum menjadi halaman observability tersendiri dengan alerting
- tool set masih cukup lebar, walau sekarang sudah memakai hybrid allowlisting: heuristic + learned policy dari eval
- analytics durable sudah bisa diekspor, tetapi belum otomatis dikirim ke warehouse/log pipeline lintas layanan

## 3. Temuan Implementasi Aktual

## 3.1 AI runtime: single agent with tools

### Status

`Compliant dengan caveat guardrail luar agent`

### Evidence

- Jalur utama masuk dari `src/services/unified-message-processor.service.ts::processUnifiedMessage`
- Reasoning/tool loop aktif di `src/services/agent/agent-orchestrator.ts::runAgent`
- Tool contract aktif di `src/services/agent/tool-definitions.ts`
- Tool execution aktif di `src/services/agent/tool-executor.ts`
- WhatsApp orchestrator `src/services/ai-orchestrator.service.ts` hanya menjadi wrapper transport-specific dan mendelegasikan ke `processUnifiedMessage`

### Penilaian

Ini sesuai dengan arah Anthropic/OpenAI: satu orchestrator agent dengan tool yang jelas dan deterministic tools untuk source-of-record.

### Caveat

Masih ada guardrail di luar agent untuk:

- spam/media/protocol guard
- pending confirmation state
- takeover / transport behavior

Lokasi utama:

- `govconnect-ai-service/src/services/unified-message-processor.service.ts`
- `govconnect-ai-service/src/services/pre-agent-state-router.service.ts`

Ini **bukan bypass fakta legacy**, tetapi **guardrail deterministik**. Untuk production, ini masih sah dan justru sejalan dengan safety guidance OpenAI.

## 3.2 Tool coverage

### Status

`Compliant secara operasional`

### Tool surface aktif

Deterministic facts:

- `get_village_profile`
- `get_service_info`
- `get_complaint_categories`
- `get_emergency_contacts`

Retrieval:

- `search_knowledge`
- `search_documents`
- `search_user_memory`

Actions:

- `create_complaint`
- `update_complaint`
- `create_service_request`
- `get_service_request_edit_link`
- `check_status`
- `cancel_request`
- `get_my_history`

### Penilaian

#### Complaint/pengaduan

Sudah mencakup:

- create
- update
- status
- cancel
- history

#### Service/pelayanan

Sudah mencakup:

- info
- create public form link
- edit link
- status
- cancel
- history

#### Q&A / knowledge

Sudah mencakup:

- profile facts
- layanan administrasi
- knowledge retrieval
- document retrieval
- emergency contacts
- user-memory recall

### Catatan

Jumlah tool aktif sekarang lebih banyak dari target audit internal 9 tools, tetapi masih berada di rentang praktik Google/OpenAI yang wajar selama schema dan deskripsinya disiplin.

## 3.3 Tool schema quality

### Status

`Sudah membaik`

### Evidence

- `strict: true` ditambahkan di `govconnect-ai-service/src/services/agent/tool-definitions.ts`
- `additionalProperties: false` ditambahkan di tool parameter schemas
- tool names sudah memakai snake_case yang jelas
- beberapa tool memakai enum ketat untuk kategori terbatas

### Penilaian

Ini selaras dengan best practice OpenAI dan Google:

- schema kuat
- nama deskriptif
- invalid states dibuat lebih sulit terjadi
- tool result lebih deterministic

## 3.4 Memory architecture

### Status

`Hybrid memory sudah ada dan lebih matang`

### Evidence

Short-term / thread / session state:

- `govconnect-ai-service/src/services/ump-state.ts`
- `govconnect-ai-service/src/services/state-persistence.service.ts`
- `govconnect-ai-service/src/services/ump-utils.ts`

Durable structured user profile:

- `govconnect-ai-service/prisma/schema.prisma`
- `govconnect-ai-service/src/services/user-profile.service.ts`

Durable episodic memory:

- `govconnect-ai-service/prisma/schema.prisma`
- `govconnect-ai-service/src/services/hybrid-memory.service.ts`

Semantic vector memory:

- `govconnect-ai-service/prisma/schema.prisma`
- `govconnect-ai-service/prisma/migrations/20260418_add_user_memory_vectors/migration.sql`
- `govconnect-ai-service/src/services/memory-vector.service.ts`

Agent memory retrieval:

- `govconnect-ai-service/src/services/agent/tool-definitions.ts::search_user_memory`
- `govconnect-ai-service/src/services/agent/tool-executor.ts`

### Penilaian

Memory sekarang sudah mengikuti pola hybrid yang jauh lebih sehat:

- short-term conversation state
- durable profile memory
- episodic memory
- semantic retrieval layer untuk memory recall

Ranking memory bukan pure vector-only; ia memadukan:

- semantic similarity
- lexical overlap
- recency
- importance
- operational relevance

Ini lebih cocok untuk AI CS pemerintah karena:

- lebih terkendali
- lebih mudah diaudit
- lebih aman untuk preferensi/fakta user
- tetap punya semantic recall lintas paraphrase

### Residual gap

Memory observability sekarang sudah tampil di dashboard analytics umum, termasuk trace summary dan candidate debug. Yang belum ada adalah halaman observability memory yang benar-benar terpisah, alerting, dan tren historis lintas periode.

## 3.5 RAG / retrieval architecture

### Status

`Sudah baik dan sesuai arah enterprise audit`

### Evidence

- hybrid retrieval di `govconnect-ai-service/src/services/hybrid-search.service.ts`
- RRF fusion aktif
- threshold-late logic sudah diperbaiki
- knowledge/document retrieval dipisah
- query expansion dan question variants tersedia
- confidence scoring tersedia
- conflict detection tersedia

### Penilaian

Kondisi sekarang sudah selaras dengan pola yang direkomendasikan:

- recall-first
- hybrid dense + keyword
- RRF merge
- semantic confidence
- post-retrieval packaging

### Perbaikan sesi ini

Observability retrieval kini aktif dan durable:

- `govconnect-ai-service/src/services/ai-analytics.service.ts::recordRetrievalTrace`
- `govconnect-ai-service/src/services/knowledge.service.ts::trackKnowledgeSearch`
- endpoint baru `GET /stats/analytics/retrieval`
- retrieval trace dipersist ke tabel `ai_retrieval_traces`
- dashboard `knowledge-analytics` kini menampilkan:
  - mode retrieval
  - confidence distribution
  - recent traces
  - latency
  - result count
  - top score
  - candidate debug per trace
  - vector/keyword rank dan score
  - RRF/rerank contribution

### Residual gap

Retrieval observability sekarang sudah durable, punya candidate-level debug, dan ikut tampil di dashboard. Yang belum penuh adalah:

- anotasi kualitas jawaban berbasis model-judge/per-step
- diff antar model/tool policy lintas run
- sink otomatis ke observability stack lintas service

## 3.6 Deterministic service facts: biaya dan SLA

### Status

`Sudah ditutup secara backend dan frontend`

### Evidence backend

- schema field di `govconnect-case-service/prisma/schema.prisma`
  - `estimated_cost`
  - `estimated_processing_time`
- controller support di `govconnect-case-service/src/controllers/service-catalog.controller.ts`

### Evidence AI

- dibaca oleh agent di `govconnect-ai-service/src/services/agent/tool-executor.ts::toolGetServiceInfo`

### Evidence frontend

- dashboard route create/update di:
  - `govconnect-dashboard/app/api/layanan/route.ts`
  - `govconnect-dashboard/app/api/layanan/[serviceId]/route.ts`
- admin form dan kartu layanan:
  - `govconnect-dashboard/app/dashboard/layanan/page.tsx`
- public form info card:
  - `govconnect-dashboard/app/form/[villageSlug]/[serviceSlug]/page.tsx`
- edit form info card:
  - `govconnect-dashboard/app/form/edit/[requestNumber]/page.tsx`
- admin detail page:
  - `govconnect-dashboard/app/dashboard/pelayanan/[id]/page.tsx`

### Penilaian

Sebelumnya field sudah ada di schema tetapi operator belum punya jalur input. Sekarang gap itu sudah ditutup.

### Residual gap

Kalau operator belum mengisi data katalog, output tetap bisa `null`. Ini sekarang bukan gap arsitektur lagi, tetapi gap kualitas data operasional.

## 3.7 Token efficiency

### Status

`Membaik, tetapi belum minimum-optimal`

### Yang sudah benar

- history dipindahkan ke role-based chat history, tidak dijejalkan seluruhnya ke system prompt
- memory diringkas sebelum masuk prompt
- response cache aman untuk kelas query tertentu sudah aktif
- tool responses dibuat lebih ringkas dan terarah
- schema tools lebih ketat, mengurangi retry/error loops

### Yang masih bisa ditingkatkan

- tool count aktif masih relatif banyak
- policy allowlisting masih berbasis term match + golden-set learning, belum policy engine yang lebih kaya
- token analytics durable belum terhubung ke cost dashboard lintas service

### Penilaian

Secara arah, sistem sekarang sudah jauh lebih hemat daripada arsitektur prompt-bloat lama. Dynamic tool allowlisting per turn yang memadukan heuristic + learned policy sudah menutup salah satu gap biaya/akurasi yang paling nyata. Release gate eval terbaru juga sudah ada. Langkah berikutnya yang paling bernilai adalah **policy tuning yang lebih kaya** dan **observability token/cost lintas layanan**.

## 3.8 Frontend / backend sync audit

### Status

`Sebagian besar sinkron; gap utama yang nyata sudah diperbaiki`

### Yang diperbaiki

1. Dashboard layanan sekarang bisa membuat dan mengedit:
   - biaya
   - estimasi waktu proses

2. Public form dan admin detail sekarang menampilkan:
   - biaya jika tersedia
   - estimasi waktu proses jika tersedia

3. Knowledge analytics dashboard sekarang membaca observability aktual dari AI service untuk:
   - retrieval
   - memory traces
   - outer guardrails
   - tool allowlisting policy
   - latest eval / release gate

### Gaps yang masih saya lihat

1. Halaman `knowledge-analytics` masih menggunakan fetch langsung ke route dashboard, bukan wrapper frontend API terpadu. Ini bukan bug fungsional, tetapi inkonsisten dengan pola client abstraction lain di dashboard.
2. Dashboard observability masih terkonsolidasi di satu halaman besar; belum ada drilldown page atau saved views per domain (retrieval, memory, guardrails, eval).

## 3.9 Deprecated / orphan / duplicate cleanup

### Dihapus pada audit dan implementasi ini

- `govconnect-dashboard/lib/graphql-client.ts`
  - ditandai deprecated
  - tidak punya importer
  - aman dihapus

- `govconnect-ai-service/src/services/knowledge.service.ts::searchKnowledgeKeywordsOnly`
  - tidak punya caller aktif
  - redundant terhadap flow retrieval yang sekarang

### Sudah dibersihkan sebelumnya pada jalur AI modernisasi

- `govconnect-ai-service/src/services/deterministic-fact-router.service.ts`
- `govconnect-ai-service/src/services/knowledge-handler.ts`
- `govconnect-ai-service/src/services/response-adapter.service.ts`

### Sengaja tidak dihapus

- `govconnect-ai-service/src/services/ai-orchestrator.service.ts`
  - masih aktif sebagai wrapper transport WhatsApp

- `govconnect-ai-service/src/services/pre-agent-state-router.service.ts`
  - masih aktif sebagai deterministic guardrail

- `govconnect-ai-service/src/services/context-builder.service.ts`
  - masih dipakai sanitization / compat path tertentu

- `govconnect-ai-service/src/services/conversation-context.service.ts`
  - masih dipakai jalur handler tertentu

### Repo hygiene gap

Instruksi repo merujuk ke `.github/skills/fullstack-feature/SKILL.md`, tetapi file itu **tidak ada** di workspace ini. Ini bukan bug runtime, tetapi merupakan gap dokumentasi/tooling repo.

## 4. Perbandingan terhadap Best Practice Resmi

## 4.1 Anthropic: Building effective agents

### Guidance resmi

Anthropic menekankan:

- mulai dari solusi sesederhana mungkin
- bedakan workflow vs agent
- gunakan augmented LLM dengan retrieval, tools, memory
- agent cocok untuk customer support yang perlu tools + external state
- toolset dan dokumentasi tool harus dirancang hati-hati

### Status GovConnect

`Mostly aligned`

Sudah sesuai:

- single orchestrator agent
- tool-driven execution loop
- deterministic tools untuk source-of-record
- retrieval sebagai augmentation
- memory sebagai augmentation

Belum penuh:

- trace/evals belum selengkap yang ideal
- masih ada guardrail luar agent

## 4.2 Anthropic: Writing effective tools for agents

### Guidance resmi

Anthropic menekankan:

- tool harus punya purpose yang jelas dan tidak overlap
- tool descriptions/specs harus dievaluasi
- terlalu banyak tool / tool overlap meningkatkan kebingungan agent
- tool response harus high-signal dan token-efficient
- evaluation-driven iteration adalah inti

### Status GovConnect

`Substantially aligned`

Sudah sesuai:

- nama tool jelas
- schema lebih ketat
- beberapa tool overlap lama sudah dibuang
- tool responses makin fokus
- response payload untuk memory/retrieval lebih terstruktur

Belum penuh:

- tool aktif masih relatif banyak
- allowlisting per turn sudah ada, tetapi policy learning-nya masih sederhana

## 4.3 OpenAI: practical guide, tool calling, safety, trace grading

### Guidance resmi

OpenAI menekankan:

- agents = model + tools + instructions
- tools harus reusable, standardized, dan jelas
- `strict: true` direkomendasikan
- jumlah function jangan terlalu banyak; kurang dari 20 adalah soft suggestion
- gunakan guardrails dan human oversight untuk high-risk actions
- gunakan traces, trace grading, dan evals untuk observability

### Status GovConnect

`Mostly aligned`

Sudah sesuai:

- arsitektur inti single agent dengan tools
- tools sudah `strict`
- cancel tetap butuh confirmation
- retrieval diperlakukan sebagai untrusted content
- observability retrieval kini aktif
- trace scoring, regression flag, dan release gate golden-set sudah durable
- dynamic tool subset per turn sekarang memadukan heuristic + eval-driven learned policy

Belum penuh:

- belum ada model-judge/per-step trace grading yang benar-benar setara platform agent builder
- allowlisting masih menggunakan policy sederhana berbasis term overlap + hasil golden set, belum adaptive policy engine

## 4.4 Google Gemini: function calling

### Guidance resmi

Google menekankan:

- parallel function calling
- compositional function calling
- function calling modes (`AUTO`, `ANY`, dst.)
- docstring/schema yang baik
- validasi sebelum action

### Status GovConnect

`Aligned secara konsep`

Sudah sesuai:

- agent loop mendukung multi-tool calls
- executor mendukung tool chaining lintas turn
- action high-risk tetap punya confirmation
- schema tools semakin ketat

Catatan:

Konfigurasi runtime GovConnect masih dominan `auto` di level panggilan model, tetapi allowlisting per turn sudah diterapkan sebelum tool list dikirim ke model.

## 4.5 LangChain dan LlamaIndex: memory

### Guidance resmi

LangChain/LangGraph dan LlamaIndex sama-sama menekankan:

- short-term memory dipisah dari long-term memory
- long-term memory harus durable
- semantic memory sebaiknya dapat dicari
- namespace penting untuk multi-tenant / per-user scoping
- memory bisa berupa profile + collection
- vector memory hanya salah satu block, bukan satu-satunya memory

### Status GovConnect

`Aligned secara arsitektural`

Sudah sesuai:

- short-term state ada
- durable long-term profile ada
- episodic collection ada
- semantic vector memory ada
- retrieval tool untuk memory ada

Belum penuh:

- belum ada procedural memory store eksplisit
- belum ada dashboard/alerting memory yang berdiri sendiri di luar halaman analytics gabungan

## 4.6 Azure AI Search: Hybrid + RRF

### Guidance resmi

Azure menekankan:

- parallel query execution
- RRF sesudah hasil ranked diperoleh
- fused ranking untuk hybrid
- observability/debug score penting

### Status GovConnect

`Aligned pada retrieval core dan observability candidate debug`

Sudah sesuai:

- hybrid dense + keyword
- RRF fusion
- threshold-late / ranking flow lebih sehat
- candidate-level retrieval debug sudah muncul di dashboard/admin

Belum penuh:

- belum ada explainer evaluatif per candidate yang menghubungkan retrieval score ke kualitas jawaban akhir

## 5. Remaining Gaps

Ini adalah residual gap yang masih nyata setelah implementasi sesi ini:

1. **Outer guard masih di luar agent**
   - spam/media/pending-state/takeover tetap ditangani deterministik di luar loop tool-calling
   - sekarang guardrail ini sudah durable dan observable
   - tetapi arsitektur tetap belum “all behavior inside agent”

2. **Trace/eval sudah ada, tetapi belum evaluator-grade penuh**
   - golden-set sekarang punya `trace_score`, `trace_grade`, `regression_detected`, dan `release_gate_pass`
   - dashboard juga sudah menampilkan latest eval run
   - tetapi belum ada per-step grading, model-judge, atau compare view lintas run/model

3. **Memory observability sudah ada, tetapi belum menjadi product observability terpisah**
   - admin sekarang sudah bisa melihat memory traces, source mix, memory type mix, dan candidate debug
   - tetapi belum ada halaman khusus, alerting, atau saved filters untuk domain memory

4. **Tool allowlisting sudah hybrid, tetapi policy engine masih sederhana**
   - per-turn subset sekarang memadukan heuristic regex + learned policies dari golden-set
   - event policy hit/miss juga sudah durable
   - tetapi policy matching masih berbasis term overlap, belum memakai classifier/policy model khusus

5. **Analytics durable sudah bisa diekspor, tetapi belum otomatis ke stack observability eksternal**
   - AI service sekarang bisa export JSON/NDJSON untuk interactions, retrieval, memory, guardrails, dan tool policies
   - dashboard juga sudah punya proxy export route
   - tetapi belum ada sink otomatis ke warehouse/log pipeline lintas service

6. **Repo instruction hygiene**
   - referensi skill `.github/skills/fullstack-feature/SKILL.md` tidak valid di repo ini

7. **LLM gateway keys belum terisi pada root compose env**
   - stack lokal sekarang bisa start sehat
   - tetapi lane `llm/embed/rag/rerank` tetap disabled bila `LLM_API_KEY`, `EMBED_API_KEY`, `RAG_API_KEY`, `RERANK_API_KEY` dibiarkan kosong
   - ini sekarang menjadi gap konfigurasi operasional, bukan gap arsitektur/runtime

8. **Parity `.env` per-service belum seluruhnya 1:1 dengan `.env.example`**
   - root compose env sekarang sudah sinkron
   - tetapi file `.env` lokal di beberapa service masih mengandung kombinasi key lama, key tambahan lokal, dan key baru yang belum di-copy penuh dari `.env.example`
   - ini tidak memblokir local compose karena compose memakai root `.env`, tetapi tetap menjadi hygiene gap untuk mode standalone per-service

## 6. Changes Implemented in This Audit Session

### AI service

- menambahkan persistence durable untuk `ai_interaction_events`
- menambahkan persistence durable untuk `ai_retrieval_traces`
- menambahkan persistence durable untuk `ai_memory_traces`
- menambahkan persistence durable untuk `ai_guardrail_events`
- menambahkan persistence durable untuk `ai_tool_allowlist_policies`
- menambahkan persistence durable untuk `ai_tool_policy_events`
- menambahkan retrieval observability trace
- menambahkan memory observability trace
- menambahkan outer-guard observability trace
- menambahkan tool allowlisting policy store + event logging
- menambahkan endpoint `/stats/analytics/retrieval`
- menambahkan endpoint `/stats/analytics/memory`
- menambahkan endpoint `/stats/analytics/guardrails`
- menambahkan endpoint `/stats/analytics/tool-policy`
- menambahkan endpoint export `/stats/analytics/export`
- menambahkan filter multi-tenant `village_id` untuk retrieval observability
- menghubungkan knowledge search ke analytics trace
- menambahkan candidate-level retrieval debug sampai ke dashboard
- menambahkan dynamic tool allowlisting per turn di agent orchestrator
- menggabungkan heuristic allowlist dengan learned policy dari golden-set
- menambahkan trace scoring dan release-gate metadata pada golden-set evaluation
- membuat evaluasi tool side-effects aman saat `isEvaluation`
- memperbaiki rate-limit key generator webchat agar kompatibel dengan IPv6 helper `express-rate-limit`
- mengaktifkan `ALLOWED_ORIGINS` local default untuk runtime AI
- menghapus script vector bootstrap lama `prisma/migrations/init_vector_db.sql` yang sudah tidak menjadi source of truth

### Dashboard

- menampilkan retrieval observability pada halaman `knowledge-analytics`
- menampilkan candidate debug per retrieval trace pada halaman `knowledge-analytics`
- menampilkan memory observability pada halaman `knowledge-analytics`
- menampilkan outer guardrail observability pada halaman `knowledge-analytics`
- menampilkan tool allowlisting policy observability pada halaman `knowledge-analytics`
- menampilkan latest eval / release gate pada halaman `knowledge-analytics`
- menambahkan export analytics JSON/NDJSON via dashboard route
- sinkronkan create/update layanan dengan field `estimated_cost` dan `estimated_processing_time`
- memperbaiki runtime API client supaya Docker build tidak gagal hanya karena `INTERNAL_API_KEY` belum tersedia saat build time
- tampilkan biaya/SLA di:
  - dashboard layanan
  - public form layanan
  - edit form layanan
  - detail admin permohonan layanan

### Cleanup

- menghapus `govconnect-dashboard/lib/graphql-client.ts`
- menghapus helper `searchKnowledgeKeywordsOnly()` yang orphan

### Infra / Docker / CI

- mengisi dan menegaskan `PROFILE_ENCRYPTION_KEY` sebagai syarat wajib local compose AI
- menambahkan fail-fast compose env check untuk `PROFILE_ENCRYPTION_KEY` pada `ai-service`
- mengubah Dockerfile `govconnect-ai-service` agar tidak lagi install dependency runtime dari registry
- mengubah Dockerfile `govconnect-dashboard` agar Prisma CLI runtime memakai binary lokal, bukan fallback install `latest`
- memastikan bootstrap `pgvector` AI berjalan otomatis saat container start
- mengubah workflow CI/CD agar migrasi container memakai Prisma CLI lokal (`./node_modules/.bin/prisma`)
- memperbaiki health check dashboard di workflow CI/CD dari endpoint `401` ke endpoint publik yang benar
- membuktikan `docker compose build` dan `docker compose up -d` lokal berjalan sukses untuk semua service

## 7. Verification

Perintah yang dijalankan:

- `cd govconnect-ai-service && npx tsc --noEmit`
- `cd govconnect-case-service && npx tsc --noEmit`
- `cd govconnect-channel-service && npx tsc --noEmit`
- `cd govconnect-dashboard && npx tsc --noEmit`
- `cd govconnect-notification-service && npx tsc --noEmit`
- `docker build -t govconnect-ai-service:local ./govconnect-ai-service`
- `docker build -t govconnect-dashboard:local ./govconnect-dashboard`
- `docker compose build`
- `docker compose up -d`
- health check host:
  - `http://127.0.0.1:3001/health`
  - `http://127.0.0.1:3002/health`
  - `http://127.0.0.1:3003/health`
  - `http://127.0.0.1:3004/health`
  - `http://127.0.0.1:3011/`

Hasil:

- `pass`
- seluruh 5 container local compose `healthy`

Catatan:

- audit ini tidak menjalankan live end-to-end ke gateway LLM production
- audit ini tidak menjalankan golden-set live run pada sesi ini
- AI service lokal tetap akan menonaktifkan lane LLM/RAG jika API key gateway tidak diisi pada root `.env`

## 8. Recommended Next Steps

Prioritas tertinggi berikutnya:

1. tambahkan trace grading yang lebih kaya: per-step grader, model-judge, dan compare lintas run/model
2. pecah observability menjadi halaman khusus untuk retrieval, memory, dan guardrails bila operator memang membutuhkannya
3. ekspor analytics durable ke warehouse/log pipeline bila butuh operasi lintas layanan
4. evolusikan dynamic tool allowlisting dari learned term-policy ke policy engine/classifier yang lebih kaya
5. rapikan dokumentasi repo yang masih merujuk skill/file yang tidak ada

## 9. Official Sources

Anthropic:

- https://www.anthropic.com/engineering/building-effective-agents
- https://www.anthropic.com/engineering/writing-tools-for-agents

OpenAI:

- https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- https://platform.openai.com/docs/guides/function-calling/how-do-i-ensure-the-model-calls-the-correct-function
- https://developers.openai.com/api/docs/guides/agent-builder-safety
- https://developers.openai.com/api/docs/guides/trace-grading
- https://help.openai.com/en/articles/8983136-what-is-memory

Google:

- https://ai.google.dev/gemini-api/docs/function-calling

LangChain:

- https://docs.langchain.com/oss/python/concepts/memory
- https://docs.langchain.com/oss/python/langchain/long-term-memory

LlamaIndex:

- https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/
- https://developers.llamaindex.ai/python/framework/integrations/retrievers/reciprocal_rerank_fusion/
- https://developers.llamaindex.ai/python/framework-api-reference/retrievers/query_fusion/

Azure:

- https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking
