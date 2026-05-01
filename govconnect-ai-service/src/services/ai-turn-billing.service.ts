import { AsyncLocalStorage } from 'async_hooks';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { debitVillageWalletForMessageBilling, InsufficientAIWalletBalanceError } from './ai-wallet.service';

export interface AiBillingTurnContext {
  village_id?: string | null;
  message_id?: string | null;
  trace_id: string;
  billing_group_id: string;
  batched_message_ids?: string[];
  wa_user_id?: string | null;
  session_id?: string | null;
  channel?: string | null;
}

interface AiBillingTurnStore {
  context: AiBillingTurnContext;
  usageWrites: Promise<unknown>[];
}

export type AiBillingTurnHandle = AiBillingTurnStore;

const billingTurnStorage = new AsyncLocalStorage<AiBillingTurnStore>();

export function getCurrentBillingContext(): AiBillingTurnContext | null {
  return billingTurnStorage.getStore()?.context ?? null;
}

export function registerUsageWrite(promise: Promise<unknown>): void {
  const store = billingTurnStorage.getStore();
  if (!store) return;
  store.usageWrites.push(promise.catch((error: any) => {
    logger.warn('AI usage write failed during billing turn', { error: error?.message || String(error) });
  }));
}

export function startAiBillingTurn(context: AiBillingTurnContext): AiBillingTurnHandle | null {
  if (billingTurnStorage.getStore()) return null;
  const store: AiBillingTurnStore = { context, usageWrites: [] };
  billingTurnStorage.enterWith(store);
  return store;
}

export async function finishAiBillingTurn(handle: AiBillingTurnHandle | null): Promise<void> {
  if (!handle) return;
  await waitForUsageWrites(handle);
  await finalizeAiBillingTurn(handle.context);
}

async function waitForUsageWrites(store: AiBillingTurnStore): Promise<void> {
  let cursor = 0;
  while (cursor < store.usageWrites.length) {
    const pending = store.usageWrites.slice(cursor);
    cursor = store.usageWrites.length;
    await Promise.allSettled(pending);
  }
}

export async function withAiBillingTurn<T>(context: AiBillingTurnContext, handler: () => Promise<T>): Promise<T> {
  const existing = billingTurnStorage.getStore();
  if (existing) {
    return handler();
  }

  const store: AiBillingTurnStore = { context, usageWrites: [] };
  return billingTurnStorage.run(store, async () => {
    let result: T;
    let handlerError: unknown;

    try {
      result = await handler();
    } catch (error) {
      handlerError = error;
    }

    await waitForUsageWrites(store);

    try {
      await finalizeAiBillingTurn(context);
    } catch (error: any) {
      logger.error('AI billing turn finalization failed', {
        billingGroupId: context.billing_group_id,
        error: error?.message || String(error),
      });
      if (!handlerError) throw error;
    }

    if (handlerError) throw handlerError;
    return result!;
  });
}

