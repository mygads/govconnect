/**
 * R9: VILLAGE_KILL_SWITCH — unit tests (pure, no DB).
 */
import { describe, it, expect } from 'vitest';
import {
  getKilledVillages,
  isVillageKilled,
  KILL_SWITCH_REPLY,
} from '../kill-switch';

const envWith = (v: string | undefined) =>
  ({ VILLAGE_KILL_SWITCH: v }) as NodeJS.ProcessEnv;

describe('getKilledVillages', () => {
  it('returns empty set when the var is missing or blank', () => {
    expect(getKilledVillages({} as NodeJS.ProcessEnv).size).toBe(0);
    expect(getKilledVillages(envWith('')).size).toBe(0);
    expect(getKilledVillages(envWith('   ')).size).toBe(0);
  });

  it('parses comma-separated ids, trimming whitespace', () => {
    const s = getKilledVillages(envWith('desa-1, desa-2 ,desa-3'));
    expect(s).toEqual(new Set(['desa-1', 'desa-2', 'desa-3']));
  });

  it('dedupes and drops empty entries', () => {
    const s = getKilledVillages(envWith('desa-1,,desa-1,'));
    expect(s).toEqual(new Set(['desa-1']));
  });
});

describe('isVillageKilled', () => {
  it('matches exactly, not by substring', () => {
    const env = envWith('desa-1');
    expect(isVillageKilled('desa-1', env)).toBe(true);
    expect(isVillageKilled('desa-10', env)).toBe(false);
    expect(isVillageKilled('desa', env)).toBe(false);
  });

  it('returns false for empty village id', () => {
    expect(isVillageKilled('', envWith('desa-1'))).toBe(false);
  });

  it('returns false when nobody is killed', () => {
    expect(isVillageKilled('desa-1', envWith(''))).toBe(false);
  });
});

describe('KILL_SWITCH_REPLY', () => {
  it('is a static non-empty maintenance message', () => {
    expect(KILL_SWITCH_REPLY.trim().length).toBeGreaterThan(0);
    expect(KILL_SWITCH_REPLY).toMatch(/pemeliharaan/i);
  });
});
