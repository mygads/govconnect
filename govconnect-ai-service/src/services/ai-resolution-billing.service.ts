/**
 * R9 / §10 — per-resolution billing.
 *
 * arsitektur-final §10: "Wallet: tagih per resolusi terverifikasi — selaras
 * insentif." §12: Resolution (masalah benar-benar selesai) = metrik utama,
 * dengan hierarki evidence deterministik (DB outcome, tool traces, ticket
 * refs) — bukan klaim LLM.
 *
 * Flow:
 *   1. Turn finalization (ai-turn-billing) only ACCRUES cost
 *      (ai_message_billings.status = 'accrued'). No wallet movement.
 *   2. When a turn (or turn sequence) reaches a verified resolution, the
 *      pipeline calls recordResolution() with deterministic evidence.
 *   3. recordResolution() sums the accrued cost of the contributing turns
 *      and debits the village wallet ONCE (reference_type 'ai_resolution').
 *   4. Turns that never resolve are never debited — the vendor absorbs that
 *      cost. That is the §10 incentive alignment, not a bug.
 *
 * Idempotency: (village_id, resolution_key) is unique; the ledger debit is
 * additionally guarded by the existing usage_debit reference check in
 * debitVillageWalletForUsage.
 *
 * This module never throws: billing must not break message processing.
 * Failures are captured in the resolution row status.
 */
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { debitVillageWalletForResolution, InsufficientAIWalletBalanceError } from './ai-wallet.service';
import { appendAudit } from '../pipeline/pipeline-store';

export const RESOLUTION_TYPES = [
  'complaint_created',       // tool create_complaint SUCCEEDED + ticket ref (LAP-/TMP-)
  'service_request_created', // tool create_service_request SUCCEEDED + ref (SRV-/REQ-/LAY-)
  'info_answered',           // INFORMATION stage SUCCEEDED, claim-verifier clean
  'status_delivered',        // status lookup answered from DB
  'handoff_completed',       // human handoff finished with disposition
  'other',                   // explicit evidence required
] as const;
export type ResolutionType = typeof RESOLUTION_TYPES[number];

export interface RecordResolutionInput {
  villageId?: string | null;
  waUserId?: string | null;
  sessionId?: string | null;
  channel?: string | null;
  traceId: string;
  resolutionType: ResolutionType;
  /** Deterministic evidence reference, e.g. 'LAP-20260929-001'. Part of the idempotency key. */
  evidenceRef?: string | null;
  /** Deterministic evidence payload: tool names, ticket refs, DB row ids (§12 hierarchy). */
  evidence?: Prisma.InputJsonValue | null;
  /** Contributing turns (ai_message_billings.billing_group_id). Cost is summed from these. */
  billingGroupIds?: string[];
  /** Override the derived idempotency key (used by retry to reuse the exact original key). */
  resolutionKey?: string;
  metadata?: Prisma.InputJsonValue | null;
}

export interface RecordResolutionResult {
  ok: boolean;
  resolution: Record<string, unknown> | null;
  error?: string;
}

function round8(n: number): number {
  return Number(n.toFixed(8));
}

/**
 * Deterministic idempotency key: one debit per (village, type, evidence).
 * A complaint ticket, for example, can only ever bill the village once.
 */
export function buildResolutionKey(villageId: string, type: ResolutionType, evidenceRef?: string | null, traceId?: string): string {
  const ref = (evidenceRef ?? '').trim() || (traceId ?? 'no-trace');
  return `${type}:${ref}`;
}

async function emitResolutionAudit(
  villageId: string,
  traceId: string,
  userId: string,
  channel: string,
  resolution: { id: string; resolution_type: string; resolution_key: string; status: string; total_adjusted_cost_usd: number },
): Promise<void> {
  try {
    await appendAudit({
      tenantId: villageId,
      traceId,
      userId,
      channel,
      stage: 'SEND',
      event: 'resolution_billed',
      payload: {
        resolution_id: resolution.id,
        resolution_type: resolution.resolution_type,
        resolution_key: resolution.resolution_key,
        status: resolution.status,
        total_adjusted_cost_usd: round8(resolution.total_adjusted_cost_usd ?? 0),
      },
    });
  } catch (err) {
    logger.warn('[resolution-billing] resolution_billed audit failed', {
      resolutionId: resolution.id,
      error: (err as Error)?.message ?? String(err),
    });
  }
}

interface ResolutionTotals {
  actualCostUsd: number;
  adjustedCostUsd: number;
  marginUsd: number;
  linkedBillingIds: string[];
}

