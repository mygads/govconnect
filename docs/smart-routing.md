# GovConnect AI Smart Routing

Status: updated 2026-04-29.

GovConnect AI runtime routing is DB-backed. `ai_providers`, `ai_models`, and `ai_lane_assignments` define the runtime candidates; `ai_provider_health` stores cross-instance health state.

## Runtime candidate resolution

1. Resolve primary and fallback model assignment for the lane.
2. Add active same-lane model candidates ordered by model priority, then provider priority.
3. Skip providers where `demoted_until > NOW()`.
4. Try remaining candidates in order, rotating configured API keys per attempt.

## Demotion

- Success resets `consecutive_failures`, `demoted_until`, and `probe_in_flight_until`.
- Failure increments `consecutive_failures` and clears `probe_in_flight_until`.
- At 3 consecutive failures, the provider is demoted for 1 hour.
- Broken encrypted provider keys are treated as runtime configuration failures and count toward demotion.

## Probe after cooldown

When all lane candidates are demoted, one provider may be probed after cooldown. The probe is coordinated in PostgreSQL:

```sql
SELECT provider_id, lane_type
FROM ai_provider_health
WHERE demoted_until <= NOW()
  AND (probe_in_flight_until IS NULL OR probe_in_flight_until < NOW())
FOR UPDATE SKIP LOCKED;
```

The claiming transaction then sets `probe_in_flight_until = NOW() + 60s`. This gives cross-instance coordination and prevents duplicate probes if multiple service instances notice the cooldown at the same time. A successful probe restores the provider; a failed probe demotes it for another hour.

## Circuit breakers and cache invalidation

Each outbound target uses a lazy circuit breaker keyed by `lane:provider:baseUrl`. Runtime config cache invalidation also clears matching breakers, so provider/base URL changes do not inherit stale breaker state.

Detailed AI-service notes live in `govconnect-ai-service/docs/smart-routing.md`.
