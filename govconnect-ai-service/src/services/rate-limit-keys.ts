/**
 * W8 — village-scoped rate-limit / spam-guard keys.
 *
 * Tenant isolation invariant: the same WhatsApp user in two different
 * villages must NEVER share rate-limit counters or spam-guard state.
 *
 * These key builders are intentionally dependency-free (no DB, no timers,
 * no network) so the invariant stays unit-testable even when the Prisma
 * client is unavailable. Services delegate to these functions.
 *
 * Honest limitation: the per-user COUNTERS themselves are in-memory per
 * process (multi-instance fleets need a shared store — e.g. Redis or DB).
 * Only the blacklist is DB-backed today. Keys being village-scoped means
 * that when a shared store is added, no key migration is needed.
 */

/** "<village_id>:<wa_user_id>" — never a bare user id. */
export function rateLimitScopeKey(wa_user_id: string, village_id?: string | null): string {
  return `${village_id || '__global__'}:${wa_user_id}`;
}

/** "<village_id>:<wa_user_id>" — never a bare user id. */
export function spamGuardStateKey(
  villageId: string | undefined,
  waUserId: string,
): string {
  return `${villageId || 'unknown'}:${waUserId}`;
}