async function sumAccruedTurnCost(billingGroupIds: string[]): Promise<ResolutionTotals> {
  const totals: ResolutionTotals = { actualCostUsd: 0, adjustedCostUsd: 0, marginUsd: 0, linkedBillingIds: [] };
  const uniqueGroups = [...new Set(billingGroupIds)];
  if (uniqueGroups.length === 0) return totals;
  const accruedRows = await prisma.ai_message_billings.findMany({
    where: { billing_group_id: { in: uniqueGroups }, status: 'accrued' },
    select: { id: true, actual_cost_usd: true, adjusted_cost_usd: true, margin_usd: true },
  });
  for (const row of accruedRows) {
    totals.actualCostUsd += row.actual_cost_usd ?? 0;
    totals.adjustedCostUsd += row.adjusted_cost_usd ?? 0;
    totals.marginUsd += row.margin_usd ?? 0;
    totals.linkedBillingIds.push(row.id);
  }
  totals.actualCostUsd = round8(totals.actualCostUsd);
  totals.adjustedCostUsd = round8(totals.adjustedCostUsd);
  totals.marginUsd = round8(totals.marginUsd);
  return totals;
}

async function settleResolution(
  resolution: { id: string; village_id: string; resolution_type: string; resolution_key: string; trace_id: string; wa_user_id: string | null; session_id: string | null; channel: string | null; billing_group_ids: string[] },
  totals: ResolutionTotals,
  evidenceRef: string | null,
): Promise<RecordResolutionResult> {
  const villageId = resolution.village_id;

  // Zero-cost resolution (e.g. fully cache-served): record for the
  // resolution-rate metric, no wallet movement needed.
  if (totals.adjustedCostUsd <= 0) {
    const done = await prisma.ai_resolutions.update({
      where: { id: resolution.id },
      data: { status: 'billed', billed_at: new Date(), error_message: null },
    });
    await emitResolutionAudit(villageId, resolution.trace_id, resolution.wa_user_id ?? resolution.session_id ?? '', resolution.channel ?? 'whatsapp', {
      id: done.id, resolution_type: done.resolution_type, resolution_key: done.resolution_key,
      status: done.status, total_adjusted_cost_usd: done.total_adjusted_cost_usd,
    });
    return { ok: true, resolution: done as unknown as Record<string, unknown> };
  }

  try {
    const debitResult = await debitVillageWalletForResolution({
      villageId,
      resolutionId: resolution.id,
      adjustedCostUsd: totals.adjustedCostUsd,
      actualCostUsd: totals.actualCostUsd,
      marginUsd: totals.marginUsd,
      metadata: {
        resolution_type: resolution.resolution_type,
        resolution_key: resolution.resolution_key,
        evidence_ref: evidenceRef,
        trace_id: resolution.trace_id,
        billing_group_ids: resolution.billing_group_ids,
        channel: resolution.channel,
        wa_user_id: resolution.wa_user_id,
      } as Prisma.InputJsonValue,
    });

    const billed = await prisma.ai_resolutions.update({
      where: { id: resolution.id },
      data: {
        status: 'billed',
        ledger_entry_id: debitResult?.ledgerEntry.id ?? null,
        billed_at: new Date(),
        error_message: null,
      },
    });

    if (totals.linkedBillingIds.length > 0) {
      await prisma.ai_message_billings.updateMany({
        where: { id: { in: totals.linkedBillingIds }, status: 'accrued' },
        data: { status: 'resolved' },
      });
    }

    await emitResolutionAudit(villageId, resolution.trace_id, resolution.wa_user_id ?? resolution.session_id ?? '', resolution.channel ?? 'whatsapp', {
      id: billed.id, resolution_type: billed.resolution_type, resolution_key: billed.resolution_key,
      status: billed.status, total_adjusted_cost_usd: billed.total_adjusted_cost_usd,
    });
    return { ok: true, resolution: billed as unknown as Record<string, unknown> };
  } catch (error: any) {
    const status = error instanceof InsufficientAIWalletBalanceError
      ? 'failed_insufficient_balance'
      : 'failed';
    const failed = await prisma.ai_resolutions.update({
      where: { id: resolution.id },
      data: { status, error_message: error?.message || 'Resolution billing debit failed' },
    }).catch(() => null);
    logger.warn('[resolution-billing] debit failed', {
      resolutionId: resolution.id, villageId, status,
      error: error?.message || String(error),
    });
    return { ok: false, resolution: (failed ?? resolution) as unknown as Record<string, unknown>, error: error?.message || 'debit failed' };
  }
}

