# GovConnect End-to-End Audit — AI CS Agent, Backend, UI, and Cross-Service Flow

Tanggal: 2026-05-10

Dokumen ini disusun dari audit codebase aktual, bukan asumsi. Fokusnya adalah apakah GovConnect sudah bergerak ke arah **AI CS agent yang pintar, natural, aman, grounded, dan operasional**, serta gap apa saja yang masih perlu ditutup.

## Scope audit

Audit ini mencakup:

- `govconnect-ai-service`
- `govconnect-dashboard`
- `govconnect-channel-service`
- `govconnect-case-service`
- `govconnect-notification-service`
- Dokumen arsitektur yang sudah ada, terutama:
  - `govconnect-ai-service/docs/ORCHESTRATION_OVERHAUL.md`
  - `govconnect-ai-service/docs/AUDIT-2026-05-10-SYSTEM-QUALITY.md`

## Metode audit

Saya memverifikasi temuan dengan membaca implementasi dan jalur integrasi utama, terutama:

- routing dan orchestration AI
- state / pending flow
- cache dan invalidation
- DB-first vs RAG
- observability dan traceability
- dashboard admin/testing flow
- lifecycle complaint / service request / notification
- queue and delivery behavior antar service

---

## Executive summary

Secara umum, fondasi GovConnect **sudah cukup kuat** untuk menjadi AI CS agent yang lebih baik daripada chatbot biasa, karena sistem Anda sudah punya beberapa hal yang paling penting dan biasanya justru tidak ada di banyak produk lain:

1. **Hybrid routing**, bukan murni regex dan bukan murni LLM.
2. **DB-first grounding** untuk structured facts penting.
3. **Complaint continuity** yang sudah mulai deterministic dan tidak gampang lupa konteks.
4. **Answer-policy + DB-vs-RAG reconciler** sebagai last-mile safety.
5. **Observability** yang relatif kaya untuk reasoning/tool trace.

Tetapi, dari audit end-to-end, sistem ini belum sepenuhnya terasa seperti **human CS AI agent yang matang** karena masih ada gap pada 4 lapis utama:

1. **AI/agent logic** masih cukup heuristic-heavy dan beberapa jalur masih mahal/brittle.
2. **Dashboard/admin UX** belum memanfaatkan banyak kemampuan backend yang sebenarnya sudah tersedia.
3. **Cross-service reliability** masih punya beberapa mismatch status/delivery yang bisa membuat sistem terlihat “selesai” padahal reply belum benar-benar sampai.
4. **Product capability layer** belum punya beberapa fitur yang membuat AI terasa seperti CS manusia: next-step coaching, promise tracking, clarification strategy, and operator workflows.

Kesimpulan singkat:

- **Arsitektur inti sudah benar.**
- **Risiko terbesar sekarang bukan “model bodoh”, tetapi integrasi, UX operasional, dan beberapa heuristic edge-case.**
- **Prioritas berikutnya sebaiknya bukan menambah regex lagi**, melainkan:
  - memperkuat reliability cross-service,
  - menyambungkan admin UI ke capability yang sudah ada,
  - mengurangi brittle policy duplication,
  - dan menambahkan capability yang membuat AI lebih terasa seperti CS manusia.

---

## A. Hal yang sudah benar dan layak dipertahankan

### A1. Layered hybrid routing sudah sehat

Dokumen arsitektur di `govconnect-ai-service/docs/ORCHESTRATION_OVERHAUL.md:12-32` dan alur runtime di `govconnect-ai-service/src/services/unified-message-processor.service.ts` + `govconnect-ai-service/src/services/pre-agent-state-router.service.ts` menunjukkan urutan yang sehat:

1. protocol guards
2. pending offer / pending state
3. complaint/status/contact/service shortcut
4. cache
5. agent orchestrator

Ini penting, karena AI CS yang bagus **tidak boleh membiarkan semua hal masuk ke model**. Jalur deterministik dipakai hanya saat memang lebih tepat, lebih murah, dan lebih aman.

### A2. Structured facts sudah diperlakukan sebagai data resmi

