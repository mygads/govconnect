import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';

export class InsufficientAIWalletBalanceError extends Error {
  constructor(public readonly balanceUsd: number, public readonly requiredUsd: number) {
    super('Insufficient AI wallet balance');
    this.name = 'InsufficientAIWalletBalanceError';
  }
}

type LedgerEntryType = 'topup' | 'usage_debit' | 'voucher_redeem' | 'manual_adjustment' | 'refund' | 'seed';

type WalletStatus = 'active' | 'warning' | 'exhausted';

function resolveWalletStatus(balanceUsd: number, warningThresholdUsd: number): WalletStatus {
  if (balanceUsd <= 0) return 'exhausted';
  if (balanceUsd < warningThresholdUsd) return 'warning';
  return 'active';
}

function normalizeAmount(amountUsd: number): number {
  return Number(amountUsd.toFixed(8));
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function findUsageDebitReference(referenceType?: string | null, referenceId?: string | null) {
  if (!referenceType || !referenceId) return null;
  return prisma.ai_wallet_ledger_entries.findFirst({
    where: {
      entry_type: 'usage_debit',
      reference_type: referenceType,
      reference_id: referenceId,
    },
  });
}

export async function ensureVillageWallet(villageId: string) {
  const existing = await prisma.ai_village_wallets.findUnique({
    where: { village_id: villageId },
  });

  if (existing) return existing;

  return prisma.ai_village_wallets.create({
    data: {
      village_id: villageId,
      balance_usd: 0,
      warning_threshold_usd: 1,
      status: 'exhausted',
      last_exhausted_at: new Date(),
    },
  });
}

async function createLedgerEntry(
  tx: Prisma.TransactionClient,
  input: {
    villageId: string;
    walletId: string;
    entryType: LedgerEntryType;
    amountUsd: number;
    balanceBeforeUsd: number;
    balanceAfterUsd: number;
    actualCostUsd?: number;
    adjustedCostUsd?: number;
    marginUsd?: number;
    referenceType?: string | null;
    referenceId?: string | null;
    metadata?: Prisma.InputJsonValue | null;
    createdByAdminId?: string | null;
  },
) {
  return tx.ai_wallet_ledger_entries.create({
    data: {
      village_id: input.villageId,
      wallet_id: input.walletId,
      entry_type: input.entryType,
      amount_usd: normalizeAmount(input.amountUsd),
      balance_before_usd: normalizeAmount(input.balanceBeforeUsd),
      balance_after_usd: normalizeAmount(input.balanceAfterUsd),
      actual_cost_usd: normalizeAmount(input.actualCostUsd ?? 0),
      adjusted_cost_usd: normalizeAmount(input.adjustedCostUsd ?? 0),
      margin_usd: normalizeAmount(input.marginUsd ?? 0),
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      metadata_json: input.metadata ?? Prisma.JsonNull,
      created_by_admin_id: input.createdByAdminId ?? null,
    },
  });
}

export async function getWalletSummary(villageId: string) {
  const wallet = await ensureVillageWallet(villageId);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [todayUsage, trailingUsage, recentLedger] = await Promise.all([
    prisma.ai_wallet_ledger_entries.aggregate({
      where: {
        village_id: villageId,
        entry_type: 'usage_debit',
        created_at: { gte: todayStart },
      },
      _sum: { adjusted_cost_usd: true },
    }),
    prisma.ai_wallet_ledger_entries.aggregate({
      where: {
        village_id: villageId,
        entry_type: 'usage_debit',
        created_at: { gte: sevenDaysAgo },
      },
      _sum: { adjusted_cost_usd: true },
    }),
    prisma.ai_wallet_ledger_entries.findMany({
      where: { village_id: villageId },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
  ]);

  const todayUsageUsd = todayUsage._sum.adjusted_cost_usd ?? 0;
  const avgDailyUsageUsd = (trailingUsage._sum.adjusted_cost_usd ?? 0) / 7;
  const runwayDays = avgDailyUsageUsd > 0 ? wallet.balance_usd / avgDailyUsageUsd : null;

  return {
    wallet,
    todayUsageUsd,
    avgDailyUsageUsd,
    runwayDays,
    recentLedger,
  };
}

export async function getWalletLedger(villageId: string, limit = 50) {
  await ensureVillageWallet(villageId);
  return prisma.ai_wallet_ledger_entries.findMany({
    where: { village_id: villageId },
    orderBy: { created_at: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

export async function canProcessVillageAI(villageId?: string | null): Promise<{ allowed: boolean; reason?: string; balanceUsd?: number; status?: string }> {
  if (!villageId) {
    return { allowed: true };
  }

  const wallet = await ensureVillageWallet(villageId);
  return {
    allowed: wallet.balance_usd > 0 && wallet.status !== 'exhausted',
    reason: wallet.balance_usd > 0 && wallet.status !== 'exhausted' ? undefined : 'wallet_exhausted',
    balanceUsd: wallet.balance_usd,
    status: wallet.status,
  };
}

export async function topupVillageWallet(input: {
  villageId: string;
  amountUsd: number;
  entryType?: Extract<LedgerEntryType, 'topup' | 'voucher_redeem' | 'manual_adjustment' | 'refund' | 'seed'>;
  referenceType?: string | null;
  referenceId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  createdByAdminId?: string | null;
}) {
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) {
    throw new Error('Topup amount must be greater than 0');
  }

  await ensureVillageWallet(input.villageId);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ai_village_wallets" WHERE "village_id" = ${input.villageId} FOR UPDATE`;

    const wallet = await tx.ai_village_wallets.findUniqueOrThrow({
      where: { village_id: input.villageId },
    });

    const balanceBeforeUsd = wallet.balance_usd;
    const balanceAfterUsd = normalizeAmount(balanceBeforeUsd + input.amountUsd);
    const status = resolveWalletStatus(balanceAfterUsd, wallet.warning_threshold_usd);

    const updatedWallet = await tx.ai_village_wallets.update({
      where: { id: wallet.id },
      data: {
        balance_usd: balanceAfterUsd,
        status,
        last_topup_at: new Date(),
      },
    });

    const ledgerEntry = await createLedgerEntry(tx, {
      villageId: input.villageId,
      walletId: wallet.id,
      entryType: input.entryType ?? 'topup',
      amountUsd: input.amountUsd,
      balanceBeforeUsd,
      balanceAfterUsd,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      metadata: input.metadata,
      createdByAdminId: input.createdByAdminId,
    });

    return { wallet: updatedWallet, ledgerEntry };
  });
}

export async function adjustVillageWallet(input: {
  villageId: string;
  amountUsd: number;
  direction: 'credit' | 'debit';
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  createdByAdminId?: string | null;
}) {
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) {
    throw new Error('Adjustment amount must be greater than 0');
  }
  if (input.direction !== 'credit' && input.direction !== 'debit') {
    throw new Error('Adjustment direction must be credit or debit');
  }

  await ensureVillageWallet(input.villageId);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ai_village_wallets" WHERE "village_id" = ${input.villageId} FOR UPDATE`;

    const wallet = await tx.ai_village_wallets.findUniqueOrThrow({
      where: { village_id: input.villageId },
    });

    const adjustmentAmount = normalizeAmount(input.amountUsd);
    const signedAmount = input.direction === 'credit' ? adjustmentAmount : -adjustmentAmount;
    const balanceBeforeUsd = wallet.balance_usd;
    const balanceAfterUsd = normalizeAmount(balanceBeforeUsd + signedAmount);
    if (balanceAfterUsd < 0) {
      throw new InsufficientAIWalletBalanceError(balanceBeforeUsd, adjustmentAmount);
    }

    const status = resolveWalletStatus(balanceAfterUsd, wallet.warning_threshold_usd);
    const updatedWallet = await tx.ai_village_wallets.update({
      where: { id: wallet.id },
      data: {
        balance_usd: balanceAfterUsd,
        status,
        last_topup_at: input.direction === 'credit' ? new Date() : wallet.last_topup_at,
        last_exhausted_at: status === 'exhausted' ? new Date() : wallet.last_exhausted_at,
      },
    });

    const metadata = {
      ...((input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) ? input.metadata : {}),
      adjustment_type: input.direction,
      ...(input.reason ? { reason: input.reason } : {}),
    } as Prisma.InputJsonValue;

    const ledgerEntry = await createLedgerEntry(tx, {
      villageId: input.villageId,
      walletId: wallet.id,
      entryType: 'manual_adjustment',
      amountUsd: signedAmount,
      balanceBeforeUsd,
      balanceAfterUsd,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      metadata,
      createdByAdminId: input.createdByAdminId,
    });

    return { wallet: updatedWallet, ledgerEntry };
  });
}

export async function debitVillageWalletForUsage(input: {
  villageId?: string | null;
  adjustedCostUsd: number;
  actualCostUsd?: number;
  marginUsd?: number;
  referenceType?: string | null;
  referenceId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}) {
  if (!input.villageId || !Number.isFinite(input.adjustedCostUsd) || input.adjustedCostUsd <= 0) {
    return null;
  }

  await ensureVillageWallet(input.villageId);

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ai_village_wallets" WHERE "village_id" = ${input.villageId!} FOR UPDATE`;

      const wallet = await tx.ai_village_wallets.findUniqueOrThrow({
        where: { village_id: input.villageId! },
      });

      if (input.referenceType && input.referenceId) {
        const existingLedgerEntry = await tx.ai_wallet_ledger_entries.findFirst({
          where: {
            entry_type: 'usage_debit',
            reference_type: input.referenceType,
            reference_id: input.referenceId,
          },
        });
        if (existingLedgerEntry) {
          return { wallet, ledgerEntry: existingLedgerEntry };
        }
      }

      const balanceBeforeUsd = wallet.balance_usd;
      const adjustedCostUsd = normalizeAmount(input.adjustedCostUsd);
      if (balanceBeforeUsd < adjustedCostUsd) {
        throw new InsufficientAIWalletBalanceError(balanceBeforeUsd, adjustedCostUsd);
      }
      const balanceAfterUsd = normalizeAmount(balanceBeforeUsd - adjustedCostUsd);
      const status = resolveWalletStatus(balanceAfterUsd, wallet.warning_threshold_usd);

      const updatedWallet = await tx.ai_village_wallets.update({
        where: { id: wallet.id },
        data: {
          balance_usd: balanceAfterUsd,
          status,
          last_exhausted_at: status === 'exhausted' ? new Date() : wallet.last_exhausted_at,
        },
      });

      const ledgerEntry = await createLedgerEntry(tx, {
        villageId: input.villageId!,
        walletId: wallet.id,
        entryType: 'usage_debit',
        amountUsd: -adjustedCostUsd,
        balanceBeforeUsd,
        balanceAfterUsd,
        actualCostUsd: input.actualCostUsd,
        adjustedCostUsd: adjustedCostUsd,
        marginUsd: input.marginUsd,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        metadata: input.metadata,
      });

      if (status === 'exhausted') {
        logger.warn('Village AI wallet exhausted after usage debit', {
          villageId: input.villageId,
          balanceBeforeUsd,
          balanceAfterUsd,
        });
      }

      return { wallet: updatedWallet, ledgerEntry };
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existingLedgerEntry = await findUsageDebitReference(input.referenceType, input.referenceId);
    if (!existingLedgerEntry) throw error;
    const wallet = await prisma.ai_village_wallets.findUniqueOrThrow({ where: { village_id: input.villageId } });
    return { wallet, ledgerEntry: existingLedgerEntry };
  }

}