export async function recordResolution(input: RecordResolutionInput): Promise<RecordResolutionResult> {
  const villageId = input.villageId ?? null;
  const resolutionKey = input.resolutionKey
    ?? (villageId
      ? buildResolutionKey(villageId, input.resolutionType, input.evidenceRef, input.traceId)
      : `no-village:${input.traceId}`);

  try {
    if (!villageId) {
      const resolution = await prisma.ai_resolutions.create({
        data: {
          village_id: '',
          wa_user_id: input.waUserId ?? null,
          session_id: input.sessionId ?? null,
          channel: input.channel ?? null,
          trace_id: input.traceId,
          resolution_type: input.resolutionType,
          resolution_key: resolutionKey,
          verified: true,
          verification_evidence_json: input.evidence ?? Prisma.JsonNull,
          billing_group_ids: input.billingGroupIds ?? [],
          status: 'skipped_no_village',
          metadata_json: input.metadata ?? Prisma.JsonNull,
        },
      });
      return { ok: true, resolution: resolution as unknown as Record<string, unknown> };
    }

    // Idempotency: never bill the same (village, type, evidence) twice.
    const existing = await prisma.ai_resolutions.findUnique({
      where: { village_id_resolution_key: { village_id: villageId, resolution_key: resolutionKey } },
    });
    if (existing) {
      return { ok: existing.status === 'billed', resolution: existing as unknown as Record<string, unknown> };
    }

    const billingGroupIds = [...new Set(input.billingGroupIds ?? [])];
    const totals = await sumAccruedTurnCost(billingGroupIds);

    const resolution = await prisma.ai_resolutions.create({
      data: {
        village_id: villageId,
        wa_user_id: input.waUserId ?? null,
        session_id: input.sessionId ?? null,
        channel: input.channel ?? null,
        trace_id: input.traceId,
        resolution_type: input.resolutionType,
        resolution_key: resolutionKey,
        verified: true,
        verification_evidence_json: input.evidence ?? Prisma.JsonNull,
        billing_group_ids: billingGroupIds,
        total_actual_cost_usd: totals.actualCostUsd,
        total_adjusted_cost_usd: totals.adjustedCostUsd,
        total_margin_usd: totals.marginUsd,
        status: 'pending',
        metadata_json: input.metadata ?? Prisma.JsonNull,
      },
    });

    return settleResolution(
      {
        id: resolution.id,
        village_id: villageId,
        resolution_type: input.resolutionType,
        resolution_key: resolutionKey,
        trace_id: input.traceId,
        wa_user_id: input.waUserId ?? null,
        session_id: input.sessionId ?? null,
        channel: input.channel ?? null,
        billing_group_ids: billingGroupIds,
      },
      totals,
      input.evidenceRef ?? null,
    );
  } catch (error: any) {
    logger.error('[resolution-billing] recordResolution failed', {
      villageId, traceId: input.traceId, error: error?.message || String(error),
    });
    return { ok: false, resolution: null, error: error?.message || String(error) };
  }
}

/** Admin/ops retry for resolutions stuck in failed_insufficient_balance/failed. Rethrows nothing. */
export async function retryResolutionBilling(resolutionId: string): Promise<RecordResolutionResult> {
  try {
    const resolution = await prisma.ai_resolutions.findUnique({ where: { id: resolutionId } });
    if (!resolution) return { ok: false, resolution: null, error: 'resolution not found' };
    if (resolution.status === 'billed' || resolution.status === 'skipped_no_village') {
      return { ok: true, resolution: resolution as unknown as Record<string, unknown> };
    }
    // Re-attempt the debit on the SAME row (same idempotency key): the
    // contributing turns are still 'accrued' because the failed attempt
    // never marked them 'resolved'.
    const totals = await sumAccruedTurnCost(resolution.billing_group_ids ?? []);
    const merged: ResolutionTotals = {
      actualCostUsd: round8(Math.max(totals.actualCostUsd, resolution.total_actual_cost_usd ?? 0)),
      adjustedCostUsd: round8(Math.max(totals.adjustedCostUsd, resolution.total_adjusted_cost_usd ?? 0)),
      marginUsd: round8(Math.max(totals.marginUsd, resolution.total_margin_usd ?? 0)),
      linkedBillingIds: totals.linkedBillingIds,
    };
    return settleResolution(
      {
        id: resolution.id,
        village_id: resolution.village_id,
        resolution_type: resolution.resolution_type,
        resolution_key: resolution.resolution_key,
        trace_id: resolution.trace_id,
        wa_user_id: resolution.wa_user_id,
        session_id: resolution.session_id,
        channel: resolution.channel,
        billing_group_ids: resolution.billing_group_ids ?? [],
      },
      merged,
      null,
    );
  } catch (error: any) {
    return { ok: false, resolution: null, error: error?.message || String(error) };
  }
}
