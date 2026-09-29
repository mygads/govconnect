/**
 * W8 regression tests: rate-limit / spam-guard keys MUST be village-scoped.
 *
 * Tenant isolation invariant: the same WhatsApp user in two different
 * villages must never share rate-limit counters or spam-guard state.
 * These tests lock that invariant against future refactors.
 *
 * Pure key functions only — no DB, no timers, no network.
 */

import { describe, it, expect } from 'vitest';
import { rateLimitScopeKey, spamGuardStateKey } from '../rate-limit-keys';

describe('W8 village-scoped rate limit keys', () => {
  it('same user in different villages → different keys (isolation)', () => {
    const a = rateLimitScopeKey('6281111111', 'desa-a');
    const b = rateLimitScopeKey('6281111111', 'desa-b');
    expect(a).not.toBe(b);
    expect(a).toContain('desa-a');
    expect(b).toContain('desa-b');
  });

  it('same user + same village → stable key', () => {
    expect(rateLimitScopeKey('6281111111', 'desa-a'))
      .toBe(rateLimitScopeKey('6281111111', 'desa-a'));
  });

  it('never a bare user id (no cross-village leakage by construction)', () => {
    const k = rateLimitScopeKey('6281111111', 'desa-a');
    expect(k).not.toBe('6281111111');
    expect(k.split(':').length).toBeGreaterThanOrEqual(2);
  });

  it('missing village → deterministic fallback bucket (documented)', () => {
    expect(rateLimitScopeKey('6281111111', undefined))
      .toBe(rateLimitScopeKey('6281111111', null));
    expect(rateLimitScopeKey('6281111111', undefined)).toContain('__global__');
  });
});

describe('W8 village-scoped spam-guard keys', () => {
  it('same user in different villages → different keys (isolation)', () => {
    expect(spamGuardStateKey('desa-a', '6281111111')).not.toBe(spamGuardStateKey('desa-b', '6281111111'));
  });

  it('same user + same village → stable key', () => {
    expect(spamGuardStateKey('desa-a', '6281111111')).toBe(spamGuardStateKey('desa-a', '6281111111'));
  });

  it('missing village → deterministic fallback bucket (documented)', () => {
    expect(spamGuardStateKey(undefined, '6281111111')).toBe(spamGuardStateKey(undefined, '6281111111'));
    expect(spamGuardStateKey(undefined, '6281111111')).toContain('unknown');
  });
});
