# Audit Arsitektur Lengkap GovConnect

Tanggal: 2026-04-24

## Ringkasan eksekutif

Arsitektur GovConnect saat ini secara keseluruhan **sudah cukup matang untuk platform layanan publik desa berbasis multi-service**, khususnya karena sudah memiliki pemisahan yang jelas antara channel ingress, processor AI, case management, dashboard publik, retrieval, dan persistence.

Penilaian umum:
- **Struktur sistemnya benar** untuk skala menengah: tidak semua logika ditumpuk di satu service.
- **Boundary penting sudah ada**: tenancy, ownership, tool grounding, status handling, complaint flow, service flow, dan handoff.
- **Kelemahan utama bukan pada topologi service**, tetapi pada konsistensi behavior runtime, memory/state architecture, dan governance untuk naturalness/security/compliance.

Dengan kata lain:
- **kerangka besar sistem sudah bagus**
- yang perlu diperkuat sekarang adalah **lapisan policy, safety, consistency, dan evolvability**

---

## 1. Peta sistem end-to-end

Berdasarkan runtime dan dokumentasi yang aktif, GovConnect terdiri dari beberapa boundary utama:

1. **Channel / ingress layer**
   - menerima pesan dari WhatsApp / kanal lain
   - menyimpan message persistence dan conversation summary
   - mengelola takeover/handoff status

2. **AI service**
   - pusat orkestrasi pemrosesan pesan warga
   - memuat guard, routing, context, agent loop, retrieval, dan response shaping

3. **Case service**
   - mengelola complaint, service request, status transitions, dan data operasional kasus
   - menjadi source of truth untuk record aksi warga

4. **Dashboard / public web layer**
   - surface publik untuk form layanan
   - memungkinkan pengajuan yang lebih aman/terstruktur untuk layanan administrasi

5. **Knowledge / retrieval layer**
   - mengelola hybrid search, vector retrieval, rerank, knowledge search, dan dokumen tenant

6. **Persistence & infra**
   - PostgreSQL untuk record utama
   - pgvector untuk vectors
   - Redis untuk cache/state tertentu
   - RabbitMQ untuk alur async/event-driven tertentu

Ini adalah komposisi yang masuk akal. Sistem tidak memaksakan semua masalah ke satu service AI.

### AI Provider Layer & Smart Routing

AI service tidak lagi bergantung pada konfigurasi gateway statis sebagai sumber utama runtime. Provider, model, assignment lane, dan health state berada di database:

```text
ai_lane_assignments
  -> ai_models
      -> ai_providers(api_key_encrypted, base_url, default_headers_json)
  -> ai_provider_health(consecutive_failures, demoted_until, probe_in_flight_until)
```

Alur routing per lane:

1. Resolve primary/fallback/extra active model dalam satu snapshot transaksi.
2. Lewati provider yang masih demoted.
3. Jalankan request ke provider aktif dengan Authorization dari secret AES-256-GCM yang didekripsi saat runtime.
4. Setelah 3 failure beruntun, provider didemote 1 jam.
5. Setelah cooldown, satu instance mengklaim probe 60 detik via `FOR UPDATE SKIP LOCKED` dan `probe_in_flight_until`.

Boundary ini menjaga dashboard/billing tetap di aplikasi pengelola, sementara AI service tetap menjadi owner runtime routing, health, dan wallet desa.

---

## 2. Boundary deterministik vs agentic

Salah satu kekuatan terbesar arsitektur saat ini adalah pemisahan antara **deterministic system logic** dan **agentic reasoning**.

### Boundary deterministik
Komponen seperti [pre-agent-state-router.service.ts](../../govconnect-ai-service/src/services/pre-agent-state-router.service.ts), handler status/layanan/pengaduan, dan jalur validasi tertentu menjalankan keputusan yang seharusnya memang tidak bergantung pada LLM.

Contoh fungsi yang tepat berada di sisi deterministik:
- konfirmasi YA/TIDAK
- pending state follow-up
- status/cancel by reference
- emergency keyword intercept tertentu
- tenant/ownership enforcement
- pengiriman link layanan atau edit token yang sangat terstruktur

