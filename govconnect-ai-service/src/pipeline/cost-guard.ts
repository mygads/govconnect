/**
 * Cost guard — per-tenant daily budget enforcement.
 *
 * Design (arsitektur-final §10):
 * - Reads actual spend from ai_token_usage.cost_usd (last 24h, per tenant).
 * - Budget from PIPELINE_DAILY_BUDGET_USD (default $5/tenant/day).
 * - When exceeded: the pipeline short-circuits to a deterministic,
 *   never-silent "budget exhausted" response — no LLM calls at all.
 * - Per-turn cost is ALSO bounded structurally: bounded loop (max 3 LLM
 *   iterations), micro-LLM for classification, semantic cache for repeats.
 */

import { getDailyCostUsd } from './pipeline-store';
import logger from '../utils/logger';

const DAILY_BUDGET_USD = Number(process.env.PIPELINE_DAILY_BUDGET_USD ?? 5);

export interface BudgetCheck {
  allowed: boolean;
  spentUsd: number | null;
  budgetUsd: number;
}

/** Check whether this tenant may still spend on LLM calls today. */
export async function checkBudget(tenantId: string): Promise<BudgetCheck> {
  if (!tenantId) return { allowed: true, spentUsd: null, budgetUsd: DAILY_BUDGET_USD };
  const spent = await getDailyCostUsd(tenantId).catch(() => null);
  if (spent === null) {
    // Cost data unavailable → allow (fail-open for availability, but log).
    // Rationale: blocking all traffic on a metrics outage is worse;
    // the per-turn structural bounds still apply.
    logger.debug('[cost-guard] cost data unavailable, allowing (fail-open)');
    return { allowed: true, spentUsd: null, budgetUsd: DAILY_BUDGET_USD };
  }
  const allowed = spent < DAILY_BUDGET_USD;
  if (!allowed) {
    logger.warn('[cost-guard] daily budget exceeded', { tenantId, spentUsd: spent });
  }
  return { allowed, spentUsd: spent, budgetUsd: DAILY_BUDGET_USD };
}
