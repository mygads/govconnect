/**
 * R9: cost anomaly detection — alert-only (>3x baseline -> alert, never
 * auto-pause). Prisma mocked; no live DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prisma/client', () => ({ Prisma: {} }));

const testState = vi.hoisted(() => {
  const prismaMock = {
    ai_cost_anomaly_alerts: {
      findFirst: vi.fn(),
      create: vi.fn(async (args: { data: unknown }) => ({ id: 'alert1', ...(args.data as object) })),
    },
    ai_message_billings: {
      aggregate: vi.fn(),
    },
  };
  return { prismaMock };
});
const { prismaMock } = testState;

vi.mock('../../lib/prisma', () => ({ default: testState.prismaMock }));

import {
  isTurnCostAnomalous,
  dailySpikeRatio,
  checkTurnCostAnomaly,
  checkDailySpendAnomaly,
} from '../cost-anomaly.service';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.ai_cost_anomaly_alerts.findFirst.mockResolvedValue(null);
});

describe('isTurnCostAnomalous (pure)', () => {
  it('fires above the threshold, not at or below', () => {
    expect(isTurnCostAnomalous(0.06)).toBe(true);
    expect(isTurnCostAnomalous(0.05)).toBe(false);
    expect(isTurnCostAnomalous(0.004)).toBe(false);
  });

  it('never fires on non-finite values', () => {
    expect(isTurnCostAnomalous(NaN)).toBe(false);
    expect(isTurnCostAnomalous(Infinity)).toBe(false);
  });
});

describe('dailySpikeRatio (pure)', () => {
  it('returns the ratio when today exceeds 3x the 7-day average', () => {
    expect(dailySpikeRatio(0.35, 0.1)).toBeCloseTo(3.5, 8);
  });

  it('returns null at/below the threshold', () => {
    expect(dailySpikeRatio(0.3, 0.1)).toBeNull();
    expect(dailySpikeRatio(0.1, 0.1)).toBeNull();
  });

  it('returns null when there is no usable baseline (no false positives)', () => {
    expect(dailySpikeRatio(1.0, 0)).toBeNull();
    expect(dailySpikeRatio(1.0, 0.001)).toBeNull(); // below the noise floor
  });
});

describe('checkTurnCostAnomaly', () => {
  it('creates an alert for an abnormal turn and dedupes within the day', async () => {
    await checkTurnCostAnomaly({
      villageId: 'desa-1', billingGroupId: 'bg1', traceId: 't1', adjustedCostUsd: 0.06,
    });
    expect(prismaMock.ai_cost_anomaly_alerts.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.ai_cost_anomaly_alerts.create.mock.calls[0][0].data as Record<string, any>;
    expect(data.village_id).toBe('desa-1');
    expect(data.alert_type).toBe('turn_cost_spike');
    expect(data.severity).toBe('warning');
    // Alert-only: tells the operator what to do, never pauses automatically.
    expect(data.details_json.recommended_action).toContain('VILLAGE_KILL_SWITCH');

    // Second spike the same day -> deduped, no new alert row.
    prismaMock.ai_cost_anomaly_alerts.findFirst.mockResolvedValue({ id: 'alert1' });
    await checkTurnCostAnomaly({
      villageId: 'desa-1', billingGroupId: 'bg2', traceId: 't2', adjustedCostUsd: 0.07,
    });
    expect(prismaMock.ai_cost_anomaly_alerts.create).toHaveBeenCalledTimes(1);
  });

  it('does not alert for normal turns or missing village', async () => {
    await checkTurnCostAnomaly({
      villageId: 'desa-1', billingGroupId: 'bg1', traceId: 't1', adjustedCostUsd: 0.004,
    });
    await checkTurnCostAnomaly({
      villageId: null, billingGroupId: 'bg1', traceId: 't1', adjustedCostUsd: 0.99,
    });
    expect(prismaMock.ai_cost_anomaly_alerts.create).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    prismaMock.ai_cost_anomaly_alerts.findFirst.mockRejectedValue(new Error('db down'));
    await expect(checkTurnCostAnomaly({
      villageId: 'desa-1', billingGroupId: 'bg1', traceId: 't1', adjustedCostUsd: 0.06,
    })).resolves.toBeUndefined();
  });
});

describe('checkDailySpendAnomaly', () => {
  it('creates a critical alert when today exceeds 3x the trailing average', async () => {
    prismaMock.ai_message_billings.aggregate
      .mockResolvedValueOnce({ _sum: { adjusted_cost_usd: 0.35 } }) // today
      .mockResolvedValueOnce({ _sum: { adjusted_cost_usd: 0.7 } }); // 7-day total -> avg 0.1
    await checkDailySpendAnomaly('desa-1');

    expect(prismaMock.ai_cost_anomaly_alerts.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.ai_cost_anomaly_alerts.create.mock.calls[0][0].data as Record<string, any>;
    expect(data.alert_type).toBe('daily_spend_spike');
    expect(data.severity).toBe('critical');
    expect(data.details_json.ratio).toBeCloseTo(3.5, 6);
    expect(data.details_json.recommended_action).toContain('VILLAGE_KILL_SWITCH');
  });

  it('stays silent when there is no baseline yet', async () => {
    prismaMock.ai_message_billings.aggregate
      .mockResolvedValueOnce({ _sum: { adjusted_cost_usd: 0.35 } })
      .mockResolvedValueOnce({ _sum: { adjusted_cost_usd: 0 } });
    await checkDailySpendAnomaly('desa-1');
    expect(prismaMock.ai_cost_anomaly_alerts.create).not.toHaveBeenCalled();
  });

  it('never throws on DB errors', async () => {
    prismaMock.ai_message_billings.aggregate.mockRejectedValue(new Error('db down'));
    await expect(checkDailySpendAnomaly('desa-1')).resolves.toBeUndefined();
  });
});
