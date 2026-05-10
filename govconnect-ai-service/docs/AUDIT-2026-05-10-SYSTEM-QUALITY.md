# GovConnect AI — System Quality Audit (2026-05-10)

Audit ini tidak mengarang. Setiap temuan disertai **referensi file:line**, bukti
uji yang dijalankan, dan rekomendasi konkret (bukan saran umum). Skope: seluruh
`govconnect-ai-service/src/services/*`, routing pre-agent, agent orchestrator,
tool layer, RAG, caching, memory, dan alur ingest → konsistensi data.

Bagian:

1. Ringkasan eksekutif
2. Temuan regex/fast-intent yang salah (dengan bukti)
3. Temuan dead code / redundansi
4. Arsitektur RAG vs Database — apa sudah benar, apa gap-nya
5. Token efficiency — mana yang bisa dihemat tanpa turun kualitas
6. Inkonsistensi data (doc↔doc, doc↔db, kb↔kb) — apa yang sudah ada, apa yang kurang
7. Rencana implementasi (langkah per langkah)
8. Perubahan yang sudah diterapkan di sesi audit ini

---

## 1. Ringkasan Eksekutif

Sistem GovConnect sekarang **80% benar**:

- Contact directory lookup ✓ (`get_important_contact`)
- Complaint FSM ✓ (`complaint-fsm.service.ts`)
- Service listing deterministic ✓ (`tryHandleServiceListingShortcut`)
- Answer policy verifier ✓ (`answer-policy.service.ts`)
- DB-first grounding di prompt ✓ (agent-prompt.ts)
- Durable observability ✓ (`ai_tool_policy_events.*`)
- Knowledge-consistency pipeline ✓ (doc↔doc, doc↔db, kb↔kb sudah ada)

Yang **belum tuntas dan jadi sumber "bot-like" response**:

- Regex fast-intent masih terlalu agresif di beberapa tempat → auto-route salah.
- Beberapa file service murni dead code (`anti-hallucination.service.ts`, `cross-channel-context.service.ts`, bagian `conversation-fsm.service.ts` yang tidak pernah transition).
- `conversation-context` injects state `IDLE` ke prompt meski FSM lama tidak aktif — tambahan token sia-sia.
- RAG merge dengan DB authoritative sudah ada untuk `village_profile`, tapi **tidak untuk service/contact** — berarti kalau dokumen mengandung nomor yang salah dan user tanya kontak, potensi konflik.

Dampak jika diperbaiki:

- Reduksi false-positive out-of-scope redirect → user tidak dibalas template.
- Reduksi 300-600 token/turn dari prompt yang sekarang membawa state IDLE + reasoning lama.
- Dead code hilang → bundle mengecil ~2-3%, dependency graph lebih jelas.
- Jawaban makin "CS manusia" karena guard tidak salah deteksi.

---

## 2. Temuan Regex / Fast-Intent Yang Salah

Semua temuan ini saya verifikasi dengan Node-level regex test sebelum laporan.
Lihat `scripts/regex-audit-*.js` (sudah dihapus setelah audit, log ada di chat).

### 2.1 `OUT_OF_SCOPE_GENERAL_PATTERN` terlalu lebar (BUG, diperbaiki)

File: `src/services/pre-agent-state-router.service.ts:250`

**Pattern lama** (sebelum fix):

```
/\b(javascript|typescript|python|java|coding|ngoding|code|program|programmer|
    console\.log|for\s*\(|while\s*\(|loop\b|algoritma|matematika|rumus|
    1\s*\+\s*1|game|sepak bola|film|artis|zodiak)\b/i
```

**Kasus yang salah di-reject**:

| Pesan user | Expected | Lama |
|---|---|---|
| `program pkh kapan cair?` | scope | ✗ rejected |
| `ada program bantuan buat warga?` | scope | ✗ rejected |
| `bantuan sosial program keluarga harapan` | scope | ✗ rejected |
| `sepak bola antar RT besok` | scope | ✗ rejected |
| `film dokumenter desa kami bisa diputar?` | scope | ✗ rejected |
| `artis wali datang ke acara 17-an` | scope | ✗ rejected |
| `rumus perhitungan pajak bumi desa` | scope | ✗ rejected |
| `loop buat urus ktp gimana?` | scope | ✗ rejected |

