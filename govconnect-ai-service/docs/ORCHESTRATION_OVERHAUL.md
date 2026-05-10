# GovConnect AI Service — Orchestration Overhaul

Ringkasan implementasi perbaikan pondasi orchestration untuk memperbaiki:
- Contact lookup yang tidak ter-ground
- Emergency routing yang terlalu agresif
- Complaint flow yang hilang continuity
- Service listing yang bercampur RAG/knowledge
- Tool policy yang lemah untuk structured fact
- FIFO channel-service yang broken

## Arsitektur hybrid

Layer (urutan prioritas eksekusi per turn):

1. **Protocol guards** — reject voice/audio/sticker/gif/video
2. **Pending offers** — service form offer dengan escape hatch (contact lookup / incident release)
3. **Late pre-agent state** — complaint FSM (pending address, confirmation), status by ref, cancel confirmation, contact directory shortcut, emergency shortcut, lapor shortcut
4. **Pending service clarification** — pick from ambiguous list
5. **Active service follow-up** — syarat/biaya/link
6. **Out-of-scope guard**
7. **Service listing shortcut** — deterministic catalog (no RAG)
8. **Deterministic knowledge fallback**
9. **Response cache**
10. **Agent orchestrator** — LLM + tool calls, with answer-policy verifier as last-mile safety net

### Source-of-truth priority

1. Transactional state (complaint draft, service session, pending clarification)
2. Structured official data (`get_important_contact`, `get_service_info`, `get_village_profile`, `get_emergency_contacts`)
3. RAG / docs / knowledge (`search_knowledge`, `search_documents`)
4. Freeform model composition

Model NEVER answers structured facts (phone numbers, service names, status) without tool grounding. The answer-policy verifier rewrites replies that slip past this rule.

## Komponen baru

| File | Fungsi |
|------|--------|
| `src/services/important-contacts.service.ts` | First-class contact directory lookup: alias, role hints, scoring, isContactDirectoryLookup guard |
| `src/services/complaint-fsm.service.ts` | Typed complaint state machine with deterministic address/identity resume |
| `src/services/answer-policy.service.ts` | Post-answer verifier for structured-fact grounding |
| `src/services/agent/tool-definitions.ts` → `get_important_contact` | New directory lookup tool, required for any phone-number query |
| `src/services/pre-agent-state-router.service.ts` → `tryHandleServiceListingShortcut` | Deterministic service catalog listing |

## Sumber utama perubahan per file

- `govconnect-channel-service/src/services/message.service.ts` — fix FIFO using Prisma ORM (was: raw SQL that ignored `schema=channel`)
- `src/services/agent/tool-definitions.ts` — add `get_important_contact` schema
- `src/services/agent/tool-executor.ts` — add `toolGetImportantContact` with confident/ambiguous suggested_response
- `src/services/agent/agent-orchestrator.ts` — add `isContactDirectoryLookupIntent` + `isActiveEmergencySituation` heuristics; first-turn `tool_choice: required` for contact queries; temperature 0.1 on critical turns; validateFinalAgentReply phone-fabrication guard
- `src/services/agent/agent-prompt.ts` — sharpen CS publik tone + grounding rules
- `src/services/pre-agent-state-router.service.ts` — contact directory shortcut before emergency; complaint FSM delegation; service listing shortcut; escape hatches on pending offers
- `src/services/unified-message-processor.service.ts` — wire service listing shortcut, answer-policy verifier; persist durable reasoning columns via `recordToolPolicyEvent` (no more encoded policy_source); adds `finalIntentSource` / `stateResumeResult` / `answer_policy_*` tags per turn
- `src/services/important-contacts.service.ts` — lookup engine with scoring, alias groups, isContactDirectoryLookup classifier

## Observability

Events durable di DB:

- `ai_tool_policy_events` — dedicated columns for every reasoning signal (added in migration `20260510_add_ai_policy_event_reason_columns`):
  - `tool_policy_reason` — `heuristic_policy_applied` / `learned_policy_applied` / `greeting_only_no_tools` / `guard_short_circuit` / `cached_response`
  - `first_turn_tool_choice` — `auto` / `required`
  - `first_turn_tool_choice_reason` — `clear_operational_or_factual_intent` / `contact_directory_lookup_requires_tool` / etc.
  - `final_intent_source` — `agent` / `guardrail` / `cache` / `fallback`
  - `state_resume_result` — `resumed` / `released` / `narrowed` / `awaiting_input` / `bypassed_by_lookup` / `bypassed_by_listing`
  - `answer_policy_kind` — `structured_fact_contact` / `structured_fact_service_listing` / etc.
  - `answer_policy_rewritten` — boolean
- `ai_guardrail_events.metadata_json` — `finalIntentSource`, `stateResumeResult`, `roleHint`, `categoryHint`, plus per-guard details
- `ai_tool_execution_traces` — per-tool latency + trust + source kind (unchanged)
- `ai_memory_traces` — unchanged

Legacy helper `encodeDurablePolicySource` is kept only as a fallback encoder for callers that cannot persist dedicated columns. Current persistence path uses the dedicated columns directly.

## Test coverage baru

| Suite | Tests |
|-------|-------|
| `important-contacts.service.test.ts` | 15 |
| `pre-agent-state-router.test.ts` | 10 |
| `complaint-fsm.service.test.ts` | 12 |
| `answer-policy.service.test.ts` | 8 |
| `scenario-eval.test.ts` | 8 (mirrors audit cases 6281233784490) |

Total: 53 new tests, all passing.

## Cases yang sekarang pasti ditangani

| Input user | Expected routing | Guardrail type |
|-----------|------------------|----------------|
| `ada nomor puskesmas solo?` | Contact directory shortcut → Pak Andi Aswin | `contact_directory_lookup` |
| `nomor kepala desa?` | Contact directory shortcut → Pak Heru | `contact_directory_lookup` |
| `ada nomor damkar?` | Contact directory shortcut → Damkar Bola (bukan emergency tone) | `contact_directory_lookup` |
| `rumah saya kebakaran tolong!` | Emergency shortcut → contacts + complaint offer | `EMERGENCY_CONTACTS` |
| `ada kecelakaan di depan sekolah` | Emergency shortcut → contacts + complaint offer | `EMERGENCY_CONTACTS` |
| `layanan apa aja?` | Service listing shortcut (catalog, no RAG) | `service_listing_shortcut` |
| `saya mau lapor kecelakaan` | Complaint shortcut → ask address | CREATE_COMPLAINT (FSM waiting_for_address) |
| `didepan sman 1 margahayu jalan radio` (after address request) | Complaint FSM resume → submit | `complaint_fsm_resume` |
| Phone number in agent reply without tool usage | Answer-policy rewrite → honest "belum ditemukan" | `contact_directory_ungrounded` |

## Prinsip yang dipegang

1. **Structured fact → tool wajib.** Tidak pernah jawab nomor dari ingatan model.
2. **Pending transactional > general agent.** Complaint resume tidak dilempar ke agent umum.
3. **Escape hatch jelas.** User bisa switch topic kapan saja tanpa terjebak loop konfirmasi.
4. **Honest "tidak ditemukan".** Kalau tool kosong, jawab jujur + minta spesifikasi.
5. **RAG pelengkap, bukan pengganti source of truth.**

## Pre-existing test failures

`ai-provider-health.test.ts` mempunyai 3 failure yang tidak terkait (timer/mock issue), sudah ada sebelum perubahan ini dan tidak menyentuh file mana pun di overhaul.
