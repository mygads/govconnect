/**
 * Test for P1-7: getDb() must not cache a null (DB unavailable) forever.
 *
 * A transient DB outage at startup used to degrade ALL persistence
 * (audit, idempotency, turn state, vault, outbox) permanently until
 * process restart. Now a cached null is re-probed after DB_REPROBE_MS
 * (default 45s).
 *
 * Observable via appendAudit(): false when the DB is down, true once a
 * re-probe succeeds.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const holder: { client: unknown } = { client: null };

vi.mock('../../lib/prisma', () => ({
  get default() {
    return holder.client;
  },
}));

import { appendAudit, resetDbCache, type AuditEvent } from '../pipeline-store';

const fakeDb = {
  queryRawCalls: 0,
  $queryRawUnsafe: vi.fn(async () => {
    fakeDb.queryRawCalls += 1;
    return [{ '?column?': 1 }];
  }),
  $executeRawUnsafe: vi.fn(async () => 1),
};

const event: AuditEvent = {
  tenantId: 'desa-1',
  traceId: 't1',
  userId: 'u1',
  channel: 'whatsapp',
  stage: 'TEST',
  event: 'probe',
};

const t0 = Date.now();
let nowSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetDbCache();
  holder.client = null;
  fakeDb.queryRawCalls = 0;
  fakeDb.$queryRawUnsafe.mockClear();
  fakeDb.$executeRawUnsafe.mockClear();
  nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);
});

afterEach(() => {
  nowSpy.mockRestore();
});

describe('P1-7: DB null-cache re-probe', () => {
  it('returns degraded (false) on first probe failure', async () => {
    expect(await appendAudit(event)).toBe(false);
    expect(fakeDb.queryRawCalls).toBe(0); // probe threw before SELECT 1
  });

  it('does NOT re-probe inside the re-probe window', async () => {
    expect(await appendAudit(event)).toBe(false); // initial failure, caches null
    holder.client = fakeDb; // DB comes back…
    nowSpy.mockReturnValue(t0 + 10_000); // …but only 10s later (< 45s window)
    expect(await appendAudit(event)).toBe(false); // still degraded
    expect(fakeDb.$queryRawUnsafe).not.toHaveBeenCalled(); // no re-probe attempted
  });

  it('re-probes and recovers after the window elapses', async () => {
    expect(await appendAudit(event)).toBe(false); // initial failure
    holder.client = fakeDb; // DB comes back
    nowSpy.mockReturnValue(t0 + 60_000); // 60s later (> 45s window)
    expect(await appendAudit(event)).toBe(true); // re-probe SELECT 1 + INSERT succeed
    expect(fakeDb.$queryRawUnsafe).toHaveBeenCalledTimes(1); // exactly one re-probe
    // Subsequent calls reuse the recovered connection without re-probing.
    expect(await appendAudit(event)).toBe(true);
    expect(fakeDb.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('re-probe failure keeps degraded mode without spamming probes', async () => {
    expect(await appendAudit(event)).toBe(false);
    nowSpy.mockReturnValue(t0 + 60_000); // window elapsed…
    holder.client = null; // …but DB is still down
    expect(await appendAudit(event)).toBe(false);
    nowSpy.mockReturnValue(t0 + 61_000); // 1s later: inside the NEW window
    expect(await appendAudit(event)).toBe(false); // no extra probe storm
  });
});