### Boundary agentic
Model dipakai saat ada kebutuhan yang memang lebih cocok untuk reasoning fleksibel:
- memahami intent yang lebih alami
- memilih tool yang relevan
- menyusun jawaban natural dari data/tool
- menjawab pertanyaan knowledge atau public info yang tidak sekaku route deterministic

### Penilaian
Ini sudah sesuai best practice. Untuk layanan publik, **agent harus menjadi reasoning layer, bukan policy layer utama**.

GovConnect sudah berada di arah itu.

---

## 3. Ingress, processing, dan conversational runtime

Pusat pemrosesan ada di [unified-message-processor.service.ts](../../govconnect-ai-service/src/services/unified-message-processor.service.ts).

Secara end-to-end, runtime menggabungkan:
- input validation ringan
- protocol/spam guard
- history lookup
- deterministic pre-agent handling
- context building
- agent processing
- handoff decision
- persistence/analytics

Secara arsitektur ini baik karena:
- ada satu orchestration point utama
- perilaku agent tidak sepenuhnya tersebar ke mana-mana
- pipeline masih bisa diaudit

Namun ada tradeoff:
- file/orchestrator besar cenderung menjadi titik kompleksitas yang terus membesar
- jika policy baru terus ditambahkan di sini tanpa refactor, service ini bisa menjadi “god orchestrator”

Rekomendasi strukturalnya bukan memecah serampangan, melainkan menjaga agar keputusan policy tetap modular.

---

## 4. Tooling architecture

Tool layer saat ini berpusat di [tool-executor.ts](../../govconnect-ai-service/src/services/agent/tool-executor.ts).

### Kekuatan
- tool surface eksplisit
- hasil tool terstruktur
- trust level dibedakan
- beberapa tool memberi `suggested_response`
- retrieval tidak disamakan dengan trusted records

Ini membuat agent lebih aman daripada pattern prompt-only yang membiarkan model mengarang transisi atau fakta.

### Kelemahan
- sebagian logic domain masih tampak tersebar antara handler, router, dan tool executor
- beberapa kebijakan tool eligibility masih heuristik, belum policy engine yang benar-benar eksplisit
- ketika skala layanan desa bertambah, daftar tool dan kondisi allowlisting bisa menjadi semakin sulit dirawat

### Penilaian
Arsitektur tools **sudah benar secara arah**, tetapi perlu 1 tahap refactor agar:
- business capability tetap berada di service domain
- tool layer hanya menjadi contract agent-facing yang tipis

---

## 5. Retrieval / RAG architecture

Bagian retrieval saat ini termasuk salah satu area paling matang dalam sistem.

Komponen penting ada di:
- [rag.service.ts](../../govconnect-ai-service/src/services/rag.service.ts)
- [knowledge.service.ts](../../govconnect-ai-service/src/services/knowledge.service.ts)
- [embedding.types.ts](../../govconnect-ai-service/src/types/embedding.types.ts)

### Yang sudah sangat baik
1. **Retrieval mode eksplisit**
   - `external_rerank`
   - `heuristic_rerank`
   - `raw_no_rerank`

2. **Observability retrieval**
   - debug mode dan analytics dapat membedakan mode aktual

3. **Hybrid search**
   - retrieval tidak hanya vector mentah

4. **Rerank fallback**
   - ada jalur saat external reranker tidak tersedia

5. **Tenant-aware knowledge**
   - corpus dibatasi tenant desa

6. **Trust discipline**
   - hasil retrieval tidak secara otomatis diperlakukan sebagai fakta final

### Yang masih perlu dijaga
- query expansion berbasis LLM harus tetap dibatasi biaya dan risiko semantic drift
- retrieval cache dan profile cache harus memiliki lifecycle yang lebih jelas
- knowledge conflict resolution perlu terus diaudit agar tidak diam-diam menutupi kualitas data yang buruk

### Penilaian
Untuk area RAG, GovConnect **sudah termasuk kuat**. Ini justru salah satu bagian paling siap produksi dibanding area naturalness/memory.

---

