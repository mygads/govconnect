# Audit Arsitektur Agent GovConnect

Tanggal: 2026-04-24

## Ringkasan penilaian

Secara umum, arsitektur agent GovConnect **sudah cukup kuat dan jauh di atas chatbot FAQ sederhana**, tetapi **belum bisa disebut arsitektur agent layanan publik yang sudah matang sepenuhnya**.

Penilaian singkat:
- **Bagus** untuk kontrol produksi: ada deterministic guard, bounded tool loop, trust-aware retrieval, observability, dan handoff manusia.
- **Benar secara fondasi**: agent tidak dibiarkan bebas menjawab tanpa grounding; banyak alur sensitif sudah dijaga oleh orchestration dan tool boundary.
- **Belum sepenuhnya pintar/natural**: prompt aktif masih lebih tipis daripada kebutuhan perilaku warga nyata; klarifikasi ambigu belum selalu menjadi prioritas utama; tool forcing first turn masih bisa membuat respons terasa terlalu procedural.
- **Sudah mendekati best practice agent modern**, terutama pada separation antara deterministic routing, tool use, dan retrieval. Namun memory/state dan prompt/runtime alignment masih perlu dirapikan agar konsisten.

Kesimpulan praktis:
- Untuk **operasional layanan warga hari ini**, arsitektur ini **layak**.
- Untuk target **agent publik desa yang benar-benar natural, adaptif lintas desa, dan tahan edge case**, sistem ini **masih butuh 1 lapis penguatan desain**.

---

## 1. Peran agent dalam sistem

Agent GovConnect bukan seharusnya menjadi “otak tunggal” yang memutuskan semuanya. Runtime aktif justru lebih sehat karena agent hanya menjadi **lapisan reasoning terkontrol** di tengah sistem yang masih memiliki guard deterministic.

Peran agent saat ini:
- memahami maksud warga yang tidak selalu persis cocok dengan route/regex sederhana
- memilih tool yang relevan untuk info, status, layanan, pengaduan, atau pencarian knowledge
- menyusun jawaban natural berbasis hasil tool
- tetap tunduk pada boundary sistem: pending state, protocol guard, cache, ownership, tenancy, dan human handoff

Ini adalah pola yang lebih sehat daripada agent murni bebas, karena layanan publik butuh prediktabilitas.

---

## 2. Lifecycle request runtime aktif

Runtime agent yang benar-benar aktif saat ini berpusat di [unified-message-processor.service.ts](../../govconnect-ai-service/src/services/unified-message-processor.service.ts), lalu masuk ke [agent-orchestrator.ts](../../govconnect-ai-service/src/services/agent/agent-orchestrator.ts), [agent-prompt.ts](../../govconnect-ai-service/src/services/agent/agent-prompt.ts), dan [tool-executor.ts](../../govconnect-ai-service/src/services/agent/tool-executor.ts).

Alur runtime aktif secara ringkas:

1. **Ingress message**
   - pesan masuk dari WhatsApp/webchat diterima oleh Unified Message Processor
   - dilakukan sanitasi awal, panjang pesan, spam/protocol checks, dan pengambilan history seperlunya

2. **Deterministic interception sebelum agent**
   - [pre-agent-state-router.service.ts](../../govconnect-ai-service/src/services/pre-agent-state-router.service.ts) mencoba menangani kasus yang lebih aman bila diproses secara deterministik:
     - pending offer
     - pending complaint/service follow-up
     - konfirmasi YA/TIDAK
     - status/cancel by number
     - beberapa pola emergency dan public-service out-of-scope

3. **Context assembly**
   - runtime memuat memory summary, profil warga, konteks sentimen, dan konteks percakapan
   - response cache juga dipakai untuk subset tool tertentu yang aman di-cache

4. **Agent execution**
   - [agent-orchestrator.ts](../../govconnect-ai-service/src/services/agent/agent-orchestrator.ts) menjalankan bounded tool-calling loop
   - allowed tools disusun dari gabungan heuristik + learned tool policy
   - model memilih/memanggil tool, menerima hasil terstruktur, lalu menyusun jawaban akhir

5. **Tool-grounded response**
   - [tool-executor.ts](../../govconnect-ai-service/src/services/agent/tool-executor.ts) mengembalikan hasil tool dengan trust level eksplisit:
     - `trusted_fact`
     - `trusted_record`
     - `untrusted_retrieval`
     - `action_result`
   - ini fondasi bagus untuk mencegah retrieval diperlakukan sebagai fakta absolut

