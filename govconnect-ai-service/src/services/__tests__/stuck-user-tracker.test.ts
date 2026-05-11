import { beforeEach, describe, expect, it } from 'vitest';

import {
  recordUnhelpful,
  recordHelpful,
  isStuck,
  getStuckCount,
  buildStuckEscalationSuffix,
} from '../stuck-user-tracker.service';

const USER = 'stuck-user-1';

describe('stuck-user-tracker', () => {
  beforeEach(() => {
    // Private-ish: reset by recording helpful which deletes the entry.
    recordHelpful(USER);
    recordHelpful(USER, 'village-1');
    recordHelpful(USER, 'village-2');
  });

  it('starts not stuck', () => {
    expect(isStuck(USER)).toBe(false);
    expect(getStuckCount(USER)).toBe(0);
  });

  it('increments on each unhelpful reason', () => {
    expect(recordUnhelpful(USER, 'fallback_error')).toBe(1);
    expect(recordUnhelpful(USER, 'tool_error')).toBe(2);
    expect(isStuck(USER)).toBe(false);
    expect(recordUnhelpful(USER, 'retrieval_empty')).toBe(3);
    expect(isStuck(USER)).toBe(true);
  });

  it('resets on helpful outcome', () => {
    recordUnhelpful(USER, 'fallback_error');
    recordUnhelpful(USER, 'fallback_error');
    recordUnhelpful(USER, 'fallback_error');
    expect(isStuck(USER)).toBe(true);

    recordHelpful(USER);
    expect(isStuck(USER)).toBe(false);
    expect(getStuckCount(USER)).toBe(0);
  });

  it('keeps village scope separate', () => {
    recordUnhelpful(USER, 'fallback_error', 'village-1');
    recordUnhelpful(USER, 'fallback_error', 'village-1');
    recordUnhelpful(USER, 'fallback_error', 'village-1');
    expect(isStuck(USER, 'village-1')).toBe(true);
    expect(isStuck(USER, 'village-2')).toBe(false);
  });

  it('produces escalation suffix with human takeover hint', () => {
    const suffix = buildStuckEscalationSuffix();
    expect(suffix).toMatch(/petugas/i);
  });

  it('no-ops for empty userId', () => {
    expect(recordUnhelpful('', 'fallback_error')).toBe(0);
    expect(isStuck('')).toBe(false);
  });
});
