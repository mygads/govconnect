/**
 * Track A2 (v2 cutover prep) tests.
 *
 * Covers the wiring added in this track:
 *  1. v1 system prompt discloses Gana as an AI assistant (P0 disclosure).
 *  2. NIK vault startup guard is fail-closed (assertVaultKeyConfigured).
 *  3. DETERMINISTIC_ONLY_STAGES is a live invariant, not a dead declaration.
 *  4. installMicroAssessor() wires the LLM hook; fuzzy assessment still
 *     resolves deterministically when the gateway is unavailable.
 *  5. resolveVillageName() is DB-first with a fail-soft placeholder.
 *  6. applyDbRagReconcile() ports the v1 db-rag-reconciler to the v2
 *     choke point (every response, audit on rewrite, non-blocking).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/knowledge.service', () => ({
  getVillageProfileSummary: vi.fn(),
}));
vi.mock('../../services/db-rag-reconciler.service', () => ({
  reconcile: vi.fn(),
}));

import { PROMPT_CORE } from '../../prompts/system-prompt';
import { assertVaultKeyConfigured } from '../pii-vault';
import { DETERMINISTIC_ONLY_STAGES } from '../stage-graph';
import { installMicroAssessor } from '../micro-assessor';
import { assessStage } from '../stage-assessor';
import { resolveVillageName, applyDbRagReconcile } from '../process-message-v2';
import { getVillageProfileSummary } from '../../services/knowledge.service';
import { reconcile as reconcileDbRag } from '../../services/db-rag-reconciler.service';
import * as pipelineStore from '../pipeline-store';
import type { ProcessMessageResult } from '../../services/ump-types';

const mockProfile = vi.mocked(getVillageProfileSummary);
const mockReconcile = vi.mocked(reconcileDbRag);

function makeResult(overrides: Partial<ProcessMessageResult> = {}): ProcessMessageResult {
  return {
    success: true,
    response: 'Jam operasional Senin-Jumat 08.00-14.00.',
    intent: 'information',
    metadata: { processingTimeMs: 10, hasKnowledge: true, traceId: 'trace-1' },
    ...overrides,
  };
}

describe('v1 system prompt disclosure (P0)', () => {
  it('discloses Gana as an AI assistant', () => {
    expect(PROMPT_CORE).toMatch(/asisten AI/i);
  });

  it('no longer claims to be human / "BUKAN AI/bot"', () => {
    expect(PROMPT_CORE).not.toContain('BUKAN AI/bot');
    expect(PROMPT_CORE).not.toMatch(/bukan AI/i);
  });
});

describe('assertVaultKeyConfigured (fail-closed)', () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    NIK_VAULT_KEY: process.env.NIK_VAULT_KEY,
    BYPASS: process.env.NIK_VAULT_ALLOW_INSECURE_MEMORY,
  };
  afterEach(() => {
    if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.NIK_VAULT_KEY === undefined) delete process.env.NIK_VAULT_KEY;
    else process.env.NIK_VAULT_KEY = saved.NIK_VAULT_KEY;
    if (saved.BYPASS === undefined) delete process.env.NIK_VAULT_ALLOW_INSECURE_MEMORY;
    else process.env.NIK_VAULT_ALLOW_INSECURE_MEMORY = saved.BYPASS;
  });

  it('throws when no key and no explicit bypass (test env)', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.NIK_VAULT_KEY;
    delete process.env.NIK_VAULT_ALLOW_INSECURE_MEMORY;
    expect(() => assertVaultKeyConfigured()).toThrow(/NIK_VAULT_KEY/);
  });

  it('throws on malformed key even with bypass unset', () => {
    process.env.NODE_ENV = 'test';
    process.env.NIK_VAULT_KEY = 'too-short';
    delete process.env.NIK_VAULT_ALLOW_INSECURE_MEMORY;
    expect(() => assertVaultKeyConfigured()).toThrow(/NIK_VAULT_KEY/);
  });

  it('allows explicit insecure bypass in non-production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.NIK_VAULT_KEY;
    process.env.NIK_VAULT_ALLOW_INSECURE_MEMORY = 'true';
    expect(() => assertVaultKeyConfigured()).not.toThrow();
  });

  it('refuses the bypass in production even when set', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.NIK_VAULT_KEY;
    process.env.NIK_VAULT_ALLOW_INSECURE_MEMORY = 'true';
    expect(() => assertVaultKeyConfigured()).toThrow(/NIK_VAULT_KEY/);
  });

  it('passes silently with a valid 64-hex key in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.NIK_VAULT_KEY = 'a'.repeat(64);
    delete process.env.NIK_VAULT_ALLOW_INSECURE_MEMORY;
    expect(() => assertVaultKeyConfigured()).not.toThrow();
  });
});

describe('DETERMINISTIC_ONLY_STAGES (wired invariant)', () => {
  it('lists exactly the stages with dedicated deterministic handlers', () => {
    expect(DETERMINISTIC_ONLY_STAGES.has('EMERGENCY')).toBe(true);
    expect(DETERMINISTIC_ONLY_STAGES.has('VERIFY')).toBe(true);
    expect(DETERMINISTIC_ONLY_STAGES.has('EXECUTE')).toBe(true);
    expect(DETERMINISTIC_ONLY_STAGES.size).toBe(3);
  });

  it('does not include stages that legitimately use the agent loop or never arrive', () => {
    // STATUS_CHECK intentionally uses the bounded loop with a DB-only
    // allowlist; INGRESS never reaches runStagedTurn (router maps it).
    expect(DETERMINISTIC_ONLY_STAGES.has('STATUS_CHECK')).toBe(false);
    expect(DETERMINISTIC_ONLY_STAGES.has('INGRESS')).toBe(false);
    expect(DETERMINISTIC_ONLY_STAGES.has('TRIAGE')).toBe(false);
    expect(DETERMINISTIC_ONLY_STAGES.has('INFORMATION')).toBe(false);
  });
});

describe('installMicroAssessor wiring', () => {
  it('installs without throwing and fuzzy assessment still resolves when the gateway is down', async () => {
    expect(() => installMicroAssessor()).not.toThrow();
    const d = await assessStage({
      message: 'saya mau lapor jalan rusak di rt 05',
      fromStage: 'TRIAGE',
    });
    // Gateway is disabled in tests → hook returns null → deterministic fallback.
    expect(d.source).toBe('deterministic');
    expect(['COLLECT', 'INFORMATION', 'STATUS_CHECK', 'HANDOFF']).toContain(d.stage);
  });

  it('install is idempotent', () => {
    expect(() => installMicroAssessor()).not.toThrow();
    expect(() => installMicroAssessor()).not.toThrow();
  });
});

describe('resolveVillageName (DB-first, fail-soft)', () => {
  beforeEach(() => {
    mockProfile.mockReset();
  });

  it('returns short_name when the profile has one', async () => {
    mockProfile.mockResolvedValue({ short_name: 'Cipari', name: 'Desa Cipari' } as never);
    await expect(resolveVillageName('v-short')).resolves.toBe('Cipari');
    expect(mockProfile).toHaveBeenCalledWith('v-short');
  });

  it('falls back to name when short_name is missing', async () => {
    mockProfile.mockResolvedValue({ name: 'Desa Sukamaju' } as never);
    await expect(resolveVillageName('v-name')).resolves.toBe('Desa Sukamaju');
  });

  it('falls back to the neutral placeholder when the profile is null', async () => {
    mockProfile.mockResolvedValue(null as never);
    await expect(resolveVillageName('v-null')).resolves.toBe('Desa');
  });

  it('falls back to the neutral placeholder when the lookup throws', async () => {
    mockProfile.mockRejectedValue(new Error('dashboard down'));
    await expect(resolveVillageName('v-throw')).resolves.toBe('Desa');
  });

  it('caches the resolved name per village (second call skips the lookup)', async () => {
    mockProfile.mockResolvedValue({ short_name: 'Cached' } as never);
    await expect(resolveVillageName('v-cached')).resolves.toBe('Cached');
    mockProfile.mockRejectedValue(new Error('should not be called'));
    await expect(resolveVillageName('v-cached')).resolves.toBe('Cached');
  });
});

describe('applyDbRagReconcile (v2 choke point)', () => {
  beforeEach(() => {
    mockReconcile.mockReset();
  });

  it('replaces the response on mismatch and audits kinds (not raw PII values)', async () => {
    const auditSpy = vi.spyOn(pipelineStore, 'appendAudit').mockResolvedValue(true);
    try {
      mockReconcile.mockResolvedValue({
        ok: false,
        mismatches: [{ kind: 'phone', expected: '0282-111', found: '0812-9999-0000' }],
        replacement: makeResult({
          response: 'Nomor yang benar 0282-111.',
          metadata: {
            processingTimeMs: 5,
            hasKnowledge: false,
            traceId: 'trace-1',
            guardrail: {
              stage: 'db_rag_reconciler',
              type: 'phone',
              action: 'rewritten',
              reason: 'value_not_in_official_db',
              details: {},
            },
          },
        }),
      } as never);

      const result = makeResult();
      const out = await applyDbRagReconcile({
        villageId: 'v1',
        userId: 'u1',
        channel: 'whatsapp',
        userMessage: 'berapa nomor telepon desa?',
        result,
        sideEffectsAllowed: true,
      });

      expect(mockReconcile).toHaveBeenCalledWith({
        villageId: 'v1',
        userMessage: 'berapa nomor telepon desa?',
        result,
        toolsUsed: [],
      });
      expect(out.response).toBe('Nomor yang benar 0282-111.');
      expect(out.metadata?.traceId).toBe('trace-1');
      // The reconciler's own guardrail marker survives the wrapper.
      expect(out.metadata?.guardrail).toMatchObject({
        stage: 'db_rag_reconciler',
        action: 'rewritten',
      });
      expect(auditSpy).toHaveBeenCalledTimes(1);
      const auditArg = auditSpy.mock.calls[0][0];
      expect(auditArg.event).toBe('db_rag_reconciler_rewrite');
      expect(auditArg.payload).toMatchObject({ mismatchKinds: ['phone'], mismatchCount: 1 });
      // PII safety: the raw offending phone number must not reach the audit payload.
      expect(JSON.stringify(auditArg.payload)).not.toContain('0812-9999-0000');
    } finally {
      auditSpy.mockRestore();
    }
  });

  it('returns the result untouched when reconciliation passes', async () => {
    mockReconcile.mockResolvedValue({ ok: true, checked: ['phone'] } as never);
    const result = makeResult();
    const out = await applyDbRagReconcile({
      villageId: 'v1',
      userId: 'u1',
      channel: 'webchat',
      userMessage: 'halo',
      result,
      sideEffectsAllowed: true,
    });
    expect(out).toBe(result);
  });

  it('returns the result untouched when the reconciler throws (non-blocking)', async () => {
    mockReconcile.mockRejectedValue(new Error('db down'));
    const result = makeResult();
    const out = await applyDbRagReconcile({
      villageId: 'v1',
      userId: 'u1',
      channel: 'whatsapp',
      userMessage: 'halo',
      result,
      sideEffectsAllowed: true,
    });
    expect(out).toBe(result);
  });

  it('skips reconciliation in shadow/evaluation modes (no production writes)', async () => {
    const result = makeResult();
    const out = await applyDbRagReconcile({
      villageId: 'v1',
      userId: 'u1',
      channel: 'whatsapp',
      userMessage: 'halo',
      result,
      sideEffectsAllowed: false,
    });
    expect(out).toBe(result);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('skips empty responses (e.g. takeover)', async () => {
    const result = makeResult({ response: '' });
    const out = await applyDbRagReconcile({
      villageId: 'v1',
      userId: 'u1',
      channel: 'whatsapp',
      userMessage: 'halo',
      result,
      sideEffectsAllowed: true,
    });
    expect(out).toBe(result);
    expect(mockReconcile).not.toHaveBeenCalled();
  });
});