Kombinasi berikut adalah kekuatan utama sistem Anda:

- `govconnect-ai-service/src/services/agent/tool-executor.ts`
- `govconnect-ai-service/src/services/answer-policy.service.ts`
- `govconnect-ai-service/src/services/db-rag-reconciler.service.ts`

Structured facts penting seperti contact, service info, dan village profile sudah dibedakan dari retrieval umum. Ini adalah fondasi yang benar untuk mencegah AI menjawab “terdengar yakin” tapi salah.

### A3. Complaint flow sudah jauh lebih manusiawi dibanding chatbot biasa

`govconnect-ai-service/src/services/complaint-fsm.service.ts` dan jalur resume di `govconnect-ai-service/src/services/pre-agent-state-router.service.ts` menunjukkan bahwa sistem sudah mulai memahami bahwa complaint itu **proses**, bukan satu-turn Q&A.

Ini salah satu komponen yang paling membuat agen terasa seperti CS manusia.

### A4. Contact lookup vs emergency split sudah bagus

Pemisahan lookup biasa vs emergency aktif di:

- `govconnect-ai-service/src/services/important-contacts.service.ts`
- `govconnect-ai-service/src/services/pre-agent-state-router.service.ts`

adalah keputusan produk yang tepat. User yang bertanya “nomor damkar?” tidak diperlakukan sama dengan user yang bilang “rumah saya kebakaran”. Ini sangat penting untuk tone, urgency, dan trust.

### A5. Observability backend sudah jauh di atas rata-rata

Dari dokumen dan codepath observability, sistem sudah menyimpan:

- tool policy events
- tool execution traces
- guardrail events
- trace IDs
- memory/retrieval observability

Ini membuat audit, RCA, dan continuous improvement jauh lebih mungkin dilakukan secara serius.

---

## B. Temuan audit utama — AI agent / orchestration / reasoning

## B1. Tool policy dan routing masih terlalu heuristic-heavy

Referensi utama:

- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts`
- `govconnect-ai-service/src/services/pre-agent-state-router.service.ts`

Masalahnya bukan bahwa heuristic dipakai. Masalahnya adalah **jumlah heuristic dan regex policy sudah besar sekali**, sehingga biaya maintenance dan risiko regression meningkat.

Dampak:

- perubahan phrasing user bisa memecahkan behavior yang sebelumnya benar,
- reasoning system makin sulit dijelaskan secara konsisten,
- audit masa depan jadi mahal,
- tim akan cenderung terus menambah regex baru alih-alih memperbaiki control plane.

Rekomendasi:

- pindahkan rule yang sudah stabil ke bentuk yang lebih deklaratif,
- bedakan lebih tegas mana:
  - protocol/safety guard,
  - structured-fact routing,
  - state-resume routing,
  - mixed-intent clarifier,
  - agent fallback.

## B2. Ada duplication risk pada greeting / short-message policy

Referensi:

- `govconnect-ai-service/src/services/pre-agent-state-router.service.ts:809-857`
- `govconnect-ai-service/src/services/rag.service.ts:194-200`
- `govconnect-ai-service/src/services/agent/agent-orchestrator.ts:282-297`

Greeting/thanks/short-message detection muncul di beberapa layer. Walau saat ini tidak terlihat fatal, ini rawan drift:

- satu layer menganggap greeting,
- layer lain menganggap ambiguous short text,
- layer lain lagi hanya skip RAG.

Dampak:

- perilaku pesan pendek menjadi tidak konsisten,
- debugging jadi lebih susah.

Rekomendasi:

- buat satu policy/helper bersama untuk klasifikasi “trivial conversational turns”.

## B3. Cache-hit path sekarang lebih aman, tapi benefit cache sedikit berkurang

Referensi:

- `govconnect-ai-service/src/services/unified-message-processor.service.ts`
- `govconnect-ai-service/src/services/db-rag-reconciler.service.ts`

Cache hit sekarang tidak hanya return jawaban, tetapi juga menjalankan verifier/reconciler. Ini benar dari sisi safety, namun berarti cache path tidak lagi semurah sebelumnya.

Dampak:

- safety naik,
- tapi latency benefit cache turun pada structured fact path.

Rekomendasi:

- jangan rollback safety ini,
- tetapi tambahkan per-request memoization untuk profile/service/contact authoritative lookups,
- dan pertimbangkan fast path khusus untuk cache yang provenance-nya sudah jelas dan masih valid.

## B4. State persistence masih pragmatis, belum benar-benar durable-human-like

Referensi:

- `govconnect-ai-service/src/services/state-persistence.service.ts`

State persistence terlihat failure-tolerant, tetapi tidak sepenuhnya menjamin continuity panjang. Untuk AI CS yang terasa seperti manusia, context continuity sangat penting, terutama kalau user kembali setelah beberapa waktu.

Rekomendasi:

- definisikan SLA continuity:
  - complaint draft,
  - pending service clarification,
  - next promised action,
  - unresolved blocking step.
- pisahkan TTL untuk state yang sifatnya “transient chat” vs “ongoing service/complaint workflow”.

## B5. Observability sudah kaya, tapi masih dominan post-hoc

Referensi:

- observability paths di AI service
- `govconnect-ai-service/docs/ORCHESTRATION_OVERHAUL.md:55-71`

Saat ini observability sangat bagus untuk audit setelah kejadian. Yang belum terlihat kuat adalah **feedback loop operasional otomatis**.

Rekomendasi:

- alert jika rewrite answer-policy naik tajam,
- alert jika tool tertentu sering gagal,
- alert jika cache invalidation spike,
- alert jika fallback generik terlalu sering muncul per desa.

---

## C. Temuan audit utama — Dashboard / UI / operator workflow

## C1. Halaman testing AI menyimpan conversation history, tapi route tidak mengirimkannya

Referensi:

- `govconnect-dashboard/app/dashboard/testing-knowledge/page.tsx:65-75`
- `govconnect-dashboard/app/api/testing-knowledge/route.ts:27-41`

UI mengirim `conversationHistory`, tetapi route backend dashboard hanya forward:

- `message`
- `village_id`
- `user_id`

Tanpa `conversationHistory`.

Dampak:

- admin mengira sedang mengetes percakapan multi-turn,
- padahal backend hanya menerima single turn,
- hasil evaluasi konteks jadi misleading.

Ini penting karena Anda ingin agen terasa seperti human CS; pengujian multi-turn harus benar-benar multi-turn.

## C2. Error handling di testing UI bisa menyamarkan upstream failure

Referensi:

- `govconnect-dashboard/app/api/testing-knowledge/route.ts:51-69`
- `govconnect-dashboard/app/dashboard/testing-knowledge/page.tsx:77-83, 159-162`

Route dashboard untuk testing bisa mengembalikan `200` dengan payload `{ success: false }` pada kondisi upstream 5xx/catch. Sedangkan page hanya menganggap error bila `response.ok === false`.

Dampak:

- admin bisa melihat “Belum ada hasil” alih-alih error yang jelas,
- debugging jadi misleading.

Rekomendasi:

- kembalikan HTTP 5xx/502 saat AI service gagal,
- dan render error state eksplisit di UI.

## C3. Cache admin tooling terlalu kasar; targeted invalidation backend belum terpakai

Referensi:

- dashboard cache UI: `govconnect-dashboard/app/dashboard/settings/cache/page.tsx`
- cache route: `govconnect-dashboard/app/api/cache/route.ts:43-101`
- AI service endpoint: `govconnect-ai-service/src/app.ts:486-527`

AI service sudah punya endpoint `POST /admin/cache/invalidate-village`, tetapi dashboard cache saat ini hanya expose:

- clear-all
- set-mode

Dampak:

- operator cenderung clear global cache,
- padahal setelah edit kontak/layanan/profil desa, yang dibutuhkan adalah invalidation terarah.

Rekomendasi:

- tambahkan invalidation by village,
- invalidation by intent,
- invalidation retrieval/profile scoped.

## C4. Inconsistency review workflow belum menjadi fitur dashboard kelas satu

Referensi:

- tidak ada referensi `knowledge-consistency` di `govconnect-dashboard`
- backend route ada di `govconnect-ai-service/src/routes/knowledge-consistency.routes.ts`

Backend sudah punya capability inconsistency review, tetapi dashboard belum menggunakannya.

Dampak:

- capability bagus ini belum menjadi workflow operasional nyata,
- operator tidak punya panel khusus untuk menindak konflik AI/knowledge.

Rekomendasi:

- buat halaman “AI Inconsistencies” untuk:
  - list summary,
  - trigger scan,
  - resolve/ignore,
  - drill-down source.

## C5. Knowledge analytics saat ini terlalu delete-oriented, belum review-oriented

Referensi:

- UI delete action: `govconnect-dashboard/app/dashboard/knowledge-analytics/page.tsx:452-453, 480-511`
- API hard delete:
  - `govconnect-dashboard/app/api/knowledge-gaps/[id]/route.ts:5-35`
  - `govconnect-dashboard/app/api/knowledge-gaps/batch/route.ts:5-33`
  - `govconnect-dashboard/app/api/knowledge-conflicts/batch/route.ts:5-33`

Saat ini gap/conflict lebih banyak dihapus daripada diselesaikan secara operasional.

Dampak:

- history hilang,
- operator tidak punya state resolution yang jelas,
- sulit membedakan “noise” vs “known issue” vs “sudah dibereskan”.

Rekomendasi:

- ubah menjadi status workflow: `open`, `ignored`, `resolved`, `false_positive`.

## C6. System health page lemah dalam menampilkan failure state

Referensi:

- `govconnect-dashboard/app/dashboard/superadmin/system-health/page.tsx:70-83`

Halaman health hanya melakukan `if (res.ok) setData(...)` dan sisanya log ke console. Tidak ada error state UI yang jelas bila fetch gagal.

Dampak:

- blank or stale state bisa terlihat seperti “tidak ada masalah”,
- operator kehilangan visibility saat justru dashboard health sedang tidak bisa mengambil data.

Rekomendasi:

- tampilkan explicit error card,
- tampilkan last-known data jika ada,
- bedakan “service unhealthy” vs “dashboard gagal load observability”.

---

## D. Temuan audit utama — Cross-service reliability

## D1. Complaint lifecycle lebih kuat daripada service-request lifecycle

Referensi:

- complaint transition guard: `govconnect-case-service/src/services/complaint.service.ts:399-431`
- service request status update: `govconnect-case-service/src/controllers/service-catalog.controller.ts:621-639`

Complaint punya valid transition map. Service request status update hanya validasi enum, lalu langsung update.

Dampak:

- status service request bisa bergerak dengan aturan yang lebih longgar daripada complaint,
- dashboard, AI status answer, dan citizen trust bisa tidak konsisten.

Rekomendasi:

- terapkan transition guard yang setara untuk service request.

## D2. Webchat tidak punya jalur lifecycle notification yang nyata

Referensi:

- resolver event: `govconnect-notification-service/src/handlers/event.handler.ts`
- skip webchat: `govconnect-notification-service/src/services/notification.service.ts:30-55`

Untuk `WEBCHAT`, notification service secara eksplisit skip push notification dan hanya log status `skipped`.

Dampak:

- user webchat yang sudah leave/close tab tidak mendapat update lifecycle yang andal,
- AI CS terasa kurang reliable dibanding WhatsApp.

Rekomendasi:

- tambahkan delivery untuk webchat:
  - in-app inbox notification,
  - SSE/WebSocket replay,
  - atau fallback email/SMS bila tersedia.

## D3. AI service menandai status completed terlalu cepat

Referensi:

- AI publish reply + completed: `govconnect-ai-service/src/services/ai-orchestrator.service.ts:351-369`
- actual send happens later: `govconnect-channel-service/src/services/rabbitmq.service.ts:439-555`

AI service publish `completed` segera setelah publish reply event, padahal pengiriman aktual baru terjadi di channel-service.

Dampak:

- status operasional bisa menunjukkan “selesai” sebelum transport benar-benar sukses,
- membuka peluang mismatch antara analytics/UI vs kenyataan delivery.

Rekomendasi:

- jadikan channel-service sebagai source of truth untuk `completed` setelah transport sukses,
- AI service cukup sampai `processing` / `queued`.

## D4. Reply history bisa divergen dari what citizen actually received

Referensi:

- AI service store first, continue on failure: `govconnect-ai-service/src/services/rabbitmq.service.ts:816-830`
- channel-service intentionally does not store again: `govconnect-channel-service/src/services/rabbitmq.service.ts:440-442`

Jika store AI reply gagal tetapi publish/send berhasil, user bisa menerima reply, sementara history internal tidak lengkap.

Dampak:

- trace audit bisa hilang,
- operator melihat history yang tidak sama dengan real delivery.

Rekomendasi:

- gunakan outbox/idempotent persistence-delivery reconciliation,
- bukan best-effort di dua titik yang terpisah.

## D5. Retry / failure recovery masih berbasis in-memory

Referensi:

- `govconnect-ai-service/src/services/rabbitmq.service.ts`

Retry queue dan failure recovery di AI service masih dominan in-memory.

Dampak:

- restart process bisa kehilangan retry context,
- reliability horizontal dan recovery pasca-crash belum maksimal.

Rekomendasi:

- pindahkan retry/outbox ke durable mechanism:
  - DB-backed outbox,
  - delayed retry queue,
  - DLQ + replay tooling.

## D6. Ordering/dedup masih cenderung local-process, belum cluster-safe

Referensi:

- spam/bubble guards di AI service dan channel-service
- concurrency config dan in-memory state

Perilaku “latest message wins” tampak aman dalam satu instance, tetapi belum terlihat kuat bila multi-instance scaling digunakan.

Dampak:

- race/ordering issue bisa muncul saat scale-out,
- AI agent terasa inkonsisten di produksi multi-replica.

Rekomendasi:

- rancang per-user sequencing shared state atau key-partitioned queueing.

---

## E. Fitur yang bisa ditingkatkan agar AI terasa seperti human CS agent

Bagian ini bukan “fitur asal tambah”, tetapi capability yang secara langsung akan meningkatkan kualitas CS AI.

## E1. Mixed-intent clarifier

Saat user mengirim pertanyaan campuran, sistem sebaiknya mampu menjawab dengan gaya seperti:

- “Saya bisa bantu cek status atau bantu kontak petugasnya. Yang Bapak/Ibu maksud yang mana dulu?”

Bukan sekadar fallback atau salah pilih satu intent.

## E2. Next-best-action layer

Setelah jawaban utama, AI sebaiknya bisa memberi satu next step yang relevan dan tidak cerewet, misalnya:

- simpan nomor referensi,
- siapkan dokumen tertentu,
- konfirmasi apakah user ingin lanjut ajukan,
- atau arahkan ke kontak resmi bila jalur self-service tidak cukup.

## E3. Promise tracking / unresolved-step memory

Kalau AI sudah bilang “saya cek lagi” atau user sedang stuck di langkah tertentu, sistem perlu menyimpan janji/progress itu. Ini yang membuat AI terasa attentive, bukan sekadar stateless helper.

## E4. Citizen-friendly status narration

Status internal seperti `PROCESS`, `DONE`, `REJECT` sebaiknya selalu bisa ditransformasikan menjadi penjelasan ramah warga, konsisten, dan singkat.

## E5. Operator AI console yang benar-benar operasional

Dashboard ideal untuk AI CS seharusnya punya:

- trace search by user / trace / message
- one-click jump dari test result ke trace detail
- golden-set run/re-run dari UI
- inconsistency review queue
- targeted cache invalidation
- rewrite-rate / fallback-rate / tool-failure alerts

## E6. Webchat continuity parity dengan WhatsApp

Kalau webchat ingin dianggap channel utama juga, maka ia butuh:

- persisted notification inbox,
- message replay,
- resume after reconnect,
- delivery state yang setara.

---

## F. Prioritas roadmap yang saya rekomendasikan

## Phase 1 — Operator and reliability quick wins

Target: menutup gap yang paling terasa secara operasional tanpa mengubah otak agent terlalu banyak.

1. Forward `conversationHistory` di testing route.
2. Perbaiki HTTP status/error rendering di testing page.
3. Tambahkan targeted cache invalidation di dashboard.
4. Tambahkan dashboard page untuk `knowledge-consistency`.
5. Ubah workflow delete gap/conflict menjadi resolve/ignore/open.
6. Perbaiki system-health failure UX.

Hasil:

- tim bisa audit AI lebih benar,
- admin UX lebih matang,
- false debugging berkurang.

## Phase 2 — Cross-service correctness

Target: menyamakan sistem internal dengan apa yang benar-benar diterima warga.

1. Service-request transition guard seperti complaint.
2. Jadikan channel-service source of truth untuk `completed`.
3. Perkenalkan outbox/idempotent reconciliation reply persistence.
4. Durabilize retry / replay flow.
5. Desain webchat lifecycle notification path.

Hasil:

- status lebih jujur,
- reliability lebih kuat,
- audit trail lebih konsisten.

## Phase 3 — Human-like AI behavior layer

Target: menaikkan kualitas pengalaman user, bukan hanya correctness.

1. Mixed-intent clarifier.
2. Next-best-action generator yang bounded.
3. Promise tracking / unresolved-step memory.
4. Better citizen-facing status narration.
5. Repeat-failure detection dan stuck-user handling.

Hasil:

- AI lebih terasa seperti CS manusia,
- percakapan lebih natural,
- user tidak mudah tersesat.

## Phase 4 — Policy simplification and scale safety

Target: menjaga sistem tetap bisa dirawat saat makin besar.

1. Konsolidasikan duplicate trivial-turn policy.
2. Refactor heuristic tool policy ke deklaratif matrix.
3. Tambahkan per-request authoritative data memoization.
4. Rancang sequencing shared-state untuk multi-instance.
5. Tambahkan alerting atas rewrite/fallback/tool-failure spikes.

Hasil:

- maintainability naik,
- regression risk turun,
- scale-out lebih aman.

---

## G. Mana yang paling urgent vs mana yang nice-to-have

### Paling urgent

1. Testing route/context mismatch.
2. Dashboard error masking.
3. Targeted cache invalidation UI.
4. Service-request lifecycle guard.
5. Early `completed` status mismatch.
6. Webchat notification gap.

### Penting, tapi bukan blocker langsung

1. Duplicate greeting/short-turn policy.
2. Cache hit optimization via memoization.
3. Observability alert loop.
4. Knowledge gap/conflict workflow refinement.

### Strategic upgrades

1. Promise tracking.
2. Mixed-intent clarifier.
3. Human-style next-best-action layer.
4. Cluster-safe sequencing.

---

## Penilaian akhir

Kalau tujuan Anda adalah “AI agent yang pintar seperti human CS, tapi tetap aman dan full automated”, maka arah sistem saat ini **sudah benar**. Masalah utamanya sekarang bukan lagi “LLM bisa jawab atau tidak”, melainkan:

- apakah seluruh stack mendukung pengalaman itu secara konsisten,
- apakah operator bisa melihat dan memperbaiki masalah dengan cepat,
- apakah status/delivery/trace benar-benar sinkron,
- dan apakah AI punya behavior layer yang membuatnya terasa attentive, natural, dan tidak bot-like.

Ringkasnya:

- **Fondasi AI agent: bagus dan layak diteruskan.**
- **Operator UX: masih tertinggal dari kemampuan backend.**
- **Cross-service reliability: ada beberapa gap penting yang harus dirapikan.**
- **Human-like CS capability: siap ditingkatkan lewat phase yang jelas.**

Dokumen ini sengaja tidak berisi implementasi. Ini murni hasil audit dan roadmap.
