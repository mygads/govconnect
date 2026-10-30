/**
 * R6 — outbound canary wrapper on processMessageV2.
 *
 * The wrapper is the single choke point: EVERY response leaving the
 * pipeline passes checkOutboundForCanary. On a leak the response is
 * substituted with the static safe reply (never silent); on a clean
 * response it passes through untouched.
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
vi.mock('../../security/canary-docs', () => ({
  checkOutboundForCanary: vi.fn(),
  CANARY_SAFE_REPLY: 'SAFE_REPLY_STATIC',
}));

import { processMessageV2 } from '../process-message-v2';
import { checkOutboundForCanary } from '../../security/canary-docs';
import { loadTurnState } from '../pipeline-store';

const mockCanaryCheck = vi.mocked(checkOutboundForCanary);
const mockLoadTurnState = vi.mocked(loadTurnState);

const baseInput = {
  userId: '6281',
  villageId: 'v1',
  message: '✅ Benar, kirim',
  channel: 'whatsapp' as const,
  messageId: 'mid-canary-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Deterministic stale-confirmation path: no LLM, no tools, returns a
  // static response — enough to exercise the wrapper.
  mockLoadTurnState.mockResolvedValue({
    stage: 'VERIFY',
    slots: { pendingTool: undefined },
    assessorConfidences: [],
  });
  mockCanaryCheck.mockResolvedValue({ leaked: false, labels: [] });
});

describe('processMessageV2 canary wrapper', () => {
  it('passes clean responses through untouched', async () => {
    const res = await processMessageV2({ ...baseInput });
    expect(mockCanaryCheck).toHaveBeenCalledTimes(1);
    const [text, villageId] = mockCanaryCheck.mock.calls[0];
    expect(typeof text).toBe('string');
    expect(villageId).toBe('v1');
    expect(res.response).not.toBe('SAFE_REPLY_STATIC');
    expect((res.metadata as any)?.canaryLeakBlocked).toBeUndefined();
  });

  it('substitutes a safe static reply when a canary leaks', async () => {
    mockCanaryCheck.mockResolvedValue({ leaked: true, labels: ['ops-manual'] });
    const res = await processMessageV2({ ...baseInput, messageId: 'mid-canary-2' });
    expect(res.success).toBe(true);
    expect(res.response).toBe('SAFE_REPLY_STATIC');
    expect((res.metadata as any)?.canaryLeakBlocked).toBe(true);
    // Never silent: the substituted reply is non-empty.
    expect(res.response.length).toBeGreaterThan(0);
  });

  it('fail-open when the canary check itself throws', async () => {
    mockCanaryCheck.mockRejectedValue(new Error('check exploded'));
    const res = await processMessageV2({ ...baseInput, messageId: 'mid-canary-3' });
    // The inner result is returned untouched — the wrapper never breaks the turn.
    expect(res.response).not.toBe('SAFE_REPLY_STATIC');
  });
});
