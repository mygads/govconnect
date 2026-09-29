/**
 * R9: cost per turn — finalizeAiBillingTurn must mirror the finalized turn
 * cost into the pipeline audit trail as 'turn_cost_recorded'.
 *
 * Prisma + pipeline-store + wallet are mocked; no live DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prisma/client', () => ({ Prisma: {} }));

const testState = vi.hoisted(() => {
  const auditCalls: Array<Record<string, unknown>> = [];
  const prismaMock = {
    ai_message_billings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    ai_token_usage: {
      findMany: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return { auditCalls, prismaMock };
});
const { auditCalls, prismaMock } = testState;

vi.mock('../../pipeline/pipeline-store', () => ({
  appendAudit: vi.fn(async (e: Record<string, unknown>) => {
    testState.auditCalls.push(e);
    return true;
  }),
}));

vi.mock('../../lib/prisma', () => ({ default: testState.prismaMock }));

vi.mock('../ai-wallet.service', () => ({
  debitVillageWalletForMessageBilling: vi.fn(async () => ({
    ledgerEntry: { id: 'le_1' },
  })),
  InsufficientAIWalletBalanceError: class extends Error {},
}));

import { finalizeAiBillingTurn } from '../ai-turn-billing.service';
import { appendAudit } from '../../pipeline/pipeline-store';

const usageRows = [
  {
    id: 'u1', input_tokens: 100, output_tokens: 50, total_tokens: 150,
    actual_cost_usd: 0.001, adjusted_cost_usd: 0.002,
  },
];

function baseContext(villageId: string | null) {
  return {
    village_id: villageId,
    message_id: 'm1',
    trace_id: 'trace_cost_1',
    billing_group_id: 'msg:desa-1:m1',
    batched_message_ids: [] as string[],
    wa_user_id: 'user1',
    session_id: null,
    channel: 'whatsapp',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auditCalls.length = 0;
  prismaMock.ai_message_billings.findUnique.mockResolvedValue(null);
  prismaMock.ai_token_usage.findMany.mockResolvedValue(usageRows);
  prismaMock.ai_message_billings.upsert.mockImplementation(async (args: { create: unknown }) => ({
    id: 'b1', ...(args.create as object),
  }));
  prismaMock.ai_message_billings.update.mockImplementation(async (args: { data: unknown }) => ({
    id: 'b1', ...(args.data as object),
  }));
});

describe('turn_cost_recorded audit', () => {
  it('emits the event with correct totals on the billed path', async () => {
    await finalizeAiBillingTurn(baseContext('desa-1'));

    expect(appendAudit).toHaveBeenCalledTimes(1);
    const e = auditCalls[0] as {
      tenantId: string; traceId: string; event: string;
      payload: Record<string, unknown>;
    };
    expect(e.event).toBe('turn_cost_recorded');
    expect(e.tenantId).toBe('desa-1');
    expect(e.traceId).toBe('trace_cost_1');
    expect(e.payload.input_tokens).toBe(100);
    expect(e.payload.output_tokens).toBe(50);
    expect(e.payload.total_tokens).toBe(150);
    expect(e.payload.call_count).toBe(1);
    expect(e.payload.actual_cost_usd).toBeCloseTo(0.001, 8);
    expect(e.payload.adjusted_cost_usd).toBeCloseTo(0.002, 8);
    expect(e.payload.margin_usd).toBeCloseTo(0.001, 8);
    expect(e.payload.billing_status).toBe('billed');
    expect(e.payload.billing_group_id).toBe('msg:desa-1:m1');
  });

  it('emits the event on the skipped_no_village path too', async () => {
    await finalizeAiBillingTurn(baseContext(null));

    expect(appendAudit).toHaveBeenCalledTimes(1);
    const e = auditCalls[0] as { event: string; payload: Record<string, unknown> };
    expect(e.event).toBe('turn_cost_recorded');
    expect(e.payload.billing_status).toBe('skipped_no_village');
    expect(e.payload.total_tokens).toBe(150);
  });

  it('does not emit when there are no usage rows', async () => {
    prismaMock.ai_token_usage.findMany.mockResolvedValue([]);
    await finalizeAiBillingTurn(baseContext('desa-1'));
    expect(appendAudit).not.toHaveBeenCalled();
  });
});
