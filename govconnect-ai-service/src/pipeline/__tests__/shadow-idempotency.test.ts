/**
 * Tests for deep-audit fixes:
 * - P1-1: shadow/evaluation mode must not write production state
 *           (turn state, idempotency, memory, tickets, LAPOR outbox, cache),
 *           and audit events must carry isEvaluation.
 * - P1-2: idempotency key scoped per tenant+user+channel (no cross-user replay).
 *
 * Heavy modules are mocked; only processMessageV2's gating logic is exercised.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../gateway/tool-gateway', () => ({
  gatewayExecute: vi.fn(),
}));
vi.mock('../../services/ai-gateway.service', () => ({
  callAIGatewayPrompt: vi.fn(),
}));
vi.mock('../pipeline-store', () => ({
  appendAudit: vi.fn(async () => true),
  idempotencyCheck: vi.fn(async () => ({ hit: false })),
  idempotencyStore: vi.fn(async () => undefined),
  loadTurnState: vi.fn(async () => null),
  saveTurnState: vi.fn(async () => true),
  clearTurnState: vi.fn(async () => undefined),
  getDailyCostUsd: vi.fn(async () => null),
}));
vi.mock('../takeover', () => ({
  isTakeoverActive: vi.fn(async () => ({ active: false })),
}));
vi.mock('../ingress-guard', () => ({
  ingressCheck: vi.fn(async () => ({ action: 'allow' })),
  detectAnomaly: vi.fn(() => ({ action: 'allow' })),
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}));
vi.mock('../identity-ladder', () => ({
  resolveIdentityLevel: vi.fn(async () => 'L0'),
  auditIdentityLevel: vi.fn(async () => undefined),
}));
vi.mock('../semantic-cache', () => ({
  semanticCacheLookup: vi.fn(async () => null),
  semanticCacheStore: vi.fn(async () => undefined),
}));
vi.mock('../memory-policy', () => ({
  applyMemoryPolicy: vi.fn(async () => undefined),
}));
vi.mock('../fallback-policy', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../fallback-policy')>();
  return { ...orig, persistFallbackTicket: vi.fn(() => undefined) };
});
vi.mock('../lapor-bridge', () => ({
  enqueueComplaintToLapor: vi.fn(async () => undefined),
}));
vi.mock('../staged-agent', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../staged-agent')>();
  return {
    ...orig,
    runStagedTurn: vi.fn(async () => ({
      terminalState: 'SUCCEEDED',
      stage: 'INFORMATION',
      response: 'Halo! Ada yang bisa dibantu?',
      guidanceText: undefined,
      intent: 'greeting',
      fields: {},
      toolsUsed: [],
      toolTrace: [],
      degraded: false,
    })),
  };
});

import {
  appendAudit, idempotencyCheck, idempotencyStore,
  saveTurnState, clearTurnState,
} from '../pipeline-store';
import { applyMemoryPolicy } from '../memory-policy';
import { persistFallbackTicket } from '../fallback-policy';
import { enqueueComplaintToLapor } from '../lapor-bridge';
import { semanticCacheStore } from '../semantic-cache';
import { processMessageV2, buildIdempotencyKey } from '../process-message-v2';
import type { ProcessMessageInput } from '../../services/ump-types';

function baseInput(over: Partial<ProcessMessageInput> = {}): ProcessMessageInput {
  return {
    message: 'halo',
    userId: 'user-1',
    villageId: 'desa-1',
    channel: 'whatsapp',
    messageId: 'wa-msg-1',
    ...over,
  } as ProcessMessageInput;
}

const mockAppendAudit = vi.mocked(appendAudit);
const mockIdempotencyCheck = vi.mocked(idempotencyCheck);
const mockIdempotencyStore = vi.mocked(idempotencyStore);
const mockSaveTurnState = vi.mocked(saveTurnState);
const mockClearTurnState = vi.mocked(clearTurnState);
const mockApplyMemoryPolicy = vi.mocked(applyMemoryPolicy);
const mockPersistFallbackTicket = vi.mocked(persistFallbackTicket);
const mockEnqueueLapor = vi.mocked(enqueueComplaintToLapor);
const mockSemanticCacheStore = vi.mocked(semanticCacheStore);

beforeEach(() => {
  vi.clearAllMocks();
  mockIdempotencyCheck.mockResolvedValue({ hit: false });
});

describe('P1-1: shadow mode performs no production writes', () => {
  it('sideEffectMode=knowledge_test skips all state writes', async () => {
    const result = await processMessageV2(
      baseInput({ sideEffectMode: 'knowledge_test' }),
    );
    expect(result.success).toBe(true);
    expect(result.response).toContain('Halo');

    // No production writes of any kind.
    expect(mockIdempotencyCheck).not.toHaveBeenCalled();
    expect(mockIdempotencyStore).not.toHaveBeenCalled();
    expect(mockSaveTurnState).not.toHaveBeenCalled();
    expect(mockClearTurnState).not.toHaveBeenCalled();
    expect(mockApplyMemoryPolicy).not.toHaveBeenCalled();
    expect(mockPersistFallbackTicket).not.toHaveBeenCalled();
    expect(mockEnqueueLapor).not.toHaveBeenCalled();
    expect(mockSemanticCacheStore).not.toHaveBeenCalled();
  });

  it('audit events carry isEvaluation=true in shadow mode', async () => {
    await processMessageV2(baseInput({ sideEffectMode: 'knowledge_test' }));
    expect(mockAppendAudit).toHaveBeenCalled();
    for (const call of mockAppendAudit.mock.calls) {
      const evt = call[0] as { payload?: Record<string, unknown> };
      expect(evt.payload?.isEvaluation).toBe(true);
    }
  });

  it('production mode still writes normally', async () => {
    const result = await processMessageV2(baseInput());
    expect(result.success).toBe(true);
    expect(mockIdempotencyCheck).toHaveBeenCalled();
    expect(mockIdempotencyStore).toHaveBeenCalled();
    expect(mockSaveTurnState).toHaveBeenCalled();
    expect(mockApplyMemoryPolicy).toHaveBeenCalled();
    expect(mockSemanticCacheStore).toHaveBeenCalled();
    for (const call of mockAppendAudit.mock.calls) {
      const evt = call[0] as { payload?: Record<string, unknown> };
      expect(evt.payload?.isEvaluation).toBe(false);
    }
  });

  it('sideEffectMode=evaluation also skips writes', async () => {
    await processMessageV2(baseInput({ sideEffectMode: 'evaluation' }));
    expect(mockIdempotencyStore).not.toHaveBeenCalled();
    expect(mockSaveTurnState).not.toHaveBeenCalled();
    expect(mockApplyMemoryPolicy).not.toHaveBeenCalled();
  });
});

describe('P1-2: idempotency key is scoped per tenant+user+channel', () => {
  it('differs across users with identical text (no cross-user replay)', () => {
    const a = buildIdempotencyKey({
      villageId: 'desa-1', userId: 'user-1', channel: 'whatsapp',
      message: 'cek status',
    });
    const b = buildIdempotencyKey({
      villageId: 'desa-1', userId: 'user-2', channel: 'whatsapp',
      message: 'cek status',
    });
    expect(a).not.toBe(b);
  });

  it('differs across channels for the same user', () => {
    const a = buildIdempotencyKey({
      villageId: 'desa-1', userId: 'user-1', channel: 'whatsapp', message: 'halo',
    });
    const b = buildIdempotencyKey({
      villageId: 'desa-1', userId: 'user-1', channel: 'webchat', message: 'halo',
    });
    expect(a).not.toBe(b);
  });

  it('differs across tenants for the same user id', () => {
    const a = buildIdempotencyKey({
      villageId: 'desa-1', userId: 'user-1', channel: 'whatsapp', message: 'halo',
    });
    const b = buildIdempotencyKey({
      villageId: 'desa-2', userId: 'user-1', channel: 'whatsapp', message: 'halo',
    });
    expect(a).not.toBe(b);
  });

  it('is stable for the same user+message (dedup still works)', () => {
    const mk = () => buildIdempotencyKey({
      villageId: 'desa-1', userId: 'user-1', channel: 'whatsapp',
      messageId: 'wa-1', message: 'halo',
    });
    expect(mk()).toBe(mk());
  });

  it('long messages with the same 64-char prefix get different keys', () => {
    const a = buildIdempotencyKey({
      villageId: 'desa-1', userId: 'user-1', channel: 'whatsapp',
      message: 'x'.repeat(64) + 'AAAA',
    });
    const b = buildIdempotencyKey({
      villageId: 'desa-1', userId: 'user-1', channel: 'whatsapp',
      message: 'x'.repeat(64) + 'BBBB',
    });
    expect(a).not.toBe(b);
  });
});