export async function debitVillageWalletForMessageBilling(input: {
  villageId?: string | null;
  messageBillingId: string;
  adjustedCostUsd: number;
  actualCostUsd?: number;
  marginUsd?: number;
  metadata?: Prisma.InputJsonValue | null;
}) {
  return debitVillageWalletForUsage({
    villageId: input.villageId,
    adjustedCostUsd: input.adjustedCostUsd,
    actualCostUsd: input.actualCostUsd,
    marginUsd: input.marginUsd,
    referenceType: 'ai_message_billing',
    referenceId: input.messageBillingId,
    metadata: input.metadata,
  });
}

export async function createTopupVoucher(input: {
  code: string;
  amountUsd: number;
  expiresAt?: Date | null;
  metadata?: Prisma.InputJsonValue | null;
  createdByAdminId?: string | null;
}) {
  if (!input.code.trim()) {
    throw new Error('Voucher code is required');
  }
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) {
    throw new Error('Voucher amount must be greater than 0');
  }

  return prisma.ai_topup_vouchers.create({
    data: {
      code: input.code.trim().toUpperCase(),
      amount_usd: normalizeAmount(input.amountUsd),
      expires_at: input.expiresAt ?? null,
      metadata_json: input.metadata ?? Prisma.JsonNull,
      created_by_admin_id: input.createdByAdminId ?? null,
    },
  });
}

