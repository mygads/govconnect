/**
 * R4: skill loader — tenant isolation, active-only reads, fail-soft.
 * Prisma is mocked; no live DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prisma/client', () => ({ Prisma: {} }));

const testState = vi.hoisted(() => {
  const queryRawUnsafe = vi.fn();
  const executeRawUnsafe = vi.fn(async () => 1);
  return { queryRawUnsafe, executeRawUnsafe };
});

vi.mock('../../lib/prisma', () => ({
  default: {
    $queryRawUnsafe: testState.queryRawUnsafe,
    $executeRawUnsafe: testState.executeRawUnsafe,
  },
}));

import {
  getSkillIndex,
  loadSkill,
  createSkill,
  setSkillActive,
  renderSkillIndexForPrompt,
} from '../skill-loader.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getSkillIndex (L1)', () => {
  it('queries active skills scoped to the village', async () => {
    testState.queryRawUnsafe.mockResolvedValue([
      { slug: 'sktm', title: 'SKTM', description: 'Tata cara SKTM' },
    ]);
    const idx = await getSkillIndex('desa-1');
    expect(idx).toEqual([{ slug: 'sktm', title: 'SKTM', description: 'Tata cara SKTM' }]);
    const calls = testState.queryRawUnsafe.mock.calls as unknown as Array<[string, ...unknown[]]>;
    const [sql, villageId] = calls[0];
    expect(String(sql)).toContain('village_id = $1');
    expect(String(sql)).toContain('is_active = TRUE');
    expect(villageId).toBe('desa-1');
  });

  it('returns [] for empty village id without hitting the DB', async () => {
    expect(await getSkillIndex('')).toEqual([]);
    expect(testState.queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('fails soft on DB error', async () => {
    testState.queryRawUnsafe.mockRejectedValue(new Error('down'));
    expect(await getSkillIndex('desa-1')).toEqual([]);
  });
});

describe('loadSkill (L2)', () => {
  it('loads an active skill, village-scoped', async () => {
    testState.queryRawUnsafe.mockResolvedValue([
      { slug: 'sktm', title: 'SKTM', description: 'd', content_md: '# SKTM\n...', version: 2 },
    ]);
    const s = await loadSkill('desa-1', 'sktm');
    expect(s?.slug).toBe('sktm');
    expect(s?.contentMd).toContain('# SKTM');
    expect(s?.version).toBe(2);
    const calls = testState.queryRawUnsafe.mock.calls as unknown as Array<[string, ...unknown[]]>;
    const [sql, villageId, slug] = calls[0];
    expect(String(sql)).toContain('is_active = TRUE');
    expect(villageId).toBe('desa-1');
    expect(slug).toBe('sktm');
  });

  it('returns null when not found, on bad slug, or DB error', async () => {
    testState.queryRawUnsafe.mockResolvedValue([]);
    expect(await loadSkill('desa-1', 'missing')).toBeNull();
    expect(await loadSkill('desa-1', 'BAD SLUG!')).toBeNull();
    expect(await loadSkill('', 'sktm')).toBeNull();
    testState.queryRawUnsafe.mockRejectedValue(new Error('down'));
    expect(await loadSkill('desa-1', 'sktm')).toBeNull();
  });
});

describe('createSkill / setSkillActive — no auto-promote', () => {
  it('stores the skill INACTIVE', async () => {
    await createSkill({
      villageId: 'desa-1', slug: 'sktm', title: 'SKTM',
      description: 'd', body: '1. langkah',
    });
    const calls = testState.executeRawUnsafe.mock.calls as unknown as Array<[string, ...unknown[]]>;
    const [sql] = calls[0];
    expect(String(sql)).toContain('is_active');
    expect(String(sql)).toMatch(/FALSE/);
  });

  it('activation is an explicit separate step', async () => {
    testState.executeRawUnsafe.mockResolvedValue(1);
    expect(await setSkillActive('desa-1', 'sktm', true)).toBe(true);
    const calls = testState.executeRawUnsafe.mock.calls as unknown as Array<[string, ...unknown[]]>;
    const [, , slug, active] = calls[0];
    expect(slug).toBe('sktm');
    expect(active).toBe(true);
  });
});

describe('renderSkillIndexForPrompt', () => {
  it('returns null for an empty index', () => {
    expect(renderSkillIndexForPrompt([])).toBeNull();
  });

  it('renders compact slug lines with the load_skill hint', () => {
    const out = renderSkillIndexForPrompt([
      { slug: 'sktm', title: 'SKTM', description: 'Tata cara SKTM' },
    ]);
    expect(out).toContain('- sktm: Tata cara SKTM');
    expect(out).toContain('load_skill');
    // L1 only: no full procedure body in the index.
    expect(out).not.toContain('Fotokopi');
  });
});
