# AI CS Quality Loop — Desa Sanreseng Ade (2026-06-21)

Production AI-quality testing loop against the live `govconnect-ai-service`
(`http://localhost:3002/api/webchat`) for tenant **Desa Sanreseng Ade**
(`village_id=cml65fa1m0000mj01ee31edeh`). Goal: behave like a real human public-
service CS — LLM + memory + hybrid RAG + tool calling + agentic multi-task — with
correct, grounded, natural answers and no fabricated facts.

Harness: `scripts/ai-cs-test-full.sh` (real webchat, persistent `web_*` sessions
so multi-turn memory + active-service state are exercised). Section A single-turn,
B multi-turn memory, C tone, D facet follow-ups, E single-turn facets.

> Note: webchat `session_id` MUST start with `web_` or the route returns
> `Format session_id tidak valid` (webchat.routes.ts:225). Test prefixes that
> don't start with `web_` silently produce null responses.

## Fixes shipped this loop (all deployed + verified live)

| Commit | Bug | Root cause | Fix |
| --- | --- | --- | --- |
| 6a2246c | Follow-up lost service context | Cache-served answer skipped `get_service_info`, so `setActiveServiceInfo` never persisted; next turn fell to blind knowledge search | Fast-intent router also derives active-service from recent history |
| 3651b32 | `SKU` returned fabricated 4-item requirements (Nama Lengkap/Foto Usaha/Foto KTP/Keterangan) | Hardcoded village-specific SERVICE_INFO answers in `getResidentKnowledgeFallback` short-circuited the DB tool path | Removed the 4 hardcoded service-data fallbacks; queries flow to DB-backed `get_service_info` |
| 8e35ed4 | Facet questions (time/cost/channel) fell through | `buildServiceInfoContext` didn't surface estimate/cost/channel | Append "Estimasi proses", "Biaya", channel line to the grounded reply |
| d3b11fb | Bug X: "jam buka?" mid-service-context deflected ("saya cek dulu") | Answer-policy `buildVillageProfileFallback` deflected when agent answered from context without `get_village_profile` | Fallback self-heals: fetches real profile from DB and answers; `verifyAnswer` async + receives `villageId` |
| d3b11fb | Bug Y: "berapa lama?" had no time | `estimated_processing_time`/`estimated_cost` columns empty on real data; estimate baked in `description` prose | Parse "Estimasi:" from `description` when structured field empty |
| f45d733 | Bug Z: hallucinated office region ("Kec. Galut, Kab. Takalar" vs real "Kecamatan Bola, Kabupaten Wajo") | Bare "alamatnya di mana?" didn't match village-profile query patterns, so ungrounded answer wasn't rewritten | Broaden query pattern (bare/pronoun address) + fact-claim detector (kecamatan/kabupaten/provinsi) |

## Verified-good behaviors (final battery)

- Greeting (salam), out-of-scope math, full service list, contacts: all correct/natural.
- SKTM / SKU requirements: deterministic and DB-accurate (2 items SKU, 3 items SKTM).
- Multi-turn: follow-up "syaratnya apa aja?" stays in service context.
- Office hours + address: grounded, consistent across turns (Kecamatan Bola, Kabupaten Wajo).
- Tone: angry / confused / thanks all handled with empathy, no robotic deflection.
- Estimasi proses surfaces in every service reply.
- No fabricated phone numbers, prices, or addresses observed in final sweep.

## Authoritative data (for reference)

- Service definitions: `cases.services_dynamic` (one row per service; SKU slug `keterangan-usaha`).
- Service requirements: `cases.service_requirements` (SKU = Foto KTP + Foto Tempat Usaha).
- Village profile: `dashboard.village_profiles` (address "Kantor Desa Sanreseng Ade, Sanreseng Ade, Kecamatan Bola, Kabupaten Wajo, Sulawesi Selatan"; operating_hours JSON Sen-Jum 08:00-15:00).

## Remaining gaps (not code bugs)

1. **Cost facet has no data.** `estimated_cost` is empty for every service and no
   "Biaya:" prose exists, so "berapa biaya?" repeats the grounded block without a
   price. The AI correctly does NOT fabricate a price. Fix is **data entry**
   (populate `estimated_cost` or add cost to the description), not code.
