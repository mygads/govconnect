/**
 * §10 billing model: debit happens once per VERIFIED RESOLUTION, never per
 * message/turn. Prisma + pipeline-store + wallet are mocked; no live DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prisma/client', () => ({ Prisma: { JsonNull: null } }));

const testState = vi.hoisted(() => {
  const auditCalls: Array<Record<string, unknown>> = [];
  const prismaMock = {
    ai_resolutions: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    ai_message_billings: {
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

const { debitMock, InsufficientBalance } = vi.hoisted(() => {
  const debitMock = vi.fn();
  class InsufficientBalance extends Error {}
  return { debitMock, InsufficientBalance };
});
vi.mock('../ai-wallet.service', () => ({
  debitVillageWalletForResolution: (...args: unknown[]) => debitMock(...args),
  InsufficientAIWalletBalanceError: InsufficientBalance,
}));

import { recordResolution, retryResolutionBilling, RESOLUTION_TYPES } from '../ai-resolution-billing.service';
import { InsufficientAIWalletBalanceError } from '../ai-wallet.service';

const accruedTurns = [
  { id: 'mb1', actual_cost_usd: 0.002, adjusted_cost_usd: 0.003, margin_usd: 0.001 },
  { id: 'mb2', actual_cost_usd: 0.001, adjusted_cost_usd: 0.002, margin_usd: 0.001 },
];

function baseInput() {
  return {
    villageId: 'desa-1',
    waUserId: 'user1',
    sessionId: null as string | null,
    channel: 'whatsapp' as const,
    traceId: 'trace_r1',
    resolutionType: 'complaint_created' as const,
    evidenceRef: 'LAP-2026-001',
    billingGroupIds: ['bg1'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auditCalls.length = 0;
  debitMock.mockReset();
  debitMock.mockImplementation(async () => ({ ledgerEntry: { id: 'le_res1' } }));
  prismaMock.ai_resolutions.findUnique.mockResolvedValue(null);
  prismaMock.ai_message_billings.findMany.mockResolvedValue(accruedTurns);
  let createdRow: Record<string, unknown> = {};
  prismaMock.ai_resolutions.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    createdRow = { id: 'res1', ...args.data };
    return createdRow;
  });
  // Realistic: update returns the full row (created data merged with updates).
  prismaMock.ai_resolutions.update.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    createdRow = { ...createdRow, ...args.data };
    return createdRow;
  });
});

describe('recordResolution', () => {
  it('debits the wallet exactly once with the summed accrued turn cost', async () => {
    const result = await recordResolution(baseInput());

    expect(result.ok).toBe(true);
    expect(debitMock).toHaveBeenCalledTimes(1);
    const call = debitMock.mock.calls[0][0];
    expect(call.villageId).toBe('desa-1');
    expect(call.resolutionId).toBe('res1');
    expect(call.adjustedCostUsd).toBeCloseTo(0.005, 8);
    expect(call.actualCostUsd).toBeCloseTo(0.003, 8);
    expect(call.marginUsd).toBeCloseTo(0.002, 8);
    expect(call.metadata.resolution_key).toContain('complaint_created');
  });

  it('marks contributing turns as resolved and records a resolution_billed audit', async () => {
    await recordResolution(baseInput());

    expect(prismaMock.ai_message_billings.updateMany).toHaveBeenCalledWith(
      { where: { id: { in: ['mb1', 'mb2'] }, status: 'accrued' }, data: { status: 'resolved' } },
    );
    const events = auditCalls.map((e) => e.event);
    expect(events).toContain('resolution_billed');
  });

  it('is idempotent: the same (village, evidence) is never billed twice', async () => {
    await recordResolution(baseInput());
    // Second attempt with the same evidence ref -> same resolution key.
    prismaMock.ai_resolutions.findUnique.mockResolvedValue({
      id: 'res1', status: 'billed', resolution_key: 'complaint_created:LAP-2026-001',
    });
    const second = await recordResolution(baseInput());

    expect(second.ok).toBe(true);
    expect(debitMock).toHaveBeenCalledTimes(1);
  });

  it('does not debit when the resolution has zero accrued cost', async () => {
    prismaMock.ai_message_billings.findMany.mockResolvedValue([]);
    const result = await recordResolution({ ...baseInput(), billingGroupIds: ['bg-empty'] });

    expect(result.ok).toBe(true);
    expect(debitMock).not.toHaveBeenCalled();
    expect(prismaMock.ai_resolutions.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'billed' }),
      }),
    );
  });

  it('skips billing when there is no village, without debiting', async () => {
    const result = await recordResolution({ ...baseInput(), villageId: null });

    expect(result.ok).toBe(true);
    expect(debitMock).not.toHaveBeenCalled();
    const createArgs = prismaMock.ai_resolutions.create.mock.calls[0][0];
    expect(createArgs.data.status).toBe('skipped_no_village');
  });

  it('stores a failed status and never throws when the debit fails', async () => {
    debitMock.mockRejectedValueOnce(new InsufficientBalance('insufficient balance'));
    const result = await recordResolution(baseInput());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('insufficient balance');
    const updateArgs = prismaMock.ai_resolutions.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe('failed_insufficient_balance');
    // Accrued turns stay accrued so a retry can still bill them.
    expect(prismaMock.ai_message_billings.updateMany).not.toHaveBeenCalled();
  });

  it('accepts all documented resolution types', () => {
    expect(RESOLUTION_TYPES).toEqual(expect.arrayContaining([
      'complaint_created', 'service_request_created', 'info_answered',
      'status_delivered', 'handoff_completed', 'other',
    ]));
    // The mocked wallet module re-exports the same error class used above.
    expect(InsufficientAIWalletBalanceError).toBe(InsufficientBalance);
  });
});

describe('retryResolutionBilling', () => {
  it('retries the debit on the SAME resolution row (same idempotency key)', async () => {
    prismaMock.ai_resolutions.findUnique.mockResolvedValue({
      id: 'res1',
      village_id: 'desa-1',
      resolution_type: 'complaint_created',
      resolution_key: 'complaint_created:LAP-2026-001',
      trace_id: 'trace_r1',
      wa_user_id: 'user1',
      session_id: null,
      channel: 'whatsapp',
      billing_group_ids: ['bg1'],
      total_actual_cost_usd: 0.003,
      total_adjusted_cost_usd: 0.005,
      total_margin_usd: 0.002,
      status: 'failed_insufficient_balance',
    });
    debitMock.mockImplementationOnce(async () => ({ ledgerEntry: { id: 'le_res1_retry' } }));

    const result = await retryResolutionBilling('res1');

    expect(result.ok).toBe(true);
    expect(debitMock).toHaveBeenCalledTimes(1);
    const call = debitMock.mock.calls[0][0];
    expect(call.resolutionId).toBe('res1');
    // Reuses the recorded totals even when the accrued rows were already consumed.
    expect(call.adjustedCostUsd).toBeCloseTo(0.005, 8);
    const updateArgs = prismaMock.ai_resolutions.update.mock.calls[0][0];
    expect(updateArgs.where.id).toBe('res1');
    expect(updateArgs.data.status).toBe('billed');
    expect(updateArgs.data.ledger_entry_id).toBe('le_res1_retry');
  });

  it('no-ops on already billed resolutions', async () => {
    prismaMock.ai_resolutions.findUnique.mockResolvedValue({ id: 'res1', status: 'billed' });
    const result = await retryResolutionBilling('res1');
    expect(result.ok).toBe(true);
    expect(debitMock).not.toHaveBeenCalled();
  });

  it('returns not-found for unknown resolution ids', async () => {
    prismaMock.ai_resolutions.findUnique.mockResolvedValue(null);
    const result = await retryResolutionBilling('missing');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('resolution not found');
  });
});
