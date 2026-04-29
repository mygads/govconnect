/**
 * One-shot migration: re-encrypt all rows in ai_providers.api_key_encrypted
 * using AES-256-GCM (utils/crypto). Idempotent — rows already in v1: format are skipped.
 *
 * Usage: pnpm tsx scripts/encrypt-existing-provider-keys.ts
 *
 * Requires AI_PROVIDER_ENCRYPTION_KEY (or PROFILE_ENCRYPTION_KEY) to be set.
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { encryptSecret, isCiphertext } from '../src/utils/crypto';

async function main() {
  const providers = await prisma.ai_providers.findMany({
    select: { id: true, name: true, api_key_encrypted: true },
  });

  let migrated = 0;
  let skipped = 0;
  let empty = 0;

  for (const p of providers) {
    if (!p.api_key_encrypted) {
      empty += 1;
      continue;
    }
    if (isCiphertext(p.api_key_encrypted)) {
      skipped += 1;
      continue;
    }
    const encrypted = encryptSecret(p.api_key_encrypted);
    if (encrypted === p.api_key_encrypted) {
      // No key configured — abort to avoid leaving plaintext in place.
      console.error('[abort] AI_PROVIDER_ENCRYPTION_KEY is not configured. Aborting.');
      process.exit(1);
    }
    await prisma.ai_providers.update({
      where: { id: p.id },
      data: { api_key_encrypted: encrypted },
    });
    console.log(`[ok] migrated provider ${p.name} (${p.id})`);
    migrated += 1;
  }

  console.log(`\nDone. migrated=${migrated} skipped=${skipped} empty=${empty} total=${providers.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
