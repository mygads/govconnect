/**
 * Village scoping helpers for user profiles (W5).
 *
 * P0 privacy: profiles are keyed by (village_id, wa_user_id), not by
 * wa_user_id alone. The old single-key layout mixed PII (NIK/nama/alamat)
 * across villages.
 *
 * Legacy rows written before scoping use village_id = '' (LEGACY_VILLAGE_SCOPE,
 * unknown village). Reads try the scoped key first, then fall back to the
 * legacy row; the next write lazily migrates the legacy row to the scoped key
 * and deletes it. No user data is deleted by the migration.
 *
 * This module is intentionally dependency-free (no Prisma, no logger) so it
 * can be unit-tested without a database.
 */

/** Scope used for rows written before village scoping existed. */
export const LEGACY_VILLAGE_SCOPE = '';

/** Normalize a village scope for key building. Empty/blank => legacy scope. */
export function normalizeVillageScope(village_id?: string | null): string {
  return (village_id ?? '').trim();
}

/**
 * Build the composite profile key. Pure and exported for unit tests.
 * Format: "<village_id>::<wa_user_id>" (village_id '' = legacy scope).
 *
 * The '::' separator is safe because wa_user_id never contains it
 * (phone numbers / WA JIDs), and village_id is trimmed.
 */
export function buildProfileCacheKey(
  village_id: string | undefined | null,
  wa_user_id: string,
): string {
  return `${normalizeVillageScope(village_id)}::${wa_user_id}`;
}

/**
 * True when a cache key belongs to the given user in ANY village scope.
 * Used by admin wipe paths that intentionally clear all scopes.
 */
export function isKeyForUser(cacheKey: string, wa_user_id: string): boolean {
  return cacheKey.endsWith(`::${wa_user_id}`);
}
