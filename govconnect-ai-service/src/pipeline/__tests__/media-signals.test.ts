/**
 * A4: media fraud-signal review queue (mocked DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../pipeline-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../pipeline-store')>();
  return { ...orig, getDb: vi.fn(), dbDown: (_op: string, fallback: unknown) => fallback };
});

import { getDb } from '../pipeline-store';
import { listRecentMediaSignals } from '../media-signals';

const mockGetDb = vi.mocked(getDb);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listRecentMediaSignals', () => {
  it('returns parsed signal rows', async () => {
    const db = {
      $queryRawUnsafe: vi.fn(async () => ([
        {
          occurred_at: new Date('2026-09-29T10:00:00Z'),
          user_id: 'u1', trace_id: 't1',
          payload: { fraud_signals: ['duplicate_image'], sha256: 'abc123', duplicate: true },
        },
        {
          occurred_at: '2026-09-29T11:00:00Z',
          user_id: 'u2', trace_id: 't2',
          payload: { fraud_signals: ['low_resolution'], sha256: null },
        },
      ])),
    };
    mockGetDb.mockResolvedValue(db as any);
    const rows = await listRecentMediaSignals('v1', 50);
    expect(rows).toHaveLength(2);
    expect(rows[0].fraud_signals).toEqual(['duplicate_image']);
    expect(rows[0].sha256).toBe('abc123');
    expect(rows[0].duplicate).toBe(true);
    expect(rows[1].occurred_at).toBe('2026-09-29T11:00:00Z');
    const [sql, villageId, limit] = db.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("event = 'media_signal'");
    expect(sql).toContain('tenant_id = $1');
    expect(villageId).toBe('v1');
    expect(limit).toBe(50);
  });

  it('clamps limit to 1..100', async () => {
    const db = { $queryRawUnsafe: vi.fn(async () => []) };
    mockGetDb.mockResolvedValue(db as any);
    await listRecentMediaSignals('v1', 9999);
    expect(db.$queryRawUnsafe.mock.calls[0][2]).toBe(100);
  });

  it('fail-soft when DB is down', async () => {
    mockGetDb.mockResolvedValue(null);
    await expect(listRecentMediaSignals('v1')).resolves.toEqual([]);
  });

  it('fail-soft when the table is missing', async () => {
    const db = { $queryRawUnsafe: vi.fn(async () => { throw new Error('no table'); }) };
    mockGetDb.mockResolvedValue(db as any);
    await expect(listRecentMediaSignals('v1')).resolves.toEqual([]);
  });
});
