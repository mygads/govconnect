# Smart Routing & Provider Cooldown

govconnect-ai-service routes lane traffic across multiple providers configured in `ai_providers`.
This document describes the failure-handling algorithm.

## Algorithm

1. For each request, the runtime resolves all candidate attempts for the lane:
   - primary model (from `ai_lane_assignments`)
   - fallback model (from `ai_lane_assignments`)
   - any other active models with the same `lane_type`, ordered by `ai_models.priority` ASC then
     `ai_providers.priority` ASC (lower = higher priority).
2. Candidates whose provider is currently demoted (`ai_provider_health.demoted_until > NOW()`)
   are filtered out.
3. The remaining candidates are tried in order, with API-key rotation per attempt.

## Failure tracking

- Each successful response **resets** `consecutive_failures` to 0 and clears `demoted_until`.
- Each failure (HTTP error, timeout, circuit-open) **increments** `consecutive_failures`.
- When `consecutive_failures >= 3`, the provider is **demoted** for 1 hour
  (`demoted_until = NOW() + 1h`).

## Probe after cooldown

When all candidates for a lane are demoted, the highest-priority demoted provider is sent a
single **probe** request (atomic via `shouldProbe()`):

- If the probe succeeds → provider is restored (counter reset).
- If the probe fails → provider is re-demoted for another hour.

Subsequent callers wait until the next probe window opens.

## Caching

In-memory cache (TTL 30s) sits in front of the `ai_provider_health` table to avoid a DB
round-trip on every gateway call. Writes go through immediately so health status converges
across instances within ~30s.

## Circuit breaker

A lazy per-target circuit breaker (`opossum`, key = `lane:provider:baseUrl`) wraps the actual
HTTP call. If it opens (>60% failure across 5+ requests in 30s window), `executeGatewayRequest`
throws and the outer loop falls through to the next attempt — which combined with the health
demotion mechanism above gives both fast-fail and persistent demotion.

## Operational visibility

Logs emitted (JSON):
- `AI provider demoted due to consecutive failures`
- `All providers demoted; sending probe to highest-priority`
- `Gateway circuit OPEN/HALF-OPEN/CLOSED`
- `AI gateway call successful` / `AI gateway call failed`

Direct DB query for status:
```sql
SELECT provider_id, lane_type, consecutive_failures, demoted_until, last_success_at
FROM ai_provider_health
ORDER BY demoted_until DESC NULLS LAST;
```