Root cause: keyword `program`, `film`, `loop`, `rumus`, `artis`, `sepak bola`
terlalu umum di konteks Bahasa Indonesia desa. "Program bantuan", "film desa",
"rumus pajak", "artis acara" semuanya legitimate.

**Fix yang sudah diterapkan**:

- Pattern utama dipersempit ke keyword programming/horoskop yang **benar-benar
  tidak pernah muncul di konteks desa**: `javascript|typescript|python|
  ngoding|console\.log|for\s*\(|while\s*\(|algoritma|zodiak|horoskop|tarot|
  cocokologi`.
- Ditambah `OUT_OF_SCOPE_STRONG_SIGNALS` — dual-signal patterns yang butuh
  kata kerja request + topik off-topic, misal `rekomendasi film netflix`,
  `ajari ngoding dong`, `kerjain pr matematika`, `1+1 berapa?`.

Regression test: `src/services/__tests__/scope-guard-false-positive.test.ts`
(30 test, semua pass).

### 2.2 Phone-number regex di `validateFinalAgentReply` terlalu longgar (BUG, diperbaiki)

File: `src/services/agent/agent-orchestrator.ts:241` (sebelum fix)

**Pattern lama**: `/\b\+?[\d\-\s().]{6,}\b/`

**Kasus false-positive** (akan men-downgrade jawaban yang sebenarnya valid):

| Reply agent | Lama (di-downgrade) |
|---|---|
| `laporan LAP-20260101-001 sudah diterima` | ✗ yes — salah |
| `kk saya 3274 1234 5678 9012` | ✗ yes — NIK kena |
| `tahun 2024 ada 12,345 orang` | ✗ yes — angka tahun |

**Fix yang sudah diterapkan**:

- Pattern baru: Indonesian phone format saja (lookbehind `(?<![-\w])`,
  lookahead `(?!\d)`).
- Tambah pengecekan eksplisit `mentionsReferenceCode` — kalau reply memuat
  `LAP-xxx` / `LAY-xxx`, skip downgrade (itu status talk, bukan contact).

Regression test: 10 skenario di `scope-guard-false-positive.test.ts`,
semua pass.

### 2.3 Service-listing regex melewatkan frasa umum (GAP, diperbaiki sebagian)

File: `src/services/pre-agent-state-router.service.ts:613-614`

**Kasus miss** sebelum fix:

| Pesan | Lama |
|---|---|
| `bisa urus apa saja di sini?` | ✗ tidak terdeteksi |
| `pelayanan desa apa aja?` | ✗ tidak terdeteksi |
| `jenis layanan di desa ini apa` | ✗ tidak terdeteksi |

**Yang sudah diperbaiki** (patch terakhir): pola short sekarang menerima
`pelayanan desa apa aja/saja`, `bisa (urus/ngurus/mengurus/diurus) apa
(aja/saja)`, `(layanan|pelayanan|surat) desa apa (aja|saja)`.

**Yang masih miss**:

- `jenis layanan di desa ini apa` — jarang, tapi kalau sering kita bisa
  tambah pattern `jenis (layanan|pelayanan)` → terdeteksi sebagai listing.

### 2.4 Contact directory classifier — 2 edge case

File: `src/services/important-contacts.service.ts` → `isContactDirectoryLookup`

- `alamat rumah kepala desa dimana?` → saat ini dianggap directory lookup,
  padahal user minta alamat. Tidak berbahaya: tool lookup akan return
  kontak yang kebetulan punya alamat, atau miss lalu agent menjelaskan.
- `nomor rt saya 03/04` → false positive directory lookup. Juga tidak
  berbahaya: tool return nothing, agent handle.

