/**
 * R16: doc reminders + broadcast opt-in tests (mocked DB — no Postgres).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../pipeline-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../pipeline-store')>();
  return { ...orig, getDb: vi.fn(), appendAudit: vi.fn(async () => true) };
});

import { getDb, appendAudit } from '../pipeline-store';
import {
  scheduleDocReminder, runDocReminderSweep,
  setBroadcastOptIn, isBroadcastOptedIn, sendBroadcast,
  DOC_REMINDER_COPY, DOC_REMINDER_DELAY_MS,
} from '../doc-reminders';

const mockGetDb = vi.mocked(getDb);
const mockAppendAudit = vi.mocked(appendAudit);

function fakeDb(overrides: Record<string, any> = {}): any {
  return {
    $queryRawUnsafe: vi.fn(async () => []),
    $executeRawUnsafe: vi.fn(async () => 1),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scheduleDocReminder', () => {
  it('inserts idempotently with H+3 schedule', async () => {
    const db = fakeDb();
    mockGetDb.mockResolvedValue(db as any);
    const now = new Date('2026-09-29T10:00:00Z');
    const ok = await scheduleDocReminder({
      villageId: 'v1', userId: 'u1', ticketRef: 'T-1', now,
    });
    expect(ok).toBe(true);
    const [sql, ...args] = mockExecArgs(db);
    expect(sql).toContain('ON CONFLICT (village_id, ticket_ref, reminder_type) DO NOTHING');
    const scheduledFor = new Date(args[7] as string);
    expect(scheduledFor.getTime() - now.getTime()).toBe(DOC_REMINDER_DELAY_MS);
  });

  it('copy mentions the ticket and 3 days', () => {
    const c = DOC_REMINDER_COPY('T-42');
    expect(c).toContain('T-42');
    expect(c).toContain('3 hari');
  });
});

function mockExecArgs(db: { $executeRawUnsafe: any }): any[] {
  return db.$executeRawUnsafe.mock.calls[0] as any[];
}

describe('runDocReminderSweep', () => {
  it('sends each due reminder once and marks it sent', async () => {
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [
        { id: 'r1', village_id: 'v1', user_id: 'u1', channel: 'whatsapp', ticket_ref: 'T-1' },
      ]),
    });
    mockGetDb.mockResolvedValue(db as any);
    const sender = vi.fn(async (..._args: any[]) => true);
    const r = await runDocReminderSweep({ sender });
    expect(r).toEqual({ due: 1, sent: 1, failed: 0 });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]![2]).toContain('T-1');
    // claim UPDATE runs before send
    const claimSql = db.$executeRawUnsafe.mock.calls[0][0] as string;
    expect(claimSql).toContain("status = 'pending'");
  });

  it('skips send when the claim race is lost (another sweep sent it)', async () => {
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [
        { id: 'r1', village_id: 'v1', user_id: 'u1', channel: 'whatsapp', ticket_ref: 'T-1' },
      ]),
      $executeRawUnsafe: vi.fn(async () => 0), // claim failed → already sent
    });
    mockGetDb.mockResolvedValue(db as any);
    const sender = vi.fn(async (..._args: any[]) => true);
    const r = await runDocReminderSweep({ sender });
    expect(r.sent).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });

  it('marks failed when the send fails', async () => {
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async () => [
        { id: 'r1', village_id: 'v1', user_id: 'u1', channel: 'whatsapp', ticket_ref: 'T-1' },
      ]),
    });
    mockGetDb.mockResolvedValue(db as any);
    const r = await runDocReminderSweep({ sender: async () => false });
    expect(r).toEqual({ due: 1, sent: 0, failed: 1 });
    const lastSql = db.$executeRawUnsafe.mock.calls.at(-1)[0] as string;
    expect(lastSql).toContain("'failed'");
  });
});

describe('broadcast opt-in', () => {
  it('defaults to opt-out (no row → false)', async () => {
    const db = fakeDb();
    mockGetDb.mockResolvedValue(db as any);
    expect(await isBroadcastOptedIn('v1', 'u1', 'whatsapp')).toBe(false);
  });

  it('setBroadcastOptIn upserts', async () => {
    const db = fakeDb();
    mockGetDb.mockResolvedValue(db as any);
    expect(await setBroadcastOptIn('v1', 'u1', 'whatsapp', true)).toBe(true);
    const [sql] = mockExecArgs(db);
    expect(sql).toContain('ON CONFLICT (village_id, user_id, channel)');
  });

  it('sendBroadcast only sends to opted-in users', async () => {
    const consent = new Map([['u1', true], ['u2', false]]);
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async (sql: string, ...args: any[]) => {
        const userId = args[1] as string;
        return consent.get(userId) ? [{ opt_in: true }] : [];
      }),
    });
    mockGetDb.mockResolvedValue(db as any);
    const sender = vi.fn(async (..._args: any[]) => true);
    const r = await sendBroadcast({
      villageId: 'v1', userIds: ['u1', 'u2', 'u3'], text: 'pengumuman', sentBy: 'admin',
      sender,
    });
    expect(r.requested).toBe(3);
    expect(r.optedIn).toBe(1);
    expect(r.sent).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]![1]).toBe('u1');
  });

  it('sendBroadcast audits every skip (no silent skips)', async () => {
    const consent = new Map([['u1', true], ['u2', false]]);
    const db = fakeDb({
      $queryRawUnsafe: vi.fn(async (sql: string, ...args: any[]) => {
        const userId = args[1] as string;
        return consent.get(userId) ? [{ opt_in: true }] : [];
      }),
    });
    mockGetDb.mockResolvedValue(db as any);
    const sender = vi.fn(async (..._args: any[]) => true);
    await sendBroadcast({
      villageId: 'v1', userIds: ['u1', 'u2', 'u3'], text: 'pengumuman', sentBy: 'admin',
      sender,
    });
    const skips = mockAppendAudit.mock.calls.filter(
      (c) => (c[0] as any).event === 'broadcast_skipped',
    );
    // u2 (opted out) and u3 (no row → opt-out) are both audited as skipped
    expect(skips).toHaveLength(2);
    expect(skips[0][0].payload).toMatchObject({ reason: 'no_consent' });
    const skippedUsers = skips.map((c) => (c[0] as any).userId).sort();
    expect(skippedUsers).toEqual(['u2', 'u3']);
  });
});
