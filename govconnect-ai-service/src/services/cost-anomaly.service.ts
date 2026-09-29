/**
 * R9 / §10 — cost anomaly detection (was the single MISSING R9 sub-item).
 *
 * arsitektur-final §10: "anomali >3× baseline → alert/auto-pause".
 *
 * What is implemented here: ALERT. Auto-pause is intentionally NOT automatic:
 * pipeline/kill-switch.ts defines pausing as "an explicit human action", and
 * an automatic pause on a heuristic risks blocking citizens on false
 * positives. Every alert payload therefore carries `recommended_action`
 * telling the operator exactly what to do (enable VILLAGE_KILL_SWITCH for
 * the village).
 *
 * Detectors:
 *  1. turn_cost_spike — a single turn costs more than COST_ANOMALY_TURN_USD
 *     (default $0.05; doc target is ≤$0,004/turn, so this is ~12x headroom).
 *  2. daily_spend_spike — today's accrued spend > 3x the trailing 7-day
 *     average (with a floor so tiny baselines don't false-positive).
 *
 * Alerts are deduplicated: one open alert per (village, type) per day.
 * Alerts never throw and never debit anything.
 */
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';

const TURN_SPIKE_THRESHOLD_USD = Number(process.env.COST_ANOMALY_TURN_USD ?? 0.05);
const DAILY_SPIKE_RATIO = Number(process.env.COST_ANOMALY_DAILY_RATIO ?? 3);
const DAILY_BASELINE_FLOOR_USD = Number(process.env.COST_ANOMALY_BASELINE_FLOOR_USD ?? 0.01);

export type AnomalyAlertType = 'turn_cost_spike' | 'daily_spend_spike';
export type AnomalySeverity = 'warning' | 'critical';

export interface AnomalyDetails {
  threshold_usd?: number;
  observed_usd?: number;
  ratio?: number;
  baseline_avg7d_usd?: number;
  today_usd?: number;
  billing_group_id?: string;
  trace_id?: string;
  recommended_action: string;
  [key: string]: unknown;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function round8(n: number): number {
  return Number(n.toFixed(8));
}

/** Insert an alert unless one of the same type already exists for this village today. */
async function createAnomalyAlert(
  villageId: string,
  alertType: AnomalyAlertType,
  severity: AnomalySeverity,
  details: AnomalyDetails,
): Promise<boolean> {
  try {
    const todayStart = startOfDay(new Date());
    const existing = await prisma.ai_cost_anomaly_alerts.findFirst({
      where: { village_id: villageId, alert_type: alertType, created_at: { gte: todayStart } },
      select: { id: true },
    });
    if (existing) return false;

    await prisma.ai_cost_anomaly_alerts.create({
      data: {
        village_id: villageId,
        alert_type: alertType,
        severity,
        details_json: details as Prisma.InputJsonValue,
      },
    });
    logger.warn('[cost-anomaly] alert created', { villageId, alertType, severity, details });
    return true;
  } catch (error) {
    logger.warn('[cost-anomaly] failed to create alert', {
      villageId, alertType, error: (error as Error)?.message ?? String(error),
    });
    return false;
  }
}

const PAUSE_RECOMMENDATION =
  'Tinjau lonjakan biaya ini di dashboard AI Usage. Jika tidak wajar, ' +
  'hentikan sementara layanan desa tersebut via VILLAGE_KILL_SWITCH=<village_id> (tanpa restart).';

/**
 * Check a single finalized turn for abnormal cost. Pure threshold math is
 * exported for unit tests; this wrapper handles persistence.
 */
export function isTurnCostAnomalous(adjustedCostUsd: number, thresholdUsd = TURN_SPIKE_THRESHOLD_USD): boolean {
  return Number.isFinite(adjustedCostUsd) && adjustedCostUsd > thresholdUsd;
}

export async function checkTurnCostAnomaly(input: {
  villageId?: string | null;
  billingGroupId: string;
  traceId?: string | null;
  adjustedCostUsd: number;
}): Promise<void> {
  try {
    if (!input.villageId) return;
    if (!isTurnCostAnomalous(input.adjustedCostUsd)) return;
    await createAnomalyAlert(input.villageId, 'turn_cost_spike', 'warning', {
      threshold_usd: TURN_SPIKE_THRESHOLD_USD,
      observed_usd: round8(input.adjustedCostUsd),
      billing_group_id: input.billingGroupId,
      trace_id: input.traceId ?? undefined,
      recommended_action: PAUSE_RECOMMENDATION,
    });
  } catch (error) {
    logger.warn('[cost-anomaly] checkTurnCostAnomaly failed', {
      error: (error as Error)?.message ?? String(error),
    });
  }
}

/**
 * Pure comparison for the daily spike rule (unit-testable).
 * Returns the ratio today/avg7d, or null when the rule must not fire
 * (no baseline, or baseline below the noise floor).
 */
export function dailySpikeRatio(todayUsd: number, avg7dUsd: number, ratioThreshold = DAILY_SPIKE_RATIO): number | null {
  if (!Number.isFinite(todayUsd) || !Number.isFinite(avg7dUsd)) return null;
  if (avg7dUsd < DAILY_BASELINE_FLOOR_USD) return null;
  const ratio = todayUsd / avg7dUsd;
  return ratio > ratioThreshold ? ratio : null;
}

/**
 * Compare today's accrued spend against the trailing 7-day average.
 * Spend = ai_message_billings.adjusted_cost_usd (accrued, not only debited —
 * with per-resolution billing the wallet moves later, but the COST is real
 * the moment the turn runs).
 */
export async function checkDailySpendAnomaly(villageId: string): Promise<void> {
  try {
    if (!villageId) return;
    const now = new Date();
    const todayStart = startOfDay(now);
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [todayAgg, weekAgg] = await Promise.all([
      prisma.ai_message_billings.aggregate({
        where: { village_id: villageId, created_at: { gte: todayStart } },
        _sum: { adjusted_cost_usd: true },
      }),
      prisma.ai_message_billings.aggregate({
        where: { village_id: villageId, created_at: { gte: sevenDaysAgo, lt: todayStart } },
        _sum: { adjusted_cost_usd: true },
      }),
    ]);

    const todayUsd = todayAgg._sum.adjusted_cost_usd ?? 0;
    const avg7dUsd = (weekAgg._sum.adjusted_cost_usd ?? 0) / 7;
    const ratio = dailySpikeRatio(todayUsd, avg7dUsd);
    if (ratio === null) return;

    await createAnomalyAlert(villageId, 'daily_spend_spike', 'critical', {
      ratio: round8(ratio),
      threshold_ratio: DAILY_SPIKE_RATIO,
      today_usd: round8(todayUsd),
      baseline_avg7d_usd: round8(avg7dUsd),
      recommended_action: PAUSE_RECOMMENDATION,
    });
  } catch (error) {
    logger.warn('[cost-anomaly] checkDailySpendAnomaly failed', {
      villageId, error: (error as Error)?.message ?? String(error),
    });
  }
}

/** Ops read path: open (unacknowledged) alerts for a village. */
export async function listOpenAnomalyAlerts(villageId: string, limit = 50) {
  return prisma.ai_cost_anomaly_alerts.findMany({
    where: { village_id: villageId, acknowledged_at: null },
    orderBy: { created_at: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

export async function acknowledgeAnomalyAlert(alertId: string, acknowledgedBy?: string | null) {
  return prisma.ai_cost_anomaly_alerts.update({
    where: { id: alertId },
    data: { acknowledged_at: new Date(), acknowledged_by: acknowledgedBy ?? null },
  });
}