6. **Post-processing & escalation**
   - response dinormalisasi supaya intro robotik seperti “berdasarkan informasi/data” dikurangi
   - jika ada sinyal percakapan macet, sentimen buruk, atau explicit request, sistem bisa mengaktifkan human handoff

7. **Observability**
   - analytics, retrieval debug, dan trace perilaku dicatat agar audit/debug bisa dilakukan

Secara arsitektur, ini berarti GovConnect memakai pola:
- **deterministic front door**
- **bounded agentic middle layer**
- **tool-grounded answer generation**
- **operational fallback/handoff**

Itu adalah pola yang sehat untuk layanan publik.

---

## 3. Prompt architecture aktif vs prompt yang lebih kaya

Ada dua realitas prompt yang penting:

### Prompt aktif runtime
Prompt aktif dibangun di [agent-prompt.ts](../../govconnect-ai-service/src/services/agent/agent-prompt.ts).

Kelebihannya:
- singkat
- fokus tool-grounding
- melarang mengaku AI/bot/LLM
- sudah menekankan jangan mengarang
- sudah mengarahkan untuk klarifikasi bila ambigu

Kekurangannya:
- belum sekaya kebutuhan perilaku CS manusia
- belum cukup kuat untuk variasi emosi, ragam bahasa, transisi halus, atau continuity warga
- belum sekuat prompt yang lebih lama dalam mengatur variasi phrasing dan human-like service style

### Prompt lebih kaya tapi tampaknya bukan jalur utama runtime
Prompt di [system-prompt.ts](../../govconnect-ai-service/src/prompts/system-prompt.ts) justru lebih matang untuk layanan warga:
- melarang pembuka robotik berulang
- lebih tegas soal klarifikasi ambiguity
- punya adaptive prompt composition
- lebih dekat ke persona petugas layanan manusia
- punya detail yang lebih kaya untuk complaint/service/status behavior

### Penilaian
Ini menunjukkan **arsitektur prompt belum sepenuhnya sinkron dengan runtime**.

Bukan berarti sistem salah total, tetapi ada gap penting:
- desain prompt yang lebih baik **sudah ada**
- namun runtime aktif masih memakai prompt yang lebih tipis

Implikasi praktis:
- naturalness dan consistency belum maksimal bukan karena model semata, tetapi karena **prompt strategy terbaik belum jadi source of truth runtime**.

---

## 4. Tool-calling model dan policy

### Yang sudah bagus
Tool surface saat ini cukup eksplisit dan production-friendly. Agent tidak diberi akses liar; ia memakai daftar tool yang sudah didefinisikan untuk capability tertentu.

Kekuatan utamanya:
- capability surface cukup jelas
- tool result terstruktur
- trust level dibedakan
- `suggested_response` tersedia untuk beberapa tool seperti service info
- agent loop dibatasi jumlah iterasi dan timeout

Ini sejalan dengan praktik modern yang baik: **tool use should be explicit, bounded, and typed**.

### Titik lemah utama
Di [agent-orchestrator.ts](../../govconnect-ai-service/src/services/agent/agent-orchestrator.ts), first turn memakai pola `required` jika ada allowed tools.

Dampaknya:
- agent cenderung dipaksa memakai tool terlalu cepat
- pada kasus ambigu, agent bisa terasa terlalu procedural
- ruang untuk respons klarifikasi ringan sebelum tool call jadi berkurang

Untuk layanan warga, ini penting. Banyak pesan warga tidak ideal, misalnya:
- “saya mau lapor”
- “itu gimana ya”
- “mau urus surat”
- “kok belum ada kabar”

Kasus seperti ini sering lebih baik ditangani dengan:
1. klarifikasi singkat dulu
2. baru tool call bila intent sudah lebih tegas

### Penilaian
- untuk reliability, pendekatan sekarang **aman**
- untuk naturalness dan ambiguity handling, pendekatan sekarang **masih kaku**

Best practice yang lebih ideal:
- **clarify-before-force** untuk first turn ambigu
- **force tool only when operational intent is already clear**

---

## 5. Memory dan state yang dipakai agent

GovConnect saat ini sebenarnya memiliki **statefulness yang lumayan kuat**, tetapi belum sepenuhnya ter-unifikasi.