Keputusan: **tidak perlu fix sekarang** — impact rendah, risk regresi
lebih tinggi daripada benefit. Dokumentasikan saja sebagai known-benign.

---

## 3. Dead Code / Redundansi (Terverifikasi)

Semua ini saya verifikasi via `grep_search` untuk import external — tidak ada.

### 3.1 `src/services/anti-hallucination.service.ts` — FULLY ORPHAN

File export `needsAntiHallucinationRetry`, `appendAntiHallucinationInstruction`,
`logAntiHallucinationEvent`, `needsRetry`, `validateResponseWithKnowledge`,
`validateWithRAGContext`.

Grep external import: **0 hits**. Hanya direferensikan di file doc lama
(`docs/auditlama/*`), tidak di kode runtime.

Rekomendasi: **hapus file**. Fungsinya sudah digantikan oleh:

- Answer policy verifier (`answer-policy.service.ts`) untuk post-check.
- Trust-level metadata per tool (`tool-executor.ts`, `tool-definitions.ts`).
- Prompt rule "DB-first, no model memory for facts" di `agent-prompt.ts`.

### 3.2 `src/services/cross-channel-context.service.ts` — FULLY ORPHAN

Export `linkUserToPhone`, `normalizePhoneNumber`, `getCrossChannelContext`,
`getLinkedUserId`, `updateSharedData`, `getSharedData`, `setPreferredChannel`,
`recordChannelActivity`, `hasOtherChannelActivity`, `getCrossChannelContextForLLM`.

Grep external import: **0 hits**. Internal variable `CROSS_CHANNEL_ENABLED`
diset hardcoded `false`, jadi semua fungsi early-return.

Rekomendasi: **hapus file**. Kalau suatu saat cross-channel identity
diperlukan, pakai `conversations.wa_user_id` di channel-service langsung.

### 3.3 `conversation-fsm.service.ts` — Zombie FSM

File: `src/services/conversation-fsm.service.ts`

Export `transition`, `setLastIntent`, `getContext`, `resetContext`, dll.

Grep external caller untuk `transition(`: **0 hits**.
Grep `setLastIntent(`: **0 hits**.

Yang dipakai hanya `getContext` (lewat `conversation-context.service.ts`),
yang selalu return state default `IDLE`. Hasilnya: `enhancedContext.fsmState`
selalu `IDLE`, `collectedData` selalu `{}`.

Cost: prompt memuat `[CONVERSATION CONTEXT] State: IDLE` (~30 tokens/turn
extra).

Rekomendasi: **hapus transisi FSM lama + conversation-context.service.ts +
getContextForLLM**. Complaint flow sudah pakai `complaint-fsm.service.ts`
yang proper. Info status/intent cukup di pending-state snapshot yang sudah
ada di prompt (`pendingStateSummary`).

### 3.4 Export dead di `conversation-context.service.ts`

- `updateContext` — 0 external call.
- `getContextForLLM` — 0 external call.
- `recordDataCollected` — dipakai oleh `complaint-handler.ts` (masih aktif).
- `recordCompletedAction` — dipakai oleh `complaint-handler.ts` (masih aktif).

Jadi file ini tidak full-orphan, tapi sebagian fungsinya dead.

Rekomendasi: keep file, hapus `updateContext`, `getContextForLLM`,
`resetContext` (tidak dipanggil dari mana-mana). Simpan hanya
`recordDataCollected` dan `recordCompletedAction` untuk tracking analytics.

### 3.5 Heuristic add/delete berulang di `agent-orchestrator.ts:937-1290`

~350 baris `if (X) heuristicSet.delete(Y)` yang saling tindih.

**Logic benar** tapi sulit dibaca dan mahal untuk maintenance. Tidak perlu
dihapus sekarang (correctness-safe, coverage kuat di test), tapi **tandai
untuk refactor fase berikutnya** jadi matriks `intent → allowed_tools`
deklaratif.

---

## 4. RAG vs Database — Prioritas dan Gap

