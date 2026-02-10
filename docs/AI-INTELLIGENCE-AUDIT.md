# GovConnect AI Service — Intelligence Audit Report

> **Date**: June 2025  
> **Scope**: Comprehensive research audit of the AI Orchestrator service  
> **Objective**: Identify gaps and improvement opportunities across 8 focus areas  
> **Status**: Research only — no code changes made

---

## Table of Contents

1. [RAG Pipeline Effectiveness](#1-rag-pipeline-effectiveness)
2. [Unanswered Question Tracking](#2-unanswered-question-tracking)
3. [Intent Handling Completeness](#3-intent-handling-completeness)
4. [Conversation Context Quality](#4-conversation-context-quality)
5. [Entity Extraction Quality](#5-entity-extraction-quality)
6. [Error Recovery & Resilience](#6-error-recovery--resilience)
7. [Knowledge Base Structure](#7-knowledge-base-structure)
8. [Analytics & Reporting](#8-analytics--reporting)
9. [Cross-Cutting Architectural Concerns](#9-cross-cutting-architectural-concerns)

---

## 1. RAG Pipeline Effectiveness

### Current State

The RAG pipeline (`govconnect-ai-service/src/services/rag.service.ts`) is well-architected with multiple stages:

| Stage | Implementation | Location |
|-------|---------------|----------|
| Query Classification | Micro LLM intent classifier | `rag.service.ts` L120–160 |
| Query Expansion | Micro LLM generates synonyms & related terms | `rag.service.ts` L162–220 |
| Semantic Search | Embedding-based vector search via Dashboard API | `rag.service.ts` L290–360 |
| Hybrid Search | RRF fusion (70% vector + 30% keyword) | `rag.service.ts` L362–440 |
| Re-ranking | Score-based re-ranking with deduplication | `rag.service.ts` L442–500 |
| Confidence Scoring | Multi-factor (top score, average, count, consistency) | `rag.service.ts` L502–580 |

**Strengths:**
- Hybrid search (vector + keyword) with Reciprocal Rank Fusion is solid for Indonesian language
- Micro LLM query expansion handles Indonesian synonyms/paraphrasing
- Confidence levels (high/medium/low/none) drive different prompt instructions in `context-builder.service.ts` L210–260
- Minimum score tuned down from 0.65 to 0.55 for Indonesian text characteristics
- Category inference falls back from NLU → keyword matching → none

### Gaps Identified

1. **No knowledge gap tracking**: When RAG returns `confidence: 'none'`, this is never recorded. There is no feedback loop to identify which topics lack knowledge base coverage.
   - `rag.service.ts` `retrieveContext()` returns the result, and `unified-message-processor.service.ts` L1879–2050 (`handleKnowledgeQuery`) uses it, but never logs gaps.

2. **No retrieval quality metrics**: The pipeline doesn't track or expose metrics like:
   - Average retrieval confidence per category
   - Frequency of "none" confidence results
   - Query expansion effectiveness (did expansion improve results?)
   - Hybrid vs. pure semantic comparison

3. **`inferCategories` is keyword-only**: `rag.service.ts` L580–640 uses hardcoded keyword lists (e.g., `ktp|e-ktp` → `kependudukan`). This misses semantic paraphrases like "kartu identitas" or misspellings.

4. **No chunk quality feedback**: Retrieved chunks are scored, but there's no mechanism to mark chunks as "helpful" or "unhelpful" — no RLHF-style loop.

5. **Query expansion is fire-and-forget**: The expanded query is used for retrieval, but the original vs. expanded performance isn't compared. No A/B tracking.

### Recommendations

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| R1.1 | Add a `knowledge_gaps` table in Dashboard DB to record queries where RAG returns `confidence: 'none'`. Log: query text, timestamp, channel, village_id. Surface in dashboard as "Knowledge Gap Report". | Medium | High |
| R1.2 | Track retrieval metrics in `AIAnalyticsService` — add counters for confidence levels per category, average scores, expansion effectiveness. | Low | Medium |
| R1.3 | Replace keyword-based `inferCategories` with the micro LLM classifier already available, or at minimum add fuzzy matching for Indonesian word variants. | Low | Medium |
| R1.4 | Add a "Was this helpful?" follow-up mechanism for knowledge answers — feed results back to chunk quality scoring. | High | High |
| R1.5 | Log both original and expanded queries with their retrieval scores to measure expansion effectiveness over time. | Low | Low |

---

## 2. Unanswered Question Tracking

### Current State

Three related mechanisms exist but are **disconnected**:

1. **`needs_knowledge` field** (`llm-response.types.ts` L48): Defined in the Zod schema as `z.boolean().optional()`. The system prompt (`system-prompt.ts` L160) instructs the LLM to set this to `true` when knowledge context is needed. Training examples show both `true` and `false` values (L324, L341).

2. **`unansweredQuestions` tracking** (`conversation-context.service.ts`): The `EnhancedContext` type tracks an `unansweredQuestions` array. However, this is populated during context building but **never persisted or reported**.

3. **`follow_up_questions` field** (`llm-response.types.ts` L50): Defined as `z.array(z.string()).optional()`. The LLM can suggest follow-ups, but these are **never extracted or used** by the processor.

### Gaps Identified

1. **`needs_knowledge` is NEVER READ from LLM responses**: In `unified-message-processor.service.ts`, after receiving the LLM response, the code reads `intent`, `fields`, `reply_text`, and `guidance_text` — but **never checks `needs_knowledge`**. The field only appears in fallback/error responses in `llm.service.ts` L300, L310, L327 where it's hardcoded to `false`.

2. **`follow_up_questions` is NEVER USED**: Same situation — the LLM may return follow-up questions, but the processor ignores them entirely. They're never appended to the reply or tracked.

3. **`unansweredQuestions` is in-memory only**: `conversation-context.service.ts` builds enhanced context with unanswered questions, but:
   - No API endpoint exposes this data
   - No persistence mechanism exists
   - Lost when the service restarts

4. **No "knowledge miss" counter**: `ai-analytics.service.ts` has no concept of a "knowledge miss" — when the system can't answer a question, it's not distinguished from a successful answer in analytics.

5. **No database table for unanswered questions**: Neither the Dashboard schema nor the AI service has a table for tracking questions the system couldn't answer. The Dashboard schema (`prisma/schema.prisma`) has no relevant model.

### Recommendations

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| R2.1 | **Read `needs_knowledge` from LLM responses** in the unified message processor. When `true` and RAG returned low/no confidence, log to a new `knowledge_gaps` table via RabbitMQ event to Dashboard. | Medium | **Critical** |
| R2.2 | **Use `follow_up_questions`** from LLM responses — append to `reply_text` as suggestions, or store for proactive engagement. | Low | Medium |
| R2.3 | **Create a `knowledge_gaps` Prisma model** in the Dashboard DB: `{ id, query_text, intent, confidence_level, channel, phone_hash, village_id, created_at, resolved_at, resolution_kb_id }`. | Medium | **Critical** |
| R2.4 | **Add knowledge miss/hit counters** to `AIAnalyticsService` — increment `knowledge_hit` when RAG confidence is high/medium, `knowledge_miss` when low/none. Expose via existing `/analytics` endpoint. | Low | High |
| R2.5 | **Emit RabbitMQ events** for unanswered questions (`knowledge.gap.detected`) so the Dashboard can persist and surface them for admin action. | Medium | High |

---

## 3. Intent Handling Completeness

### Current State

Intent classification flows through two stages:
1. **Micro NLU** (pre-LLM): Fast regex/keyword classifier for greetings, farewells, confirmations → handled without LLM call
2. **LLM classification**: Full Gemini call returns one of 12 intents defined in the Zod schema

The intent switch block in `unified-message-processor.service.ts` L3937–3997:

```
CREATE_COMPLAINT      → handleCreateComplaint()
SERVICE_INFO          → handleServiceInfo()
CREATE_SERVICE_REQUEST → handleCreateServiceRequest()
UPDATE_COMPLAINT      → handleUpdateComplaint()
UPDATE_SERVICE_REQUEST → handleUpdateServiceRequest()
CHECK_STATUS          → handleCheckStatus()
CANCEL_COMPLAINT      → handleCancelComplaint()
CANCEL_SERVICE_REQUEST → handleCancelServiceRequest()
HISTORY               → handleHistory()
KNOWLEDGE_QUERY       → handleKnowledgeQuery()
QUESTION              → (falls through to default)
UNKNOWN               → (falls through to default)
default               → uses LLM reply_text as-is
```

### Gaps Identified

1. **`QUESTION` and `UNKNOWN` have no dedicated handling**: Both fall through to `default`, which just uses the raw LLM `reply_text`. This means:
   - Questions that need knowledge lookup but were classified as `QUESTION` instead of `KNOWLEDGE_QUERY` bypass the RAG pipeline entirely
   - `UNKNOWN` intents get no special treatment — no escalation, no logging, no "I don't understand" standardization

2. **No intent confidence/ambiguity detection**: The LLM returns a single intent with no confidence score. When the LLM is uncertain between two intents (e.g., `KNOWLEDGE_QUERY` vs `SERVICE_INFO`), there's no mechanism to detect or handle ambiguity.

3. **No `ESCALATE` or `HUMAN_HANDOFF` intent**: The conversation context tracks `needsHumanHelp` (`conversation-context.service.ts`), but there's no corresponding intent for the LLM to signal that the user needs human assistance.

4. **Intent recording is incomplete**: `ai-analytics.service.ts` `recordIntent()` is called, but the `QUESTION` and `UNKNOWN` intents aren't analyzed for patterns — they're just counted. No alerting when `UNKNOWN` rate spikes.

5. **No intent correction mechanism**: If the LLM misclassifies an intent (e.g., user says "saya mau buat KTP" but LLM returns `KNOWLEDGE_QUERY` instead of `SERVICE_INFO`), there's no way to detect or correct this. The golden set evaluation (`ai_golden_set_runs` in Dashboard schema) exists but appears disconnected from production feedback.

### Recommendations

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| R3.1 | **Route `QUESTION` through RAG**: When intent is `QUESTION`, call `handleKnowledgeQuery()` instead of falling through to default. This ensures general questions get knowledge augmentation. | Low | **Critical** |
| R3.2 | **Add dedicated `UNKNOWN` handling**: Log the raw message, increment a "confused" counter, respond with a structured "I can help with X, Y, Z" menu, and escalate if `UNKNOWN` count > 3 in a session. | Low | High |
| R3.3 | **Add `ESCALATE_TO_HUMAN` intent**: Extend the Zod enum and system prompt. When detected, emit a RabbitMQ event for human handoff and respond with "Saya akan meneruskan ke petugas." | Medium | High |
| R3.4 | **Track intent confusion patterns**: Log when users immediately rephrase after receiving a response (potential misclassification signal). Correlate with follow-up intents. | Medium | Medium |
| R3.5 | **Connect golden set evaluation to production**: Use `ai_golden_set_items` results to generate a confusion matrix and identify systematic misclassifications. | Medium | Medium |

---

## 4. Conversation Context Quality

### Current State

Context management spans multiple components:

- **Chat history**: Channel Service stores last 30 messages per phone (FIFO) in `gc_channel.chat_histories`
- **Context building** (`context-builder.service.ts`):
  - Last 10 messages: Full detail with role labels
  - Older messages (11–30): Summarized via `extractKeyInfo()` — extracts problems, services, addresses, statuses
  - `formatConversationHistory()` (L50–120): Adds "Riwayat Ringkas" + "Detail Terbaru" sections
- **Enhanced context** (`conversation-context.service.ts`):
  - FSM state tracking (ConversationState enum)
  - `clarificationCount`, `isStuck`, `needsHumanHelp`
  - `unansweredQuestions` array
- **LRU caches** (`unified-message-processor.service.ts` L120–280):
  - `conversationContextCache` (1000 entries, 30min TTL)
  - `serviceInfoCache`, `complaintCategoryCache`, `villageCache`, etc.

### Gaps Identified

1. **Name extraction is fragile**: `extractUserName()` in `context-builder.service.ts` uses regex patterns like `/nama\s+saya\s+([A-Za-z\s]+)/i`. This:
   - Only matches Latin characters — misses Indonesian names with diacritics or non-Latin scripts
   - Fails on informal patterns like "panggil aja Budi" or "saya Budi"
   - Doesn't leverage the entity extractor's name extraction

2. **No topic/thread tracking across sessions**: If a user returns after hours to continue a complaint, the context builder treats it as a new conversation if the cache has expired (30min TTL). The 30 chat history messages help, but there's no explicit "resume previous topic" detection.

3. **`extractKeyInfo` is simplistic**: The summarization of older messages (`context-builder.service.ts` L130–180) uses keyword scanning (`keluhan|masalah|lapor` → problem, `surat|layanan|dokumen` → service). This misses nuanced context like:
   - Emotional state or urgency signals
   - Previously mentioned deadlines
   - Multi-step process progress

4. **No conversation quality scoring**: There's no metric for how well the context is being maintained. Symptoms like repeated data collection (asking for the same info twice) aren't detected.

5. **Context window optimization is basic**: The focused prompt system (`buildPromptFocus()`) reduces token usage, but there's no measurement of how often the full context is actually needed vs. the focused subset.

### Recommendations

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| R4.1 | **Unify name extraction**: Use `EntityExtractor.extractEntities()` results instead of the separate regex in `extractUserName()`. The entity extractor already handles name patterns. | Low | Medium |
| R4.2 | **Add topic resumption detection**: When a user sends a message after cache expiry, scan recent chat history for open/pending complaints or service requests and proactively ask "Apakah Anda ingin melanjutkan laporan [ID]?" | Medium | High |
| R4.3 | **Upgrade `extractKeyInfo` with micro LLM**: Replace keyword scanning with a micro LLM summarization call (similar to query expansion in RAG). Cost: ~10 tokens per older message. | Medium | Medium |
| R4.4 | **Detect repeated data collection**: Track which fields have been asked for in the conversation. If the LLM asks for the same field twice, flag it as a context quality issue and inject the previous answer. | Medium | High |
| R4.5 | **Measure context utilization**: Log prompt token count vs. useful context ratio. Identify conversations where context was rebuilt unnecessarily. | Low | Low |

---

## 5. Entity Extraction Quality

### Current State

`entity-extractor.service.ts` (512 lines) runs **pre-LLM** to extract structured data from raw text:

| Entity | Pattern | Location |
|--------|---------|----------|
| NIK | 16-digit number | L80–100 |
| Phone | `08xx`, `+628xx`, `628xx` patterns | L102–130 |
| Name | `nama saya X`, `nama: X` patterns | L132–170 |
| Address | `alamat:`, `jalan`, `jl.`, street patterns | L172–230 |
| Date | `dd/mm/yyyy`, `dd-mm-yyyy`, Indonesian month names | L232–280 |
| Time | `HH:MM`, `jam X` patterns | L282–310 |
| Complaint ID | `LP-XXXXX-XXXX` pattern | L312–330 |
| Request Number | `SR-XXXXX-XXXX` pattern | L332–350 |
| Email | Standard email regex | L352–370 |
| RT/RW | `RT XX/RW XX`, `RT/RW XX/XX` patterns | L372–400 |

### Gaps Identified

1. **No village/kelurahan name extraction**: Users frequently mention village names ("saya dari Kelurahan Sukajadi"), but there's no extractor for this. The village context is determined from the user's phone number registration, not from message content.

2. **Phone number patterns are incomplete for Indonesian usage**:
   - Missing: WhatsApp-style `0812 3456 7890` (with spaces)
   - Missing: Parenthesized area codes `(021) 1234567`
   - Missing: Local slang like "nol delapan satu dua" (spelled out)

3. **Name extraction is Latin-only**: Pattern `[A-Za-z\s]+` at L132–170 excludes:
   - Names with apostrophes (Ma'ruf, Nu'man)
   - Hyphenated names (Abdul-Rahman)
   - Single-word names common in Indonesian culture (e.g., "Suharto", "Sukarno")

4. **Address extraction misses Indonesian-specific patterns**:
   - No extraction for "Gang" (alley) — common: "Gang Melati No. 5"
   - No extraction for "Perumahan" (housing complex)
   - No extraction for "Blok" designators — "Blok C No. 12"
   - Doesn't handle abbreviated village references: "Kel. Sukajadi"

5. **No confidence scoring on extractions**: All extractions are binary (matched or not). No indication of whether "Jl. Merdeka 10" is a high-confidence address vs. a partial match.

6. **Date extraction doesn't handle relative dates**: "kemarin", "minggu lalu", "bulan depan" — common in Indonesian — are not extracted or converted.

### Recommendations

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| R5.1 | **Add village/kelurahan extractor**: Match against known village names from the database. Pattern: `kelurahan\s+(\w+)`, `desa\s+(\w+)`, `kel\.\s*(\w+)`. Cross-reference with `villages` table. | Medium | High |
| R5.2 | **Expand phone patterns**: Add space-separated digits, parenthesized area codes, and international format without `+`. | Low | Low |
| R5.3 | **Fix name regex for Indonesian names**: Allow apostrophes, hyphens, periods (for abbreviations like "H." or "Hj."), and single-word names. Pattern: `[A-Za-z\s'.\\-]+`. | Low | Medium |
| R5.4 | **Add Gang, Perumahan, Blok address patterns**: Extend address regex with common Indonesian address components. | Low | Medium |
| R5.5 | **Add relative date resolution**: Convert "kemarin" → yesterday's date, "minggu lalu" → last week, etc. Use current date as anchor. | Medium | Medium |
| R5.6 | **Add extraction confidence scores**: Return `{ value, confidence, source_span }` instead of bare strings. This helps the LLM decide whether to ask for confirmation. | Medium | Medium |

---

## 6. Error Recovery & Resilience

### Current State

Error recovery is multi-layered:

| Layer | Mechanism | Location |
|-------|-----------|----------|
| LLM JSON parsing | Multi-stage fix: unterminated strings → extract JSON → fallback UNKNOWN | `llm.service.ts` L280–340 |
| Anti-hallucination | Detect fabricated data (hours, costs, links, phones) → retry with instruction | `anti-hallucination.service.ts` L30–100 |
| Smart fallback | State-aware + intent-aware + pattern-based responses | `fallback-response.service.ts` L40–180 |
| Model fallback chain | 5-model cascade: `2.0-flash-lite → 2.5-flash-lite → 2.0-flash → 2.5-flash → 3-flash` | `llm.service.ts` L50–80 |
| BYOK key rotation | Rotate API keys on rate limit or quota errors | `llm.service.ts` L150–200 |
| Service circuit breaker | `shared/circuit-breaker.ts` for downstream service calls | shared module |
| Error classification | Categorizes: TIMEOUT, RATE_LIMIT, SERVICE_DOWN, INVALID_RESPONSE | `unified-message-processor.service.ts` L4060–4100 |

**Strengths:**
- The fallback chain ensures the service almost never returns a hard error to the user
- Anti-hallucination retry catches fabricated office hours, costs, and URLs
- Smart fallback uses conversation state to give contextually appropriate error messages
- `sanitizeFakeLinks` post-processes responses to remove placeholder URLs

### Gaps Identified

1. **Anti-hallucination only fires when NO knowledge context**: `anti-hallucination.service.ts` L60–80 checks `if (!knowledgeContext || knowledgeContext.length === 0)`. If RAG returns low-quality chunks (confidence: 'low'), hallucination detection is skipped — the LLM may still hallucinate based on low-quality context.

2. **No retry budget tracking**: The anti-hallucination retry calls the LLM again, but there's no limit tracked per-session. If the LLM consistently hallucinates for a query, it could retry indefinitely (though currently it only retries once).

3. **JSON parsing fallback loses data**: When `llm.service.ts` L310–327 builds a fallback response, it sets `intent: 'UNKNOWN'` and a generic error message. The user's original message context is lost — the processor can't distinguish between "LLM had a temporary glitch" vs. "this query always fails."

4. **No error pattern detection**: Errors are classified but not aggregated over time. A spike in `RATE_LIMIT` errors or `TIMEOUT` errors doesn't trigger any alert or adaptive behavior (like preemptively switching to a lighter model).

5. **Circuit breaker configuration is static**: `shared/circuit-breaker.ts` has hardcoded thresholds. No dynamic adjustment based on observed error rates.

6. **No dead letter queue**: If a RabbitMQ message fails processing, there's no DLQ mechanism to capture and retry failed messages. Failed messages are logged but lost.

### Recommendations

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| R6.1 | **Extend anti-hallucination to low-confidence RAG results**: Trigger hallucination detection when confidence is 'low' or 'none', not just when context is empty. | Low | **Critical** |
| R6.2 | **Add per-session retry budget**: Track LLM retries per phone+session. After 2 retries in 5 minutes, skip retry and use smart fallback directly. | Low | Medium |
| R6.3 | **Preserve context in JSON fallback**: When building fallback responses, include the original query text and extracted entities so downstream handling can still attempt a useful response. | Low | Medium |
| R6.4 | **Add error rate monitoring with adaptive behavior**: Track errors per model per 5-minute window. If a model exceeds error threshold, preemptively skip it in the fallback chain. | Medium | High |
| R6.5 | **Implement RabbitMQ DLQ**: Configure dead letter exchanges for failed message processing. Add a retry mechanism with exponential backoff. | Medium | High |
| R6.6 | **Add circuit breaker metrics endpoint**: Expose circuit breaker state (CLOSED/OPEN/HALF-OPEN) via the health endpoint for monitoring. | Low | Medium |

---

## 7. Knowledge Base Structure

### Current State

The knowledge base schema (Dashboard Prisma schema) provides:

```
knowledge_base
  ├── id, title, content, category, category_id, village_id
  ├── keywords[]          ← String array for keyword matching
  ├── is_active           ← Soft delete
  ├── priority            ← Integer priority ranking
  ├── last_embedded_at    ← Tracks embedding freshness
  └── source              ← Optional source tracking

knowledge_documents
  ├── id, filename, file_type, file_size
  ├── processing_status   ← PENDING/PROCESSING/COMPLETED/FAILED
  └── chunks              → document_chunks[]

document_chunks
  ├── chunk_index, content, page_number
  ├── section_title       ← Structural metadata
  └── metadata            ← JSON blob

knowledge_categories
  ├── name, slug, description
  ├── village_id          ← Per-village categories
  └── parent_id           ← Hierarchical (nullable)
```

**Strengths:**
- Per-village knowledge isolation — multi-tenant by design
- Document chunking with structural metadata (page, section)
- Embedding freshness tracking (`last_embedded_at`)
- Hierarchical categories (`parent_id` self-reference)

### Gaps Identified

1. **`priority` field is unused in RAG retrieval**: `rag.service.ts` retrieves and ranks by embedding similarity score, but never factors in the `priority` field. High-priority knowledge (e.g., emergency procedures) gets the same weight as low-priority content.

2. **`keywords[]` field is underutilized**: The hybrid search in `rag.service.ts` does keyword search via a separate API, but doesn't leverage the pre-defined `keywords[]` array on knowledge base entries. This array could provide curated, high-quality keyword matches instead of relying solely on full-text search.

3. **No knowledge base versioning**: When content is updated, the previous version is overwritten. No audit trail of what changed, when, and by whom. Critical for government accountability.

4. **No knowledge expiry/review mechanism**: There's no `expires_at` or `review_by` field. Government regulations and SOPs change — stale knowledge can cause incorrect answers indefinitely.

5. **Chunk metadata is a JSON blob**: `document_chunks.metadata` is typed as `Json?` — unstructured. No schema enforcement means inconsistent metadata across chunks, making it hard to query or filter.

6. **No inter-document linking**: Knowledge entries are isolated. There's no mechanism to link related entries (e.g., "KTP renewal" → "Required documents for KTP" → "Office hours for KTP service"). The `knowledge-graph.service.ts` handles service relationships but not knowledge article relationships.

7. **No knowledge base completeness tracking**: No way to identify which categories have sparse coverage vs. comprehensive coverage. No "coverage score" per category.

### Recommendations

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| R7.1 | **Use `priority` in RAG ranking**: Add priority as a boost factor in the scoring formula. E.g., `final_score = similarity_score * (1 + 0.1 * priority)`. | Low | High |
| R7.2 | **Leverage `keywords[]` in hybrid search**: When performing keyword search, also match against the curated `keywords[]` array with a higher weight than full-text matches. | Low | Medium |
| R7.3 | **Add knowledge versioning**: Create a `knowledge_base_versions` table that stores previous content snapshots with `changed_by`, `changed_at`, `change_reason`. | Medium | High |
| R7.4 | **Add `review_by` and `expires_at` fields**: Surface expiring/expired knowledge in the dashboard for proactive admin review. | Low | **Critical** |
| R7.5 | **Type chunk metadata**: Define a Zod schema for `document_chunks.metadata` and validate on ingestion. Include: `language`, `entity_mentions[]`, `topic_tags[]`, `quality_score`. | Medium | Medium |
| R7.6 | **Add knowledge article linking**: Create a `knowledge_relations` table (source_id, target_id, relation_type: 'prerequisite'|'related'|'supersedes'). Use in RAG to retrieve related articles. | Medium | Medium |
| R7.7 | **Build a coverage dashboard**: Per-category: total entries, average embedding quality, last updated, query frequency vs. content volume ratio. | Medium | High |

---

## 8. Analytics & Reporting

### Current State

Analytics architecture:

```
AIAnalyticsService (in-memory singleton)
  ├── IntentStats: { count, successRate, avgResponseTime }
  ├── ConversationFlowStats: { sessions, avgMessages, completionRate }
  ├── TokenUsageStats: { byModel, byKeyTier, total }
  ├── AccuracyStats: { totalRequests, successCount, failCount }
  └── Session tracking: { 30min timeout, auto-cleanup every 10min }

Dashboard API → proxies to AI service endpoints:
  ├── /api/statistics/overview     → Case Service (complaint/service counts)
  ├── /api/statistics/ai-usage     → AI service model stats
  ├── /api/statistics/knowledge-analytics → AI analytics + intents + flow
  ├── /api/statistics/token-usage   → Token consumption
  └── /api/statistics/trends        → Time-series data
```

### Gaps Identified

1. **ALL analytics are in-memory — LOST ON RESTART**: `AIAnalyticsService` is a singleton class with no persistence layer. Every deployment, crash, or restart wipes all accumulated analytics. This is the single biggest analytics gap.

2. **No persistent analytics tables**: The Dashboard Prisma schema has NO analytics models. No `ai_analytics`, `ai_sessions`, `ai_intent_stats`, or similar tables.

3. **Knowledge analytics endpoint is a facade**: `/api/statistics/knowledge-analytics` in the Dashboard (`app/api/statistics/knowledge-analytics/route.ts`) tries to calculate "knowledge hit rate" and "knowledge miss rate," but the AI service doesn't actually track `knowledge_hit` or `knowledge_miss` events. The endpoint returns placeholder/estimated data.

4. **No per-village analytics**: Analytics aren't segmented by village. Multi-tenant deployments can't compare AI performance across villages.

5. **No user satisfaction tracking**: No mechanism for users to rate responses. No proxy metrics (e.g., did the user rephrase? Did they escalate? Did they complete their task?).

6. **Token usage has no budgeting/alerting**: Token consumption is tracked but there are no budget limits or alerts when usage exceeds thresholds. For BYOK users, no cost projection or optimization suggestions.

7. **No conversation completion tracking**: A "session" is tracked (30min timeout), but there's no concept of "task completion." Did the user successfully file a complaint? Did they get the information they needed? The `ConversationFlowStats.completionRate` exists but is calculated simplistically.

8. **Trend data has no historical baseline**: `/api/statistics/trends` returns current period data, but with no historical storage, there's no way to compare month-over-month or detect deterioration.

### Recommendations

| # | Recommendation | Effort | Impact |
|---|---------------|--------|--------|
| R8.1 | **Persist analytics to database**: Create analytics tables in Dashboard DB and emit analytics events via RabbitMQ from AI service. Minimum tables: `ai_sessions`, `ai_intent_logs`, `ai_token_usage_daily`, `ai_knowledge_queries`. | High | **Critical** |
| R8.2 | **Add periodic analytics flush**: As an interim solution, add a scheduled job (every 5min) to POST accumulated analytics to Dashboard API for persistence. Survives between flushes, not between restarts. | Medium | High |
| R8.3 | **Segment analytics by village_id**: Add `village_id` dimension to all analytics tracking. Essential for multi-tenant performance comparison. | Medium | High |
| R8.4 | **Define task completion heuristics**: A complaint creation is "complete" when a complaint_id is returned. A knowledge query is "complete" when the user doesn't rephrase within 2 minutes. Track these. | Medium | High |
| R8.5 | **Add token budget alerts**: Per-village, per-key tier daily token budgets with alert thresholds (80%, 100%). Surface in dashboard and optionally via notification service. | Medium | Medium |
| R8.6 | **Build a monthly analytics digest**: Automated report generation comparing current period vs. previous: intent distribution shifts, knowledge gap trends, error rate changes. | High | Medium |
| R8.7 | **Implement satisfaction proxy scoring**: Score each conversation: +1 for task completion, -1 for rephrase, -2 for repeated UNKNOWN, -3 for session abandonment mid-flow. | Medium | High |

---

## 9. Cross-Cutting Architectural Concerns

### Stateless AI Service — Blessing and Curse

The AI Orchestrator is intentionally stateless (no database) per the architecture decision. This simplifies deployment and scaling, but creates significant limitations:

| Concern | Impact |
|---------|--------|
| In-memory analytics lost on restart | All intelligence data is ephemeral |
| No persistent learning | The service can't improve based on past interactions |
| Cache coherence | LRU caches aren't shared across instances if horizontally scaled |
| No knowledge gap persistence | Gaps identified during processing can't be stored locally |

**Recommendation**: Introduce a **lightweight persistence layer** — either:
- (A) A dedicated Redis instance for analytics and caches (shared across instances, survives restarts)
- (B) RabbitMQ event-driven persistence to Dashboard DB (maintains stateless principle, adds eventual consistency)

Option (B) is recommended as it aligns with the existing architecture — AI service emits events, Dashboard service persists them.

### Missing Feedback Loops

The system has **no closed-loop learning**:

```
Current:  User → AI → Response → (end)
Desired:  User → AI → Response → Feedback → Analytics → Prompt Tuning → Better Response
```

Key missing loops:
1. **RAG quality → Knowledge base curation**: No signal flows back from RAG retrieval quality to knowledge base maintenance
2. **Intent accuracy → Prompt improvement**: No signal from misclassifications to system prompt refinement
3. **User satisfaction → Service quality**: No signal from user experience to any optimization

### Summary Priority Matrix

| Priority | Recommendations | Theme |
|----------|----------------|-------|
| **P0 — Critical** | R2.1, R2.3, R3.1, R6.1, R7.4, R8.1 | Core intelligence gaps that actively hurt answer quality |
| **P1 — High** | R1.1, R2.4, R2.5, R3.2, R3.3, R4.2, R4.4, R5.1, R6.4, R6.5, R7.1, R7.3, R7.7, R8.2, R8.3, R8.4, R8.7 | Significant improvements to intelligence and reliability |
| **P2 — Medium** | R1.2, R1.3, R3.4, R3.5, R4.1, R4.3, R5.3, R5.4, R5.5, R5.6, R6.2, R6.3, R6.6, R7.2, R7.5, R7.6, R8.5, R8.6 | Quality-of-life improvements and hardening |
| **P3 — Low** | R1.4, R1.5, R4.5, R5.2 | Nice-to-have optimizations |

### Suggested Implementation Order

**Phase 1 — Quick Wins (1–2 weeks)**:
- R3.1: Route `QUESTION` through RAG (low effort, critical impact)
- R6.1: Extend anti-hallucination to low-confidence results
- R2.4: Add knowledge hit/miss counters
- R7.1: Use `priority` in RAG scoring
- R4.1: Unify name extraction

**Phase 2 — Foundation (2–4 weeks)**:
- R2.3: Create `knowledge_gaps` table
- R2.1 + R2.5: Read `needs_knowledge`, emit gap events
- R8.1 or R8.2: Persist analytics
- R3.2: Dedicated UNKNOWN handling
- R7.4: Add knowledge expiry fields

**Phase 3 — Intelligence Layer (4–8 weeks)**:
- R8.3 + R8.4: Village segmentation + task completion tracking
- R3.3: ESCALATE_TO_HUMAN intent
- R4.2: Topic resumption detection
- R7.3: Knowledge versioning
- R8.7: Satisfaction proxy scoring
- R1.1 + R7.7: Knowledge gap dashboard + coverage metrics

---

*End of audit report. All findings are based on source code analysis — no code changes were made.*
