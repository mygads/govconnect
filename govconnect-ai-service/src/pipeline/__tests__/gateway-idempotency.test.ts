/**
 * Tests for P1-3: mutation idempotency + turn cancellation in the tool gateway.
 *
 * - P1-3(a): G2/G3 tools get a deterministic idempotency key per
 *   (tenant, user, tool, args-hash); a retry after a timeout replays the
 *   stored result instead of executing the mutation twice.
 * - P1-3(b): an aborted turn signal refuses new tool executions.
 *
 * The idempotency store is mocked with a real in-memory Map so the
 * check→store→replay cycle is genuinely exercised.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/agent/tool-executor', () => ({
  executeToolCall: vi.fn(),
}));
vi.mock('../pipeline/pipeline-store', () => {
  const store = new Map<string, { response: unknown; expiresAt: number }>();
  return {
    idempotencyCheck: vi.fn(async (tenantId: string, key: string) => {
      const m = store.get(`${tenantId}:${key}`);
      if (m && m.expiresAt > Date.now()) return { hit: true, response: m.response };
      if (m) store.delete(`${tenantId}:${key}`);
      return { hit: false };
    }),
    idempotencyStore: vi.fn(async (tenantId: string, key: string, response: unknown, ttlMs: number) => {
      store.set(`${tenantId}:${key}`, { response, expiresAt: Date.now() + ttlMs });
    }),
  };
});

import { executeToolCall } from '../../services/agent/tool-executor';
import { gatewayExecute, type GatewayContext } from '../../gateway/tool-gateway';

const mockExecute = vi.mocked(executeToolCall);

function gwCtx(over: Partial<GatewayContext> = {}): GatewayContext {
  return {
    userId: 'user-1',
    tenantId: 'desa-1',
    channel: 'whatsapp',
    traceId: 't1',
    stage: 'EXECUTE',
    confirmed: true,
    identityLevel: 'L2',
    idempotencyKeys: [],
    recentSignatures: [],
    ...over,
  };
}

const COMPLAINT_ARGS = {
  kategori: 'jalan rusak',
  deskripsi: 'Jalan berlubang di depan rumah',
  rt_rw: 'RT 01/RW 02',
};

function okResult(ref: string) {
  return {
    result: {
      success: true,
      suggested_response: `Tiket ${ref} berhasil dibuat.`,
      data: { ref },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue(okResult('LAP-20260929-0001') as never);
});

describe('P1-3(a): mutation idempotency', () => {
  it('replays the stored result instead of double-executing the mutation', async () => {
    const first = await gatewayExecute('create_complaint', COMPLAINT_ARGS, gwCtx());
    expect(first.ok).toBe(true);
    expect(first.trace.replayed).not.toBe(true);

    const second = await gatewayExecute('create_complaint', COMPLAINT_ARGS, gwCtx());
    expect(second.ok).toBe(true);
    expect(second.trace.replayed).toBe(true);
    expect(second.result).toEqual(first.result);
    // The mutation executed exactly once despite two gateway calls.
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('does not share mutation keys across users', async () => {
    await gatewayExecute('create_complaint', COMPLAINT_ARGS, gwCtx({ userId: 'user-x1' }));
    await gatewayExecute('create_complaint', COMPLAINT_ARGS, gwCtx({ userId: 'user-x2' }));
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('different args produce different keys (both execute)', async () => {
    await gatewayExecute('create_complaint', COMPLAINT_ARGS, gwCtx({ userId: 'u-a' }));
    await gatewayExecute(
      'create_complaint',
      { ...COMPLAINT_ARGS, deskripsi: 'Lampu jalan mati' },
      gwCtx({ userId: 'u-a' }),
    );
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('read-only G0 tools bypass mutation idempotency', async () => {
    const ctx = gwCtx({ stage: 'INFORMATION' });
    await gatewayExecute('get_village_profile', {}, ctx);
    await gatewayExecute('get_village_profile', {}, ctx);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('records minted keys on ctx.idempotencyKeys', async () => {
    const ctx = gwCtx({ userId: 'u-keys' });
    await gatewayExecute('create_complaint', COMPLAINT_ARGS, ctx);
    expect(ctx.idempotencyKeys.length).toBe(1);
    expect(ctx.idempotencyKeys[0]).toContain('create_complaint');
  });

  it('retry after a timeout replays the late result (no double ticket)', async () => {
    vi.resetModules();
    process.env.PER_TOOL_TIMEOUT_MS = '30';
    const fresh = await import('../../gateway/tool-gateway');
    const freshExecute = vi.mocked(
      (await import('../../services/agent/tool-executor')).executeToolCall,
    );
    // The tool call is slow (100ms) but DOES succeed server-side.
    freshExecute.mockImplementationOnce(
      () => new Promise((res) => setTimeout(() => res(okResult('LAP-LATE-1') as never), 100)),
    );
    const r = await fresh.gatewayExecute(
      'create_complaint',
      COMPLAINT_ARGS,
      {
        userId: 'user-timeout', tenantId: 'desa-1', channel: 'whatsapp',
        traceId: 't-timeout', stage: 'EXECUTE', confirmed: true,
        identityLevel: 'L2', idempotencyKeys: [], recentSignatures: [],
      },
    );
    expect(r.ok).toBe(true);
    expect(r.trace.replayed).toBe(true);
    // Executed once; the retry replayed the late-arriving result.
    expect(freshExecute).toHaveBeenCalledTimes(1);
    expect((r.result as { data?: { ref?: string } })?.data?.ref).toBe('LAP-LATE-1');
    delete process.env.PER_TOOL_TIMEOUT_MS;
  }, 20000);
});

describe('P1-3(b): turn cancellation', () => {
  it('refuses new tool executions once the turn signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await gatewayExecute(
      'create_complaint', COMPLAINT_ARGS, gwCtx({ signal: controller.signal }),
    );
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.blockReason).toBe('turn_cancelled:timeout');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('a live signal does not block execution', async () => {
    const controller = new AbortController();
    const r = await gatewayExecute(
      'create_complaint', COMPLAINT_ARGS, gwCtx({ userId: 'u-live', signal: controller.signal }),
    );
    expect(r.ok).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