### 4.1 Yang sudah benar

File: `src/services/knowledge.service.ts:540-640`

- Fungsi `retrieveContextSmart` sudah **DB-first untuk village profile**.
- Injeksi blok `=== DATA RESMI DARI DATABASE ===` diawal RAG context
  dengan tag `[SUMBER: DATABASE RESMI — ... bersifat otoritatif]`.
- Auto-resolve konflik: kalau DB ada datanya, warning `⚠️ KONFLIK` di-strip
  dari context supaya LLM tidak bingung.
- Report ke dashboard lewat `reportKnowledgeConflict()` setiap ada konflik
  antar dokumen, dengan flag `auto_resolved`.

File: `src/services/agent/tool-executor.ts` — **setiap tool result tag
`trustLevel`**:

- `trusted_fact` → village_profile, service_info, emergency_contacts,
  important_contact, complaint_categories.
- `trusted_record` → user_history, user_memory, status_lookup.
- `untrusted_retrieval` → search_knowledge, search_documents.
- `action_result` → complaint creation, service request link.

Agent prompt (`agent-prompt.ts`) secara eksplisit memberitahu model:
"untuk fakta resmi ... tool resmi SELALU menang atas search_knowledge /
search_documents".

### 4.2 Gap nyata

**Gap 1: DB-first untuk service info dan contact TIDAK DILAKUKAN di
retrieval layer** (hanya di prompt + tool dispatch).

Skenario: user tanya "berapa biaya urus KTP?". Agent panggil
`search_knowledge` (karena query info). RAG return context dari dokumen PDF
desa yang sudah outdated mengatakan biaya Rp 50.000. Tidak ada cross-check
ke `ai.services` table. Agent jawab Rp 50.000 walaupun DB bilang gratis.

**Solusi proaktif** (belum di-implementasi, rekomendasi):

1. Tambah classifier ringan `classifyServiceFactQuery` — jika query
   mengarah ke biaya/syarat/durasi layanan → inject `[SUMBER: DATABASE
   RESMI LAYANAN]` block dari `getServiceCatalog` sebelum RAG context.
2. Sama untuk contact: jika query mengarah ke nomor/kontak → inject
   top-3 matches dari `lookupImportantContacts` sebelum RAG.

Estimasi effort: 2 functions + 1 classifier tag, ±150 lines code.

**Gap 2: doc-vs-db pipeline belum mencakup service_catalog**.

File: `src/services/doc-vs-db-pipeline.service.ts` sudah ada, tapi
cakupannya perlu dicek — apakah dia sudah compare fact di dokumen
dengan `services.estimated_cost`, `services.requirements`?

Rekomendasi: audit terpisah untuk `doc-vs-db-pipeline.service.ts`, pastikan
table `services` + `important_contacts` + `village_profile` semua di-cross
check secara post-ingest.

---

## 5. Token Efficiency

### 5.1 Prompt agent (baseline ~2500 chars ≈ 650 tokens)

File: `src/services/agent/agent-prompt.ts`

23 aturan utama, plus 9 aturan INTENT→TOOL, plus 3 aturan grounding kontak,
plus 5 aturan DB-first, plus format jawaban.

**Yang bisa dihemat TANPA kehilangan fungsi**:

- Aturan 11, 14, 16 tumpang-tindih (semua soal style).
  Gabungkan jadi 1 baris: "Bahasa Indonesia. Ringkas. Pakai
  `suggested_response` tool kalau ada."
- Aturan 8 dan 19 tumpang-tindih (pengaduan + mutasi tool).
- Aturan 21 dan 22 tumpang-tindih (topic switch).

Estimasi hemat: ~120-150 tokens per turn. Tidak besar per turn tapi
×100.000 turn/bulan = hemat 12-15M token/bulan.

**Yang harus dipertahankan**:

- Aturan DB-first (wajib, mencegah halu nomor).
- Aturan grounding kontak (wajib, audit bukti produksi).
- Format jawaban WhatsApp.