Lapisan state/memory yang terlihat:
- memory summary percakapan
- pending state di pre-agent router
- takeover/handoff state di channel layer
- user/profile context
- memory event pada beberapa aksi seperti complaint/service flow
- response cache untuk subset tool tertentu

### Yang sudah bagus
- sistem sadar bahwa percakapan warga itu multi-turn
- alur seperti “balas iya”, edit/cancel, dan status follow-up tidak sepenuhnya dibebankan ke model
- ada memory event dan summary, bukan sekadar stateless Q&A

### Yang belum sehat sepenuhnya
State dan memory masih tersebar di banyak tempat:
- handler
- pre-agent router
- tool executor
- summary builder
- cache
- takeover status

Akibatnya:
- reasoning continuity belum selalu konsisten
- beberapa perilaku terasa “stateful tapi terpecah”, bukan memory architecture yang benar-benar bersatu
- sulit memastikan aturan lintas flow tetap konsisten saat sistem makin besar

### Penilaian
Arsitektur memory sekarang **cukup untuk operasional**, tapi **belum ideal sebagai long-term agent memory design**.

Pola yang lebih sehat ke depan:
- pisahkan jelas antara:
  - **conversation state** (pending confirmation, current flow)
  - **user profile memory** (nama, preferensi, identitas ringan)
  - **case memory** (service/complaint references)
  - **operational handoff state**
- lalu bangun contract yang lebih eksplisit antar lapisan itu

---

## 6. Kesesuaian dengan best practice AI agent modern

### Sudah sesuai best practice pada area ini

1. **Bounded orchestration**
   - ada timeout dan max tool iterations
   - ini bagus; agent tidak dibiarkan looping liar

2. **Deterministic + agentic hybrid**
   - layanan publik memang lebih aman memakai hybrid orchestration
   - ini lebih baik daripada pure-agent architecture

3. **Capability-based tool use**
   - tool surface eksplisit, bukan prompt-only pseudo tools

4. **Trust-aware retrieval**
   - hasil retrieval dibedakan dari trusted records/facts
   - ini sangat baik untuk anti-hallucination

5. **Observability retrieval dan analytics**
   - retrieval mode sekarang eksplisit
   - ini kuat untuk evaluasi produksi

6. **Human handoff tersedia**
   - agent tidak dipaksa menjawab semua hal
   - penting untuk layanan warga nyata

### Belum sesuai optimal pada area ini

1. **Prompt/runtime alignment**
   - best prompt belum menjadi runtime default

2. **Clarification-first behavior**
   - first-turn tool forcing masih terlalu agresif

3. **Unified memory architecture**
   - stateful behavior ada, tapi belum rapi secara desain

4. **First-class emergency orchestration**
   - emergency sudah dideteksi sebagian, tapi belum jadi jalur orkestrasi utama yang benar-benar spesifik dan aman

5. **Village adaptability as architecture**
   - sistem sudah tenant-aware, tetapi behavior lintas desa belum sepenuhnya didefinisikan sebagai model konfigurasi/behavior policy yang kuat

6. **Conversation style governance**
   - naturalness masih terlalu bergantung pada prompt tipis + post-normalization, belum pada style policy runtime yang konsisten

---

## 7. Kesesuaian terhadap kebutuhan layanan warga di case.md

Dibanding katalog kebutuhan di [case.md](case.md), sistem saat ini **sudah mencakup core flow paling penting**, tetapi belum sepenuhnya seluas kebutuhan ideal.

### Sudah cukup cocok
- info layanan dan pengiriman link form
- complaint/pengaduan dasar
- status/history/edit/cancel
- ownership private by WA number
- handoff manusia
- anti-hallucination untuk info berbasis tool/RAG

### Baru cocok sebagian
- onboarding identitas warga yang lebih natural dan kontinu
- local dialect/slang/noisy phrasing
- multi-intent chat dalam satu pesan
- warga emosional/bingung yang butuh empati halus
- query yang sangat implicit atau sangat tidak rapi
- adaptasi lintas desa yang lebih dalam daripada sekadar data tenant

### Masih gap nyata
- emergency / urgent case sebagai route khusus yang kuat
- behavior policy untuk ambiguity yang lebih konsisten
- style yang terasa benar-benar seperti petugas manusia lokal
- orchestration untuk pertanyaan yang berada di batas antara info, layanan, pengaduan, dan kontak penting

---

