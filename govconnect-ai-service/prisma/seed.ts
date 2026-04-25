import { PrismaClient, Prisma } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const DEFAULT_TEST_VILLAGE_ID = process.env.AI_TEST_VILLAGE_ID || 'cmkuvo1dk0000mj60h4u4bq1w';
const DEFAULT_SEED_WALLET_USD = Number(process.env.AI_SEED_WALLET_USD || 25);

async function seedTestWallet() {
  const villageId = DEFAULT_TEST_VILLAGE_ID.trim();
  const seedAmount = Number.isFinite(DEFAULT_SEED_WALLET_USD) && DEFAULT_SEED_WALLET_USD > 0
    ? DEFAULT_SEED_WALLET_USD
    : 25;

  if (!villageId) return null;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.ai_village_wallets.findUnique({ where: { village_id: villageId } });
    const balanceBeforeUsd = existing?.balance_usd ?? 0;

    const wallet = existing
      ? await tx.ai_village_wallets.update({
          where: { id: existing.id },
          data: {
            balance_usd: seedAmount,
            warning_threshold_usd: 1,
            status: seedAmount > 0 ? 'active' : 'exhausted',
            last_topup_at: new Date(),
            last_exhausted_at: seedAmount > 0 ? null : new Date(),
          },
        })
      : await tx.ai_village_wallets.create({
          data: {
            village_id: villageId,
            balance_usd: seedAmount,
            warning_threshold_usd: 1,
            status: seedAmount > 0 ? 'active' : 'exhausted',
            last_topup_at: new Date(),
            last_exhausted_at: seedAmount > 0 ? null : new Date(),
          },
        });

    await tx.ai_wallet_ledger_entries.create({
      data: {
        village_id: villageId,
        wallet_id: wallet.id,
        entry_type: 'seed',
        amount_usd: seedAmount - balanceBeforeUsd,
        balance_before_usd: balanceBeforeUsd,
        balance_after_usd: seedAmount,
        metadata_json: Prisma.JsonNull,
        reference_type: 'prisma_seed',
      },
    });

    return wallet;
  });
}

async function main() {
  const wallet = await seedTestWallet();

  if (wallet) {
    console.log(`Seeded AI wallet for village ${wallet.village_id} with balance ${wallet.balance_usd} USD.`);
  } else {
    console.log('Skipped AI wallet seed because AI_TEST_VILLAGE_ID is empty.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
