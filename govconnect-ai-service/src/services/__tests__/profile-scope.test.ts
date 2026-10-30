/**
 * W5: village scoping for user profiles.
 * Tests the pure key-building helpers (no Prisma, no DB).
 */
import { describe, it, expect } from 'vitest';
import {
  LEGACY_VILLAGE_SCOPE,
  normalizeVillageScope,
  buildProfileCacheKey,
  isKeyForUser,
} from '../profile-scope';

describe('profile-scope (W5)', () => {
  it('scopes keys by (village_id, wa_user_id)', () => {
    expect(buildProfileCacheKey('desa-a', '628123')).toBe('desa-a::628123');
    expect(buildProfileCacheKey('desa-b', '628123')).toBe('desa-b::628123');
  });

  it('never collides across villages for the same user', () => {
    const a = buildProfileCacheKey('desa-a', '628123');
    const b = buildProfileCacheKey('desa-b', '628123');
    expect(a).not.toBe(b);
  });

  it('maps missing/blank village_id to the legacy scope', () => {
    expect(buildProfileCacheKey(undefined, '628123')).toBe('::628123');
    expect(buildProfileCacheKey(null, '628123')).toBe('::628123');
    expect(buildProfileCacheKey('', '628123')).toBe('::628123');
    expect(buildProfileCacheKey('   ', '628123')).toBe('::628123');
    expect(normalizeVillageScope(undefined)).toBe(LEGACY_VILLAGE_SCOPE);
    expect(normalizeVillageScope('  desa-a  ')).toBe('desa-a');
  });

  it('legacy scope never equals a real village scope', () => {
    const legacy = buildProfileCacheKey('', '628123');
    const scoped = buildProfileCacheKey('desa-a', '628123');
    expect(legacy).not.toBe(scoped);
  });

  it('isKeyForUser matches any scope of the same user only', () => {
    expect(isKeyForUser('desa-a::628123', '628123')).toBe(true);
    expect(isKeyForUser('::628123', '628123')).toBe(true);
    expect(isKeyForUser('desa-a::628123', '628124')).toBe(false);
    expect(isKeyForUser('desa-a::6281234', '628123')).toBe(false);
  });
});
