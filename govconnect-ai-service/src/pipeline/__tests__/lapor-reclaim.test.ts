/**
 * Tests for P2-8 (deep audit): LAPOR outbox rows stuck in 'sending' (crash
 * between claim and markResult) must be reclaimed — and for P2-4: the NIK
 * vault must mint the canonical underscore token format that TOKEN_RE
 * (gateway/pii-gateway.ts) recognizes.
 *
 * The real pipeline-store / pii-vault modules are imported (no DB is touched:
 * prisma is dynamically imported and these paths don't reach it; the vault
 * runs in degraded memory mode without NIK_VAULT_KEY).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getLaporSendingReclaimMinutes } from '../pipeline-store';
import { vaultStoreNik } from '../pii-vault';

const ENV_KEY = 'LAPOR_SENDING_RECLAIM_MINUTES';
const saved = process.env[ENV_KEY];

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

describe('P2-8: lapor sending-reclaim config', () => {
  it('defaults to 30 minutes', () => {
    delete process.env[ENV_KEY];
    expect(getLaporSendingReclaimMinutes()).toBe(30);
  });

  it('honors a valid env override', () => {
    process.env[ENV_KEY] = '10';
    expect(getLaporSendingReclaimMinutes()).toBe(10);
  });

  it('falls back to 30 on invalid values', () => {
    process.env[ENV_KEY] = 'bogus';
    expect(getLaporSendingReclaimMinutes()).toBe(30);
    process.env[ENV_KEY] = '-5';
    expect(getLaporSendingReclaimMinutes()).toBe(30);
    process.env[ENV_KEY] = '0';
    expect(getLaporSendingReclaimMinutes()).toBe(30);
  });
});

describe('P2-4: vault token format', () => {
  it('mints canonical underscore tokens (match TOKEN_RE)', async () => {
    // No NIK_VAULT_KEY in this env → degraded memory mode, no DB touched.
    const token = await vaultStoreNik('3273010101900001', 'village-test');
    expect(token).toMatch(/^⟦NIK_[0-9a-f]{12}⟧$/);
  });
});
