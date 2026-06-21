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

## Test status

- `npx tsc --noEmit`: clean.
- `answer-policy.service.test.ts`: 26/26 pass (incl. Bug Z regression).
- Full `src/services/__tests__/`: 5 pre-existing failures unrelated to this work
  (DB-at-127.0.0.1:5432 connection + provider-health timing), confirmed present on
  clean main.

## Next candidate probes (future loops)

- Complaint creation flow (CREATE_COMPLAINT) end-to-end + status check (LAP-/LAY-).
- Service request submission + edit-link + cancel.
- RAG document questions (SOP/kebijakan narrative) vs structured-fact questions.
- User-memory recall across sessions (nama, riwayat).
- Cross-service handoff and emergency-contact shortcut honesty.