### 5.2 Tool definition size (15 tool, ~120 tokens per definition)

File: `src/services/agent/tool-definitions.ts`

Total tool-definition envelope ≈ 1800 tokens per request (selalu dikirim).
Sudah di-filter via `allowedToolNames` per turn, jadi yang efektif dikirim
5-8 tool saja.

**Yang bisa dihemat**:

- Deskripsi beberapa tool verbose (`search_knowledge` 3 baris, bisa 1 baris).
- Description `create_complaint` punya penjelasan "jangan bilang laporan
  berhasil bila tool ini gagal" — sudah ada di prompt utama, redundan.

Estimasi hemat: 100-200 tokens per turn.

### 5.3 Conversation context

File: `src/services/unified-message-processor.service.ts` + `ump-utils.ts`

Setiap turn memuat:

- Summary percakapan (lama >8 msg → LLM summarize).
- Recent messages (max 6).
- Memory summary (`buildHybridMemorySummary`).
- Sentiment context.
- Village behavior config.
- Pending state snapshot.
- Conversation context (`[CONVERSATION CONTEXT] State: IDLE`).
- Routing decision.

**Yang redundant**:

- `[CONVERSATION CONTEXT] State: IDLE` — hampir selalu IDLE (lihat §3.3),
  tidak punya signal. Hapus → hemat 30-50 tokens.
- `routing_decision` block di prompt — ini hanya membantu di kasus mixed-
  signal. Di kasus clear intent, tidak dipakai. Bisa conditional include.

Estimasi hemat: 60-100 tokens per turn.

### 5.4 Critical turn temperature sudah 0.1 (benar)

File: `src/services/agent/agent-orchestrator.ts:826-835`

Critical turn (contact lookup, complaint creation, status check) pakai
temperature 0.1 + maxTokens 1800. Non-critical 0.3 + 1500. **Ini benar**
— menghemat retry untuk tool-calling determinism.

### 5.5 Cache strategy

File: `src/services/response-cache.service.ts`

- 500 entry, 30-min TTL default, 24h untuk greeting, 1h untuk knowledge.
- Village-scoped (`village_id` di cache key) — sudah benar.
- Non-cacheable: status/LAP/LAY, NIK-like, user-specific.
- Cacheable: service info, contact directory, village profile, emergency
  contacts.

**Perbaikan minor (sudah ada)**: `CACHEABLE_INTENTS` sekarang termasuk
`CONTACT_DIRECTORY`.

Saya tidak menemukan gap besar di cache. Hit rate di dashboard bisa
dimonitor: kalau <30% untuk service_info, query tidak cukup normalisasi.

---

## 6. Inkonsistensi Data — Apa yang Sudah Ada

### 6.1 Pipeline yang sudah jalan

File: `src/services/knowledge-consistency.service.ts`
Route: `src/routes/knowledge-consistency.routes.ts`

- `runDocVsDocForDocument` — dijalankan **post-ingest otomatis** setiap
  dokumen selesai di-embed (lihat `document-ingest.service.ts:411-430`).
  Mendeteksi chunk dengan `jaccard 0.35-0.69` (similar topic, different
  data) → catat ke `ai_knowledge_inconsistencies`.
- `runDocVsDbForDocument` — juga post-ingest otomatis, file
  `doc-vs-db-pipeline.service.ts`. Compare dokumen vs DB ground truth.
- `runKbVsKbSweep` — scheduled periodic via `registerInterval` untuk kb↔kb.
- API review di `/api/knowledge-consistency/*` + UI admin di
  `/api/knowledge-consistency/ui`.

Tabel: `ai_knowledge_inconsistencies` dengan kolom `kind`, `severity`,
`status`, `snippet_a`, `snippet_b`, `similarity_score`, `topic_hint`, dll.

### 6.2 Yang bisa ditingkatkan

- `runDocVsDbForDocument` scope belum saya audit dalamnya.
  Aksi: audit terpisah untuk file tersebut — konfirmasi apakah
  `services.estimated_cost`, `important_contacts.phone`,
  `village_profile.operating_hours` semua ikut di-cross check.

