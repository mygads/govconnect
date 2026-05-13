# PRD: AI Human Agent Comprehensive Audit

## Objective
Validate that the AI agent behaves like a competent human CS representative:
- Answers from knowledge base (not hallucinated)
- Handles service advisory correctly
- Manages complaints with proper category, urgency, photo handling
- Admin upload/embed/retrieval pipeline works end-to-end
- Handles ambiguity gracefully, refuses out-of-scope
- Fast-intent/regex doesn't degrade human-like responses

## Script
`scripts/qa-ai-agent-audit-sanreseng-ade.ps1`

## Test Groups

### GROUP 1: Knowledge Fidelity (DB-validated)
- Query knowledge search API to get actual KB content
- Ask AI questions that should be answered from KB
- Validate response contains data from KB, not hallucinated
- Test: FAQ, SOP pengaduan, format file, profil desa, kebijakan data

### GROUP 2: Service Advisory (DB-validated)
- Query case service for active services list
- Ask AI about available services, requirements, online/offline
- Validate response mentions actual services from DB
- Test: list layanan, KTP, SKU, domisili, pindah

### GROUP 3: Complaint CRUD + Photo + Urgency
- Test complaint creation flow (multi-turn)
- Test photo/image handling acknowledgment
- Test urgency detection (keselamatan vs biasa)
- Test category matching against DB categories
- Test status check with valid/invalid LAP numbers

### GROUP 4: Admin Upload/Embed/Retrieval
- Upload test knowledge via POST /api/knowledge
- Verify embedding was created (GET /api/knowledge/:id)
- Search for the uploaded content via vector search
- Ask AI a question that should be answered by new content
- Cleanup: DELETE /api/knowledge/:id

### GROUP 5: Ambiguity & No-Hallucination
- Ask ambiguous questions (should clarify, not guess)
- Ask questions with no KB data (should say tidak tersedia)
- Ask out-of-scope (coding, resep, cuaca) → should refuse
- Ask about data that exists in 2 categories → should disambiguate

### GROUP 6: Fast-Intent vs Full-Agent Regression
- Test diverse human-like phrasings (slang, typo, bahasa daerah)
- Verify regex/fast-intent doesn't produce template responses
- Test that complex questions still go to full agent
- Test greeting → knowledge → complaint flow in one session
- Test that fast-intent savings don't lose user intent

## Validation Strategy
- All expected answers fetched from DB/API at runtime
- No hardcoded expected values
- Response quality checked via substring matching + negative assertions
- Multi-turn tests use same session_id for context continuity