export async function finalizeAiBillingTurn(context: AiBillingTurnContext) {
  const existingBilling = await prisma.ai_message_billings.findUnique({
    where: { billing_group_id: context.billing_group_id },
  });

  if (existingBilling?.status === 'billed' || existingBilling?.status === 'skipped_zero_cost' || existingBilling?.status === 'skipped_no_village') {
    return existingBilling;
  }

  const usageRows = await prisma.ai_token_usage.findMany({
    where: {
      billing_group_id: context.billing_group_id,
      billing_status: 'unbilled',
      success: true,
    },
    orderBy: { created_at: 'asc' },
  });

  if (usageRows.length === 0) {
    return existingBilling;
  }

  const totals = usageRows.reduce((acc, row) => {
    acc.input_tokens += row.input_tokens;
    acc.output_tokens += row.output_tokens;
    acc.total_tokens += row.total_tokens;
    acc.actual_cost_usd += row.actual_cost_usd;
    acc.adjusted_cost_usd += row.adjusted_cost_usd;
    acc.margin_usd += row.margin_usd;
    return acc;
  }, {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    actual_cost_usd: 0,
    adjusted_cost_usd: 0,
    margin_usd: 0,
  });

  const status = !context.village_id
    ? 'skipped_no_village'
    : totals.adjusted_cost_usd > 0
      ? 'pending'
      : 'skipped_zero_cost';

  const billing = await prisma.ai_message_billings.upsert({
    where: { billing_group_id: context.billing_group_id },
    create: {
      village_id: context.village_id ?? null,
      message_id: context.message_id ?? null,
      trace_id: context.trace_id,
      billing_group_id: context.billing_group_id,
      channel: context.channel ?? null,
      wa_user_id: context.wa_user_id ?? null,
      session_id: context.session_id ?? null,
      batched_message_ids: context.batched_message_ids ?? [],
      input_tokens: totals.input_tokens,
      output_tokens: totals.output_tokens,
      total_tokens: totals.total_tokens,
      call_count: usageRows.length,
      actual_cost_usd: Number(totals.actual_cost_usd.toFixed(8)),
      adjusted_cost_usd: Number(totals.adjusted_cost_usd.toFixed(8)),
      margin_usd: Number(totals.margin_usd.toFixed(8)),
      status,
      metadata_json: {
        usage_ids: usageRows.map(row => row.id),
      } as Prisma.InputJsonValue,
      billed_at: status === 'pending' ? null : new Date(),
    },
    update: {
      village_id: context.village_id ?? null,
      message_id: context.message_id ?? null,
      trace_id: context.trace_id,
      channel: context.channel ?? null,
      wa_user_id: context.wa_user_id ?? null,
      session_id: context.session_id ?? null,
      batched_message_ids: context.batched_message_ids ?? [],
      input_tokens: totals.input_tokens,
      output_tokens: totals.output_tokens,
      total_tokens: totals.total_tokens,
      call_count: usageRows.length,
      actual_cost_usd: Number(totals.actual_cost_usd.toFixed(8)),
      adjusted_cost_usd: Number(totals.adjusted_cost_usd.toFixed(8)),
      margin_usd: Number(totals.margin_usd.toFixed(8)),
      status,
      metadata_json: {
        usage_ids: usageRows.map(row => row.id),
      } as Prisma.InputJsonValue,
      billed_at: status === 'pending' ? null : new Date(),
      error_message: null,
    },
  });

  if (status !== 'pending') {
    await markUsageRowsFinalized(context.billing_group_id, status, usageRows.map(row => row.id));
    return billing;
  }

  try {
    const debitResult = await debitVillageWalletForMessageBilling({
      villageId: context.village_id,
      messageBillingId: billing.id,
      adjustedCostUsd: billing.adjusted_cost_usd,
      actualCostUsd: billing.actual_cost_usd,
      marginUsd: billing.margin_usd,
      metadata: {
        billing_group_id: context.billing_group_id,
        message_id: context.message_id ?? null,
        trace_id: context.trace_id,
        call_count: usageRows.length,
      } as Prisma.InputJsonValue,
    });

    const billedAt = new Date();
    const updatedBilling = await prisma.ai_message_billings.update({
      where: { id: billing.id },
      data: {
        status: 'billed',
        ledger_entry_id: debitResult?.ledgerEntry.id ?? billing.ledger_entry_id,
        billed_at: billedAt,
        error_message: null,
      },
    });

    await markUsageRowsFinalized(context.billing_group_id, 'billed', usageRows.map(row => row.id), billedAt);
    return updatedBilling;
  } catch (error: any) {
    const status = error instanceof InsufficientAIWalletBalanceError
      ? 'failed_insufficient_balance'
      : 'failed';
    await prisma.ai_message_billings.update({
      where: { id: billing.id },
      data: {
        status,
        error_message: error?.message || 'Message billing debit failed',
      },
    });
    throw error;
  }
}

async function markUsageRowsFinalized(
  billingGroupId: string,
  status: string,
  usageIds: string[],
  billedAt = new Date(),
): Promise<void> {
  if (usageIds.length === 0) return;
  await prisma.ai_token_usage.updateMany({
    where: {
      billing_group_id: billingGroupId,
      id: { in: usageIds },
      billing_status: 'unbilled',
    },
    data: {
      billing_status: status,
      billed_at: billedAt,
    },
  });
}
