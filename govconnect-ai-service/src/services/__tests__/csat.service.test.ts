/**
 * R12 — CSAT tests.
 *
 * - Feature flag: disabled → trigger/answer are no-ops.
 * - answerCsatSurvey: lone 1-5 digit + pending survey → consumed;
 *   anything else → not consumed (survey stays pending, normal flow);
 *   rating ≤2 → follow-up ticket filed (closed loop); DB error → fail-open.
 * - triggerCsatSurvey: dedupe on pending survey; send failure → 'failed'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  default: { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn() },
}));
vi.mock('../../pipeline/pipeline-store', () => ({
  appendAudit: vi.fn(async () => true),
}));

import {
  isCsatEnabled,
  triggerCsatSurvey,
  answerCsatSurvey,
  CSAT_QUESTION,
  CSAT_THANKS,
  CSAT_THANKS_LOW,
} from '../csat.service';
import prisma from '../../lib/prisma';

const mockQuery = vi.mocked(prisma.$queryRawUnsafe);
const mockExec = vi.mocked(prisma.$executeRawUnsafe);

const OLD_ENV = process.env.CSAT_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CSAT_ENABLED = 'true';
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true } as Response)));
});

afterEach(() => {
  process.env.CSAT_ENABLED = OLD_ENV;
  vi.unstubAllGlobals();
});

describe('isCsatEnabled', () => {
  it('is off by default', () => {
    delete process.env.CSAT_ENABLED;
    expect(isCsatEnabled()).toBe(false);
  });

  it('is on when CSAT_ENABLED=true', () => {
    process.env.CSAT_ENABLED = 'true';
    expect(isCsatEnabled()).toBe(true);
  });
});

describe('triggerCsatSurvey', () => {
  it('is a no-op when the flag is off', async () => {
    delete process.env.CSAT_ENABLED;
    const r = await triggerCsatSurvey({ villageId: 'v1', userId: 'u1', channel: 'whatsapp', complaintId: 'C1' });
    expect(r).toEqual({ sent: false, reason: 'disabled' });
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('only supports whatsapp in v1', async () => {
    const r = await triggerCsatSurvey({ villageId: 'v1', userId: 'u1', channel: 'webchat', complaintId: 'C1' });
    expect(r.reason).toBe('whatsapp_only_v1');
  });

  it('accepts the notification-service channel casing (WHATSAPP)', async () => {
    const r = await triggerCsatSurvey({ villageId: 'v1', userId: 'u1', channel: 'WHATSAPP', complaintId: 'C1' });
    expect(r.sent).toBe(true);
  });

  it('inserts the survey and sends the question', async () => {
    const r = await triggerCsatSurvey({ villageId: 'v1', userId: 'u1', channel: 'whatsapp', complaintId: 'C1' });
    expect(r.sent).toBe(true);
    expect(mockExec).toHaveBeenCalledTimes(1);
    const [sql] = mockExec.mock.calls[0];
    expect(sql).toContain('INSERT INTO ai.csat_surveys');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, opts] = (fetch as any).mock.calls[0];
    const body = JSON.parse((opts as any).body);
    expect(body.wa_user_id).toBe('u1');
    expect(body.message).toBe(CSAT_QUESTION('C1'));
  });

  it('dedupes: a pending survey for the same complaint is not re-sent', async () => {
    mockExec.mockRejectedValueOnce(new Error('duplicate key value violates "csat_surveys_pending_uq"'));
    const r = await triggerCsatSurvey({ villageId: 'v1', userId: 'u1', channel: 'whatsapp', complaintId: 'C1' });
    expect(r).toEqual({ sent: false, reason: 'already_pending' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks the survey failed when the send fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false } as Response)));
    const r = await triggerCsatSurvey({ villageId: 'v1', userId: 'u1', channel: 'whatsapp', complaintId: 'C1' });
    expect(r).toEqual({ sent: false, reason: 'send_failed' });
    expect(mockExec.mock.calls[1][0]).toContain("SET status = 'failed'");
  });
});

describe('answerCsatSurvey', () => {
  function pendingSurvey(complaintId = 'C1') {
    mockQuery.mockResolvedValue([{ id: 's1', complaint_id: complaintId }]);
  }

  it('is a no-op when the flag is off', async () => {
    delete process.env.CSAT_ENABLED;
    const r = await answerCsatSurvey({ villageId: 'v1', userId: 'u1', message: '5', traceId: 't1' });
    expect(r.consumed).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('consumes a lone 1-5 digit when a survey is pending', async () => {
    pendingSurvey();
    const r = await answerCsatSurvey({ villageId: 'v1', userId: 'u1', message: ' 4 ', traceId: 't1' });
    expect(r.consumed).toBe(true);
    expect(r.rating).toBe(4);
    expect(r.response).toBe(CSAT_THANKS);
    // Survey marked answered with the rating…
    const update = mockExec.mock.calls.find((c: unknown[]) => String(c[0]).includes('SET status = \'answered\''));
    expect(update?.[1]).toBe(4);
    // …and NO follow-up ticket for a good rating.
    expect(mockExec.mock.calls.some((c: unknown[]) => String(c[0]).includes('pipeline_fallback_tickets'))).toBe(false);
  });

  it('files a follow-up ticket for rating <= 2 (closed loop)', async () => {
    pendingSurvey('C9');
    const r = await answerCsatSurvey({ villageId: 'v1', userId: 'u1', message: '2', traceId: 't1' });
    expect(r.consumed).toBe(true);
    expect(r.rating).toBe(2);
    expect(r.response).toBe(CSAT_THANKS_LOW);
    const ticket = mockExec.mock.calls.find((c: unknown[]) => String(c[0]).includes('pipeline_fallback_tickets'));
    expect(ticket).toBeDefined();
    // calls: [sql, ticketId, villageId, userId, detail]
    expect(String(ticket?.[4])).toContain('CSAT rating 2/5');
    expect(String(ticket?.[4])).toContain('C9');
  });

  it('does NOT consume non-digit messages (survey stays pending, normal flow)', async () => {
    pendingSurvey();
    for (const msg of ['ok terima kasih', '45', 'lima', '']) {
      mockQuery.mockClear();
      const r = await answerCsatSurvey({ villageId: 'v1', userId: 'u1', message: msg, traceId: 't1' });
      expect(r.consumed).toBe(false);
    }
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('does NOT consume when no survey is pending', async () => {
    mockQuery.mockResolvedValue([]);
    const r = await answerCsatSurvey({ villageId: 'v1', userId: 'u1', message: '5', traceId: 't1' });
    expect(r.consumed).toBe(false);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('fail-open on DB error: the message flows through the normal pipeline', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const r = await answerCsatSurvey({ villageId: 'v1', userId: 'u1', message: '5', traceId: 't1' });
    expect(r.consumed).toBe(false);
  });

  it('rejects out-of-range digits', async () => {
    pendingSurvey();
    for (const msg of ['0', '6', '10']) {
      const r = await answerCsatSurvey({ villageId: 'v1', userId: 'u1', message: msg, traceId: 't1' });
      expect(r.consumed).toBe(false);
    }
  });
});