## 8. Naturalness dan human-like behavior

### Kekuatan saat ini
- sistem sudah berusaha menghilangkan frasa robotik tertentu
- respons dasar untuk resident-flow nyata sudah lebih baik dibanding sebelumnya
- tidak terang-terangan mengaku sebagai AI
- sudah bisa handoff tanpa framing yang terlalu teknis

### Masalah yang masih terasa
1. **Prompt aktif terlalu generik**
   - hasilnya cenderung aman tapi kurang hidup

2. **Beberapa alur masih procedural**
   - terutama saat intent diarahkan cepat ke tool/action

3. **Variasi bahasa belum first-class**
   - local language, typo, campur ragam, dan warga yang tidak runtut masih belum jelas coverage-nya

4. **Empati dan percakapan adaptif belum cukup diarsiteki**
   - masih lebih banyak rule fungsional daripada service-conversation design

### Penilaian
Respons sekarang **sudah lebih natural daripada chatbot template**, tapi **belum sepenuhnya terasa seperti CS manusia lokal yang matang**.

Kalau targetnya adalah warga tidak merasa sedang berbicara dengan sistem otomatis, maka penguatan masih perlu di:
- prompt aktif
- clarification policy
- style policy
- response QA dataset lintas ragam warga

---

## 9. Kekuatan desain agent saat ini

1. **Hybrid orchestration sehat**
2. **Tool boundary jelas**
3. **Trust-aware output model**
4. **RAG observability kuat**
5. **Human handoff ada**
6. **Tenant/privacy awareness cukup baik**
7. **Loop bounded dan lebih aman untuk produksi**

Ini fondasi yang benar.

---

## 10. Kelemahan dan risiko desain agent saat ini

1. **Prompt aktif terlalu tipis dibanding kebutuhan produksi warga**
2. **First-turn tool forcing bisa mengurangi natural clarification**
3. **Memory/state tersebar dan rawan inkonsistensi**
4. **Sebagian logic bisnis terduplikasi antara handler/tool/state router**
5. **Emergency belum jadi jalur orkestrasi spesialis**
6. **Village adaptability belum cukup dipisah sebagai policy/config layer**
7. **Naturalness masih lebih banyak diperbaiki secara reaktif daripada diarsiteki dari awal**

---

## 11. Putusan akhir

### Apakah arsitektur agent sekarang sudah bagus?
**Ya, cukup bagus.** Fondasinya sehat, terutama untuk layanan publik yang perlu kontrol tinggi.

### Apakah sudah benar?
**Secara struktur besar: ya.** Tidak terlihat salah arah secara fundamental. Sistem sudah memilih arsitektur hybrid yang memang lebih tepat daripada fully-agentic.

### Apakah sudah pintar?
**Cukup pintar untuk core flows**, tetapi belum cukup matang untuk semua edge case warga nyata, bahasa lokal, ambiguity halus, dan percakapan emosional yang kompleks.

### Apakah sudah sesuai best practice AI agent modern?
**Sebagian besar ya pada fondasi orchestration/tooling/RAG**, tetapi **belum penuh pada prompt governance, memory unification, emergency specialization, dan human-like conversation design**.

### Status keseluruhan
**Layak dipakai dan fondasinya benar, tetapi belum final-form.**

Kalau diprioritaskan dengan benar, sistem ini punya basis yang kuat untuk naik menjadi agent layanan publik yang sangat baik tanpa perlu ganti arsitektur total.

---

## 12. Prioritas perbaikan paling penting

1. Jadikan prompt runtime lebih kaya dan ambil rule terbaik dari [system-prompt.ts](../../govconnect-ai-service/src/prompts/system-prompt.ts)
2. Ubah kebijakan first turn dari “tool dulu bila bisa” menjadi “klarifikasi dulu bila ambigu”
3. Rapikan arsitektur memory/state menjadi lapisan yang eksplisit
4. Pisahkan jalur emergency/high-priority menjadi orchestration khusus
5. Kurangi duplikasi business logic antara tool executor, handler, dan pre-agent router
6. Tambahkan governance untuk human-like style, local language, dan empathy behavior
7. Perluas QA dari sekadar happy path menjadi ragam warga nyata yang noisy dan implicit

Dokumen ini fokus pada otak agent. Gambaran sistem end-to-end dijelaskan di dokumen arsitektur lengkap, dan roadmap detail ada di dokumen saran pengembangan.