2. **Bug Z was non-deterministic.** The fabricated region appeared once and could
   not be reproduced in 3+ retries. The guard hardening + unit test
   (`answer-policy.service.test.ts` "rewrites a hallucinated administrative-region
   address") are the guarantee, since live reproduction isn't reliable.

## Round 2 — complaint / pengaduan flow (2026-06-21 PM)

Probed the complaint creation + status flow. Found and fixed the most severe bug
of the whole loop.

| Commit | Bug | Root cause | Fix |
| --- | --- | --- | --- |
| 59afd16 | **Bug W (CRITICAL): phantom complaint.** Agent told the resident "laporan masuk, kami teruskan ke petugas" while NOTHING persisted (zero complaints ever existed for this village). | The confirmation turn called `search_knowledge`, never `create_complaint`, and emitted a polished success message with intent AGENT — and answer-policy had no guard for transactional claims. | Phantom-transaction guard: a "recorded/filed/forwarded" claim with no create/update tool run is rewritten to an honest "belum sempat kami catat" reply. Fires regardless of intent; dedicated action_result-aware grounding check. |
| 1dc613c | Complaint flow stalled on "lampu jalan mati". | Incident keyword was bare `lampu mati`; "lampu jalan mati" / "PJU mati" didn't match, even though the village's own type is named "Lampu Jalan Mati". | Widen `COMPLAINT_INCIDENT_KEYWORDS` to allow words between lampu…mati and match "lampu jalan" / "penerangan jalan" / "pju mati". |
| 6373d65 | Guard regression: genuine history reply rewritten. | `get_my_history` / `user_history` not in the transactional grounding set, so "riwayat laporan saya" describing an existing LAP matched the success pattern and was wrongly rewritten. | Add get_my_history / user_history to the transactional grounding set. |

**End-to-end verified (after all three fixes deployed):**
- Full flow completes: report → name → phone → **LAP-20260621-001** issued, status OPEN.
- Row persists in `cases.complaints`; `reporter_phone` is **encrypted at rest** (enc:...) — PII protection working.
- Status check from the owning session returns "menunggu diproses".
- Status check from a *different* session is correctly refused ("tidak terdaftar atas nomor Anda") — ownership-scoping is a security feature, not a bug.

**Round-2 minor gaps (not fixed, low risk):**
1. `deskripsi` stored with the "mau lapor" prefix ("mau lapor lampu jalan mati di RT 03..."). Cosmetic; extraction-cleanup deferred to avoid destabilizing the FSM.
2. Combined "nama saya X, HP 0812..." in one message: only the name is extracted, phone re-asked. Flow still completes over an extra turn.

## Round 3 — service-request, cancel, and RAG (2026-06-21 PM/late)

Probed the service-request submission flow, complaint cancellation, and RAG
narrative retrieval.

**Service request (SKU → form link):** works. "lanjut" issues a valid form link
(`https://govconnect.my.id/form/desa-sanreseng-ade/keterangan-usaha?session=...`,
HTTP 200), intent CREATE_SERVICE_REQUEST. Minor: a follow-up "kirim link" re-offers
instead of re-sending — cosmetic.

| Commit | Bug | Root cause | Fix |
| --- | --- | --- | --- |
| 35722e1 | Cancel confirmation "iya benar batalkan" read as NO ("tidak jadi dibatalkan"); cancel never happened. | The yes-pattern required "iya" directly before "batalkan"; "benar" in between → uncertain → fell to the service-form LLM classifier where "batal" = REJECT. | In the cancel branch, treat an affirmative containing batal/batalkan/cancel (or a bare yes) as YES unless there's an explicit negation (jangan / tidak jadi / urung). |
| d34eea1 | Phantom-transaction guard false-positive: a cancel-confirmation prompt citing "LAP-..." was rewritten into "belum sempat kami catat". | The guard treated any LAP-/LAY-<digits> mention as a creation-success claim. | Require an issuance/success context (dengan nomor / berhasil dibuat / telah kami terima) around the reference number. Genuine creations are tool-grounded anyway. |

**End-to-end verified (after fixes deployed):** report → name → phone → cancel →
confirm. LAP-20260621-002 (Citra) and LAP-20260621-003 (Dewi) both CANCELED in
`cases.complaints`; LAP-20260621-001 (Andi) still OPEN. Cancel reason recorded.

**RAG narrative — NOT a code bug, a DATA/OPS gap (flag for ops):**
"apa saja yang perlu disiapkan saat melapor" returns "belum menemukan informasi".
Root cause: the village has a knowledge PDF ("Knowledge Based GovConnect (1).pdf",
`status=completed` in `dashboard.knowledge_documents`) but **zero** rows in both
`ai.document_vectors` and `ai.knowledge_vectors` — nothing was ever embedded.
So narrative/SOP retrieval has nothing to search and the AI honestly refuses
(correct — it does not fabricate). "Profil Desa" answers work because they use the
structured DB path, not RAG. **Action for ops:** the embedding pipeline marked the
PDF "completed" without producing vectors — re-run embedding for this village and
investigate why completion was reported without vectors.

## Test status

- `npx tsc --noEmit`: clean.
- `answer-policy.service.test.ts`: 31/31 pass (phantom-transaction guard, history
  grounding, cancel-prompt false-positive, Bug Z, and prior cases).
- `pre-agent-state-router.test.ts`: 16/17 (1 pre-existing emergency-role failure,
  unrelated, present on clean main).
- Full `src/services/__tests__/`: remaining failures are pre-existing and
  env-dependent (DB-at-127.0.0.1:5432 connection + provider-health timing +
  emergency-role ambiguity), confirmed on clean main.

## Next candidate probes (future loops)

- User-memory recall across sessions (nama, riwayat) — pending.
- Cross-service handoff and emergency-contact shortcut honesty.
- Photo/media attachment to a complaint.
- Combined name+phone extraction in one message (round-2 minor gap).

## RAG embedding — definitive root cause (Round 3 deep-dive)

Investigated end-to-end. The narrative RAG gap is **data/ops, not code**:

- Only the original demo village (`cml2i4ug8...`) has vectors (222 document + 2
  knowledge). **Both** newer villages have documents marked `completed` with zero
  vectors — a repeating pattern.
- For Sanreseng's PDF (`7967bab0-...`, "Knowledge Based GovConnect (1).pdf"):
  triggering the designed re-embed endpoint
  (`POST /api/upload/document/:id/process`) fails with
  *"Failed to download document file for processing"*.
- Root cause: `file_url` is `http://ai-service:3002/uploads/documents/doc-...pdf`
  — local container storage. The `gc-ai-uploads` volume is mounted and persistent,
  but `/app/uploads/documents/` is **empty**: the source file is gone. Embedding
  produced no vectors originally because the file wasn't retrievable, yet the
  document was still marked `completed`.
- Re-embedding the structured `knowledge_base` item (Profil Desa) via
  `POST /api/knowledge/embed-all?village_id=...` succeeded (1 vector, valid
  embedding). Profil Desa answers are served via the structured path regardless.

**Actions for ops (cannot be fixed in code without re-upload):**
1. Re-upload the knowledge PDF for Sanreseng (and the other new village) so vectors
   regenerate. The current source file is missing from the uploads volume.
2. Investigate why the ingest pipeline marks a document `completed` when the file
   is unretrievable / no vectors were produced — it should mark `failed`.
3. **Architecture risk:** knowledge documents are stored on the ai-service
   container's local filesystem (`http://ai-service:3002/uploads/...`), not object
   storage (R2/S3). A volume recreate orphans the files while the DB still says
   "completed". Consider moving document storage to object storage. (Not changed
   autonomously — storage-layer change, needs sign-off.)

## Open items for ops (data, not code)

1. **RAG embedding broken for new villages** — documents "completed" but source
   files missing from the uploads volume; no vectors. Re-upload needed. (Round 3)
2. **`estimated_cost` empty for all services** — "berapa biaya?" can't surface a
   price. (Round 1)

