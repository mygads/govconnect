# Smart Routing & Provider Cooldown

govconnect-ai-service routes lane traffic across multiple providers configured in `ai_providers`. Runtime provider/model/lane data is loaded from the database, not from static environment gateway config.

## AI provider layer

- `ai_providers` stores provider identity, base URL, provider kind, priority, sanitized default headers, and encrypted API keys.
- `ai_models` stores lane-specific model names and optional endpoint path overrides.
- `ai_lane_assignments` picks the primary and fallback model per lane, optionally scoped to a village.
- `ai_provider_health` stores cross-instance health state used for demotion and probe coordination.

## Secret-at-rest and header safety

Provider API keys are encrypted before persistence with AES-256-GCM and decrypted only while building a runtime gateway attempt. Admin-provided default headers reject auth-like names such as `Authorization`, `Proxy-Authorization`, `x-api-key`, `x-goog-api-key`, `api-key`, `apikey`, and `x-auth-token`.

At request time, gateway headers are assembled so the decrypted runtime key always writes `Authorization: Bearer <key>` after default headers and provider-specific headers are applied. Legacy database rows containing an auth header therefore cannot override the runtime key.

If a provider key cannot be decrypted, the runtime attempt is marked broken, skipped because it has no usable API key, and reported to provider health as a failure so smart routing can demote it.

## Algorithm

1. For each request, the runtime resolves all candidate attempts for the lane:
   - primary model from `ai_lane_assignments`
   - fallback model from `ai_lane_assignments`
   - any other active models with the same `lane_type`, ordered by `ai_models.priority` ASC then `ai_providers.priority` ASC (lower = higher priority).
2. Candidates whose provider is currently demoted (`ai_provider_health.demoted_until > NOW()`) are filtered out.
3. Remaining candidates are tried in order, with API-key rotation per attempt.
4. If all candidates are demoted, the highest-priority demoted provider may be claimed for one probe request.

## Failure tracking

- Each successful response resets `consecutive_failures` to 0 and clears `demoted_until` and `probe_in_flight_until`.
- Each failure (HTTP error, timeout, circuit-open, or broken runtime key) increments `consecutive_failures` and clears `probe_in_flight_until`.
- When `consecutive_failures >= 3`, the provider is demoted for 1 hour (`demoted_until = NOW() + 1h`).

## Probe after cooldown

When all candidates for a lane are demoted, the highest-priority demoted provider is sent a single probe request if `shouldProbe()` can claim the DB row:

- Claim condition: `demoted_until <= NOW()` and `probe_in_flight_until` is null or expired.
- Claim mechanism: transaction with `FOR UPDATE SKIP LOCKED`, then `probe_in_flight_until = NOW() + 60s`.
- Success restores the provider by resetting the counter.
- Failure re-demotes the provider for another hour.

The probe gate is best-effort cross-instance coordination. The 60s window prevents duplicate probes when an instance crashes mid-probe.

## Caching

In-memory cache (TTL 30s) sits in front of the `ai_provider_health` table to avoid a DB round-trip on every gateway call. Writes go through immediately so health status converges across instances within about 30s.

Runtime gateway config also has a short cache. Clearing that cache notifies the gateway layer to clear matching circuit breakers so provider/base URL changes do not inherit stale breaker state.

## Circuit breaker

A lazy per-target circuit breaker (`opossum`, key = `lane:provider:baseUrl`) wraps the actual HTTP call. If it opens (>60% failure across 5+ requests in a 30s window), `executeGatewayRequest` throws and the outer loop falls through to the next attempt. Health demotion then persists repeated failures beyond the breaker window.

## Operational visibility

Logs emitted:

- `AI provider demoted due to consecutive failures`
- `All providers demoted; sending probe to highest-priority`
- `AI gateway attempt has broken runtime configuration`
- `Gateway circuit OPEN/HALF-OPEN/CLOSED`
- `AI gateway call successful` / `AI gateway call failed`

Direct DB query for status:

```sql
SELECT provider_id, lane_type, consecutive_failures, demoted_until, probe_in_flight_until, last_success_at, last_failure_at
FROM ai_provider_health
ORDER BY demoted_until DESC NULLS LAST;
```