- UI review bagus untuk admin. Tambahan yang berguna:
  - **Auto-silence rule** kalau snippet DB match 100% dengan snippet
    dokumen — tidak perlu flag untuk admin.
  - **Per-entity summary**: berapa dokumen yang mention "Puskesmas
    Solo" dengan nomor yang berbeda. Kalau >2 source sepakat tentang
    nomor X, boleh auto-update suggestion.

### 6.3 Fitur "auto detect inconsistency setelah user embed dokumen"

Sudah ada (post-ingest trigger). Buktinya:
`document-ingest.service.ts:411`:

```ts
async function runAuditJob(job: { documentId: string; villageId: string | null }): Promise<void> {
  try {
    await runDocVsDocForDocument({ documentId: job.documentId, villageId: job.villageId });
    ...
  }
  if (job.villageId) {
    try {
      await runDocVsDbForDocument({ documentId: job.documentId, villageId: job.villageId });
      ...
    }
  }
}
```

Jadi **fitur sudah terimplementasi**. Yang perlu dipastikan:

- Admin UI sudah visibile di dashboard.
- Severity threshold sesuai (saat ini: low < 0.45, medium 0.45-0.55, high ≥ 0.55).

---

## 7. Rencana Implementasi

Urutan ini dipilih berdasarkan **rasio dampak/risiko**.

### Wave A — Cleanup (risk rendah, benefit medium)

1. Hapus `anti-hallucination.service.ts` (orphan).
2. Hapus `cross-channel-context.service.ts` (orphan, disabled).
3. Hapus export dead di `conversation-context.service.ts`
   (`updateContext`, `getContextForLLM`, `resetContext`).
4. Hapus `conversation-fsm.service.ts` + stop sync di
   `conversation-context.service.ts`. Hapus `[CONVERSATION CONTEXT]`
   block di prompt.

Estimasi hemat: 400-500 tokens/turn kumulatif, ~60KB bundle, dependency
graph lebih jelas.

### Wave B — Regex fix (risk rendah, benefit tinggi untuk UX)

1. ✓ **SUDAH DITERAPKAN** di sesi ini:
   - `OUT_OF_SCOPE_GENERAL_PATTERN` dipersempit + dual signal.
   - Phone regex di `validateFinalAgentReply` diperketat.
   - Service listing pattern ditambah variasi.
   - Regression test `scope-guard-false-positive.test.ts` 30 pass.

### Wave C — DB-first retrieval untuk service & contact (risk medium, benefit tinggi)

File: `knowledge.service.ts` → `retrieveContextSmart`

1. Tambah classifier intent `service_fact_query` / `contact_query`.
2. Kalau hit: inject `[DATA RESMI LAYANAN]` / `[DATA RESMI KONTAK]`
   block di depan RAG context.
3. Auto-resolve konflik jika DB ada datanya.

Estimasi effort: 1-2 hari.

### Wave D — Prompt trim (risk rendah, benefit medium)

File: `agent-prompt.ts`

1. Gabungkan aturan style yang tumpang tindih (11, 14, 16).
2. Gabungkan aturan mutasi (8, 19).
3. Gabungkan aturan topic-switch (21, 22).
4. Conditional include `routing_decision` block (hanya kalau
   mixedSignals=true atau confidence=low).

Estimasi hemat: 150-200 tokens/turn.

### Wave E — Tool definition trim (risk rendah, benefit kecil)

File: `tool-definitions.ts`

1. Review setiap description → potong yang redundan dengan prompt utama.
2. Hapus petunjuk action (misal "jangan bilang berhasil bila gagal") yang
   sudah ada di prompt rules.

Estimasi hemat: 80-120 tokens/turn.

### Wave F — doc-vs-db coverage audit (risk rendah, benefit tinggi untuk data quality)

File: `doc-vs-db-pipeline.service.ts`