## 6. Tenancy, privacy, dan ownership boundary

Salah satu syarat terpenting untuk sistem layanan publik adalah boundary data. Di sini GovConnect sudah menunjukkan banyak langkah yang benar.

### Kekuatan yang sudah ada
- `village_id` menjadi boundary tenant penting
- service request dan complaint sudah tenant-aware
- ownership privat by `wa_user_id` / `channel_identifier`
- edit link memakai token sekali pakai / private tokenized path
- validasi `service_id` ↔ `village_id` sudah diperketat pada create flow

Ini sangat penting karena layanan warga bukan sekadar chat; ada data pribadi dan status kasus.

### Risiko yang masih perlu diawasi
- konsistensi enforcement lintas semua endpoint internal/public
- data minimization untuk PII di prompt/context
- retention policy untuk chat, memory summary, dan takeover history
- log/analytics jangan sampai menyimpan isi sensitif terlalu luas

### Penilaian
Boundary tenancy/privacy saat ini **cukup baik secara arah**, tetapi compliance-grade governance masih perlu diformalkan.

---

## 7. Complaint, service, status, dan flow operasional

Dari pengujian resident-flow terakhir, core operational flow sudah cukup sehat:
- info layanan → konfirmasi → link form
- create service request → notifikasi WA
- status/history/edit/cancel
- complaint create → status open/done
- human handoff

Ini menunjukkan arsitektur end-to-end tidak hanya indah di desain, tetapi memang berjalan.

### Kekuatan
- flow layanan administrasi tidak dipaksa selesai di chat; diarahkan ke form publik yang lebih aman
- complaint flow bisa berjalan via chat
- status dan update notifikasi sudah terhubung ke case layer
- ownership private tetap terjaga

### Gap
- onboarding identitas warga belum menjadi first-class flow
- emergency flow belum menjadi alur operasional yang benar-benar dibedakan dari pengaduan biasa
- empathy / de-escalation style masih belum sekuat flow operasionalnya

---

## 8. Memory, cache, dan statefulness sistem

Sistem ini bukan stateless chatbot. Ada beberapa lapisan state:
- pending confirmation/offer states
- conversation summary
- memory events
- takeover state
- tool response cache
- retrieval cache

### Kekuatan
- stateful behavior sudah dimanfaatkan untuk memperbaiki UX warga
- cache dipakai untuk efisiensi pada subset tool tertentu
- retrieval caching dan context memory membantu performa

### Kelemahan
- state boundary belum cukup eksplisit
- cacheability policy masih perlu terus diaudit agar tidak mengganggu stateful flows
- ada risiko architectural drift: makin banyak state khusus disimpan di lokasi berbeda

### Penilaian
Statefulness ada dan berguna, tapi perlu **unified state model** agar maintainability tetap sehat.

---

## 9. Observability dan operasionalitas

Area observability termasuk kekuatan GovConnect.

### Yang sudah baik
- analytics untuk retrieval dan knowledge
- mode retrieval tercatat eksplisit
- ada jejak untuk evaluasi kualitas
- QA harness resident flow sudah cukup kuat
- behavior bisa diverifikasi hingga database

### Yang masih kurang
- correlation ID lintas service masih perlu diperkuat
- error surfaces harus dipastikan tidak terlalu bocor ke user/log publik
- perlu dashboard operasional yang lebih langsung untuk melihat:
  - fallback frequency
  - handoff rate
  - low-confidence retrieval
  - complaint/service failure patterns
  - token/cost hotspots per tenant/flow

### Penilaian
Observability sudah bagus untuk engineering audit, namun belum sepenuhnya matang untuk operasi skala besar lintas desa.

---

## 10. Kesesuaian terhadap kebutuhan layanan warga nyata

Jika diukur terhadap katalog kebutuhan warga pada [case.md](case.md), arsitektur sistem saat ini **cukup cocok untuk core product**, tetapi belum seluruhnya untuk “real resident assistant” yang benar-benar human-like.

### Cocok untuk:
- info umum desa berbasis data/knowledge
- layanan administrasi yang diarahkan ke form
- pengaduan dasar
- status/history/edit/cancel
- privasi kepemilikan nomor layanan
- handoff manusia

