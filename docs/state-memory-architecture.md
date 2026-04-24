# GovConnect State and Memory Architecture

Tanggal: 2026-04-24

## Four Layers

### 1. Conversation State

Purpose: short-lived continuity for the current chat.

Owned by: channel-service + AI context builder.

Contents:
- recent messages,
- conversation summary,
- pending confirmations,
- current user utterance,
- takeover state.

Prompt rule: include only summary + recent messages relevant to current request.

### 2. User Profile Memory

Purpose: stable citizen preferences/profile for continuity.

Owned by: AI user-profile memory.

Contents:
- optional name,
- known address hints,
- consent status,
- safe autofill hints.

Prompt rule: include summarized memory only; never include unrelated documents or sensitive raw history.

### 3. Case Memory

Purpose: operational records for reports and service requests.

Owned by: case-service.

Contents:
- complaint records,
- service request records,
- statuses,
- admin notes/result files,
- owner validation data.

Prompt/tool rule: access via domain tools only (`check_status`, `get_my_history`, `update_complaint`, etc.). Do not cache cross-tenant.

### 4. Operational State

Purpose: system operations and observability.

Owned by: all services.

Contents:
- AI token usage,
- delivery logs,
- retry queues,
- golden-set runs,
- guardrail/tool-policy traces,
- correlation IDs.

Prompt rule: do not expose to citizen except high-level service status when explicitly relevant.

## Boundary Rules

- Pre-agent router: policy/routing only, no business mutation.
- Agent tool executor: adapter between agent and domain service, no hidden business rules beyond validation.
- Domain handlers/services: source of truth for business rules and status mutation.
- Notification service: delivery side effects only, never source of truth for case status.
- Dashboard: administration UI/API, not a bypass for domain validation.

## Context Selection

Order of prompt context priority:

1. Current user message.
2. Active pending state / confirmation.
3. Tenant behavior config.
4. Conversation summary + recent messages.
5. User profile memory summary.
6. Tool/RAG result for the current question.

Never include:
- unrelated tenant data,
- raw long PII logs,
- hidden system policy as user-facing text,
- retrieval instructions as executable instructions.