export async function listTopupVouchers(limit = 100) {
  const vouchers = await prisma.ai_topup_vouchers.findMany({
    orderBy: { created_at: 'desc' },
    take: Math.min(Math.max(limit, 1), 500),
  });

  const voucherIds = vouchers.map((voucher) => voucher.id);
  const ledgerEntries = voucherIds.length > 0
    ? await prisma.ai_wallet_ledger_entries.findMany({
        where: {
          entry_type: 'voucher_redeem',
          reference_type: 'voucher',
          reference_id: { in: voucherIds },
        },
        select: {
          id: true,
          reference_id: true,
          village_id: true,
          amount_usd: true,
          balance_before_usd: true,
          balance_after_usd: true,
          created_at: true,
          created_by_admin_id: true,
        },
      })
    : [];
  const ledgerByVoucherId = new Map(ledgerEntries.map((entry) => [entry.reference_id, entry]));

  return vouchers.map((voucher) => ({
    ...voucher,
    redeem_ledger_entry: ledgerByVoucherId.get(voucher.id) ?? null,
  }));
}

export async function redeemTopupVoucher(input: {
  villageId: string;
  code: string;
  adminId?: string | null;
}) {
  const normalizedCode = input.code.trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error('Voucher code is required');
  }

  const voucher = await prisma.ai_topup_vouchers.findUnique({
    where: { code: normalizedCode },
  });

  if (!voucher) {
    throw new Error('Voucher is not active');
  }

  await ensureVillageWallet(input.villageId);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ai_topup_vouchers" WHERE "id" = ${voucher.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ai_village_wallets" WHERE "village_id" = ${input.villageId} FOR UPDATE`;

    const activeVoucher = await tx.ai_topup_vouchers.findUniqueOrThrow({
      where: { id: voucher.id },
    });

    if (activeVoucher.status !== 'active') {
      throw new Error('Voucher is not active');
    }

    if (activeVoucher.expires_at && activeVoucher.expires_at.getTime() < Date.now()) {
      await tx.ai_topup_vouchers.update({
        where: { id: activeVoucher.id },
        data: { status: 'expired' },
      });
      throw new Error('Voucher has expired');
    }

    const wallet = await tx.ai_village_wallets.findUniqueOrThrow({
      where: { village_id: input.villageId },
    });

    const balanceBeforeUsd = wallet.balance_usd;
    const balanceAfterUsd = normalizeAmount(balanceBeforeUsd + activeVoucher.amount_usd);
    const status = resolveWalletStatus(balanceAfterUsd, wallet.warning_threshold_usd);

    const updatedWallet = await tx.ai_village_wallets.update({
      where: { id: wallet.id },
      data: {
        balance_usd: balanceAfterUsd,
        status,
        last_topup_at: new Date(),
      },
    });

    const updatedVoucher = await tx.ai_topup_vouchers.update({
      where: { id: activeVoucher.id },
      data: {
        status: 'redeemed',
        redeemed_by_village_id: input.villageId,
        redeemed_by_admin_id: input.adminId ?? null,
        redeemed_at: new Date(),
      },
    });

    const ledgerEntry = await createLedgerEntry(tx, {
      villageId: input.villageId,
      walletId: wallet.id,
      entryType: 'voucher_redeem',
      amountUsd: activeVoucher.amount_usd,
      balanceBeforeUsd,
      balanceAfterUsd,
      referenceType: 'voucher',
      referenceId: activeVoucher.id,
      metadata: { code: activeVoucher.code },
      createdByAdminId: input.adminId,
    });

    return { wallet: updatedWallet, voucher: updatedVoucher, ledgerEntry };
  });
}

export async function listVillageWallets(limit = 200) {
  return prisma.ai_village_wallets.findMany({
    orderBy: [{ status: 'asc' }, { updated_at: 'desc' }],
    take: Math.min(Math.max(limit, 1), 500),
  });
}