### Belum sepenuhnya cocok untuk:
- ragam bahasa lokal/typo/noise yang berat
- percakapan panjang dengan identitas/riwayat yang mengalir halus
- warga emosional/frustrated yang butuh soft escalation
- kasus samar, multi-intent, dan implicit ask
- emergency/urgent routing yang sangat aman dan jelas

Ini bukan kegagalan topologi sistem, melainkan tanda bahwa **conversation policy layer** harus diperkuat.

---

## 11. Security dan compliance posture

### Sudah ada fondasi yang benar
- tenant boundary
- ownership checks
- tool grounding
- no direct freeform service creation by agent untuk kasus admin data sensitif
- edit token private
- human handoff tersedia untuk kasus yang agent tak seharusnya paksa jawab

### Masih perlu penguatan
1. **PII minimization**
   - jangan semua data warga ikut dipompa ke prompt/memory/log

2. **Prompt injection resistance**
   - retrieval untrusted sudah bagus, tapi semua consumer tool output tetap harus disiplin

3. **Retention & audit policy**
   - perlu aturan formal: chat disimpan berapa lama, memory summary apa yang boleh persisten, siapa yang boleh baca

4. **Error hygiene**
   - hindari kebocoran detail internal ke user

5. **Body limit / resource guard**
   - penting untuk AI service dan endpoint publik

6. **Cross-service traceability**
   - wajib untuk audit insiden layanan publik

### Penilaian
Secara security architecture, GovConnect **tidak sembrono**, tetapi masih perlu naik dari “engineering-safe” ke “public-service-grade governance”.

---

## 12. Latency, biaya, dan efisiensi

Topologi sekarang berpotensi sehat untuk efisiensi karena:
- tidak semua request harus masuk full agent loop
- pre-agent deterministic path bisa menghemat token
- cacheable tool subset sudah ada
- retrieval mode bisa dibedakan sesuai tujuan

Namun ada beberapa hotspot biaya:
- prompt aktif belum benar-benar dynamic minimalism
- context assembly berpotensi terlalu lebar di beberapa jalur
- heuristic + learned policy masih bisa menyebabkan tool call yang tidak perlu
- query expansion LLM dan retrieval depth perlu disiplin budget

### Penilaian
Arsitektur ini **bisa dihemat tanpa ganti fondasi**. Yang dibutuhkan adalah budget policy dan prompt assembly yang lebih adaptif.

---

## 13. Risiko arsitektural utama ke depan

1. **God-orchestrator risk** pada unified message processor
2. **State fragmentation** antara cache, pending state, memory summary, dan handoff
3. **Behavior drift** karena prompt aktif tidak sama dengan prompt terbaik proyek
4. **Tool-policy drift** saat jumlah layanan dan variasi desa tumbuh
5. **Naturalness debt**: fungsionalitas bertambah lebih cepat daripada kualitas conversation design
6. **Compliance debt** jika retention/auditability tidak segera diformalisasi

---

## 14. Putusan akhir

### Apakah arsitektur lengkap saat ini sudah bagus?
**Ya, secara sistem end-to-end sudah bagus dan rasional.** Struktur service, retrieval, persistence, dan operational flow menunjukkan desain yang serius.

### Apakah ada yang salah secara fundamental?
**Tidak terlihat salah fundamental.** Tidak ada tanda bahwa sistem harus dirombak total.

### Area terbaik saat ini
- RAG/retrieval
- tenant-aware operational flow
- hybrid deterministic + agentic orchestration
- QA/persistence validation

### Area yang paling perlu ditingkatkan
- prompt/runtime alignment
- memory/state unification
- emergency specialization
- human-like service behavior
- compliance-grade governance

### Status keseluruhan
**Arsitektur lengkapnya layak dan fondasinya kuat, tetapi maturity tertinggi baru terlihat di operational correctness dan retrieval; belum setinggi itu di conversational excellence dan governance.**

Roadmap perbaikannya dijelaskan pada dokumen saran pengembangan.