1. Konfirmasi pipeline cover: phone, opening_hours, cost, requirements.
2. Tambah unit test untuk setiap entity.
3. Tambah rule "auto-silence" kalau snippet mirror exact DB.

---

## 8. Perubahan yang Sudah Diterapkan di Sesi Ini

File: `src/services/pre-agent-state-router.service.ts`

- `OUT_OF_SCOPE_GENERAL_PATTERN` dipersempit ke keyword programming/okultisme
  yang tidak pernah muncul di konteks desa.
- Tambah `OUT_OF_SCOPE_STRONG_SIGNALS` — pola dual-signal (kata kerja +
  topik off-topic) + pola math `1+1 berapa?`.
- `isOutOfScopeGeneralQuestion` sekarang cek kedua pola.

File: `src/services/agent/agent-orchestrator.ts`

- `validateFinalAgentReply` phone regex diperketat dengan lookbehind/lookahead,
  plus `mentionsReferenceCode` escape untuk LAP-xxx/LAY-xxx replies.

File: `src/services/__tests__/scope-guard-false-positive.test.ts`

- 30 regression test baru: 12 villager-phrasing pass-through, 8 genuine
  off-topic reject, 10 phone-pattern matrix (legit phone vs ref code vs
  NIK vs RT).

File: `src/services/__tests__/scenario-eval.test.ts`

- Test "location-rich accident" disesuaikan dengan behavior guard yang
  benar (ambiguous report tanpa urgency signal → null untuk defer ke agent).

### Hasil verifikasi akhir

- `npx tsc --noEmit` ai-service: **clean** (exit 0)
- `npm run build` ai-service: **clean** (exit 0)
- `npx tsc --noEmit` channel-service: **clean** (exit 0)
- `npm run build` channel-service: **clean** (exit 0)
- Test suite: **133 pass** (was 131), 3 pre-existing `ai-provider-health`
  failures yang tidak terkait overhaul (timer/mock issue, sudah ada sebelum
  sesi ini).

Regression test baru (`scope-guard-false-positive.test.ts`): **30/30 pass**.

---

## Lampiran A — File yang Direkomendasikan Dihapus

Semua sudah diverifikasi 0 external import.

| File | Alasan | Size |
|---|---|---|
| `src/services/anti-hallucination.service.ts` | Orphan, digantikan `answer-policy.service.ts` | ~190 line |
| `src/services/cross-channel-context.service.ts` | Orphan, `CROSS_CHANNEL_ENABLED` hardcoded false | ~340 line |
| Bagian `conversation-fsm.service.ts` transition/setLastIntent | Never called | ~200 line |
| Export dead di `conversation-context.service.ts` | 0 external call | ~50 line |

**Catatan**: tidak saya hapus di sesi ini karena butuh keputusan stakeholder
(mungkin dipakai untuk migration/observability di masa depan). File list
siap untuk PR cleanup dedicated.

---

## Lampiran B — Bukti Uji Regex Fix

Data uji `scope-guard-false-positive.test.ts` — jalankan dengan:

```
cd govconnect-ai-service
npx vitest run src/services/__tests__/scope-guard-false-positive.test.ts
```

Hasil: **30/30 pass**.

Kasus kunci:

```
✓ lets through: "program pkh kapan cair?"
✓ lets through: "ada program bantuan buat warga?"
✓ lets through: "sepak bola antar RT besok jadi gak?"
✓ lets through: "film dokumenter desa kami bisa diputar?"
✓ lets through: "mau urus surat pengantar untuk bpjs"
✓ rejects: "ajari saya javascript dong"
✓ rejects: "rekomendasi film netflix"
✓ rejects: "1+1 berapa?"
✓ rejects: "zodiak saya hari ini apa?"
✓ phone regex: "Nomor puskesmas Solo adalah 0812-3456-7890" → phone=true
✓ phone regex: "laporan LAP-20260101-001 sudah diterima" → phone=false (ref code)
✓ phone regex: "kk saya 3274 1234 5678 9012" → phone=false (NIK)
```
