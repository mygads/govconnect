/**
 * P0-1 — G2/G3 confirmation chain tests.
 *
 * Covers the full repair of the broken confirmation chain:
 *  1. button.id is authoritative (bindConfirmation / resolveConfirmation).
 *  2. Typed "Ya" never executes a mutation — it re-shows the VERIFY summary.
 *  3. VERIFY mints pendingTool so the next turn's confirm_send can bind.
 *  4. EXECUTE runs only when confirmed + bound; pendingTool is single-use.
 *  5. Stale/replayed clicks are rejected deterministically.
 *
 * Levels:
 *  - pure unit tests for pipeline/confirmation.ts + slot-fsm.ts
 *  - runStagedTurn integration with a mocked tool gateway (no LLM, no DB)
 *  - processMessageV2 wiring with a mocked pipeline store (no DB)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Pure unit tests (no mocks needed) ──────────────────────────────────────
import {
  bindConfirmation, resolveConfirmation, isPendingMutation, isKnownConfirmButton,
  STALE_CONFIRMATION_COPY,
} from '../confirmation';
import { isExplicitConfirmation, buildPendingMutation, INTENT_SLOT_KEY } from '../slot-fsm';

vi.mock('../../gateway/tool-gateway', () => ({
  gatewayExecute: vi.fn(),
}));
// staged-agent imports the AI gateway service for the bounded LLM loop only;
// the VERIFY/EXECUTE paths under test never reach it. Stub it so the test
// does not drag the Prisma-backed billing/health services into the graph
// (the generated client is unavailable in this environment).
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
  // cost-guard imports getDailyCostUsd from here; null → budget fail-open.
  getDailyCostUsd: vi.fn(async () => null),
  // fallback-policy (P2-9) persists fallback tickets atomically.
  createFallbackTicket: vi.fn(async () => 'inserted'),
}));
vi.mock('../takeover', () => ({
  isTakeoverActive: vi.fn(async () => ({ active: false })),
}));

import { gatewayExecute } from '../../gateway/tool-gateway';
import { loadTurnState, saveTurnState } from '../pipeline-store';
import { runStagedTurn, createPipelineContext } from '../staged-agent';
import { processMessageV2 } from '../process-message-v2';
import type { StagedAgentInput } from '../staged-agent';

const mockGatewayExecute = vi.mocked(gatewayExecute);
const mockLoadTurnState = vi.mocked(loadTurnState);
const mockSaveTurnState = vi.mocked(saveTurnState);

const PENDING = {
  tool: 'create_complaint',
  args: {
    kategori: 'jalan rusak',
    alamat: 'RT 01/RW 02',
    deskripsi: 'Jalan berlubang parah di depan rumah',
    rt_rw: 'RT 01/RW 02',
    nama_pelapor: null,
    no_hp: null,
  },
};

function baseSlots() {
  return {
    [INTENT_SLOT_KEY]: 'complaint',
    category: 'jalan rusak',
    description: 'Jalan berlubang parah di depan rumah sejak sebulan lalu',
    location: 'RT 01/RW 02',
  } as Record<string, unknown>;
}

function stagedInput(over: Partial<StagedAgentInput> = {}): StagedAgentInput {
  const ctx = createPipelineContext({
    traceId: 't1', userId: 'u1', tenantId: 'v1', channel: 'whatsapp',
  });
  ctx.slots = baseSlots();
  return {
    message: '✅ Benar, kirim',
    decision: { stage: 'VERIFY', source: 'deterministic', confidence: 1, reasons: [] },
    ctx,
    villageName: 'Desa',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGatewayExecute.mockResolvedValue({
    ok: true,
    result: { success: true, suggested_response: 'Tiket berhasil dibuat.' } as any,
    trace: { tool: 'create_complaint', success: true, durationMs: 5 },
  });
});

describe('confirmation binding (pure)', () => {
  it('binds confirm_send only with a well-formed pendingTool', () => {
    expect(bindConfirmation('confirm_send', { pendingTool: PENDING })).toBe(true);
    expect(bindConfirmation('confirm_send', {})).toBe(false);
    expect(bindConfirmation('confirm_send', null)).toBe(false);
    expect(bindConfirmation('confirm_send', { pendingTool: { tool: '', args: {} } })).toBe(false);
    expect(bindConfirmation('confirm_send', { pendingTool: { tool: 'x' } })).toBe(false);
  });

  it('never binds other buttons or text', () => {
    expect(bindConfirmation('edit_data', { pendingTool: PENDING })).toBe(false);
    expect(bindConfirmation('cancel_request', { pendingTool: PENDING })).toBe(false);
    expect(bindConfirmation(undefined, { pendingTool: PENDING })).toBe(false);
    expect(bindConfirmation('Ya', { pendingTool: PENDING })).toBe(false);
  });

  it('isPendingMutation validates shape', () => {
    expect(isPendingMutation(PENDING)).toBe(true);
    expect(isPendingMutation(null)).toBe(false);
    expect(isPendingMutation({ tool: 'create_complaint', args: null })).toBe(false);
    expect(isPendingMutation('confirm_send')).toBe(false);
  });

  it('isKnownConfirmButton recognizes the contract ids', () => {
    expect(isKnownConfirmButton('confirm_send')).toBe(true);
    expect(isKnownConfirmButton('edit_data')).toBe(true);
    expect(isKnownConfirmButton('cancel_request')).toBe(true);
    expect(isKnownConfirmButton('cat_jalan')).toBe(false);
    expect(isKnownConfirmButton(null)).toBe(false);
  });

  it('resolveConfirmation: bound click → execute', () => {
    expect(resolveConfirmation({
      buttonId: 'confirm_send', confirmed: true, message: '✅ Benar, kirim', pending: PENDING,
    })).toEqual({ kind: 'execute' });
  });

  it('resolveConfirmation: confirm_send without pending → stale (replay rejected)', () => {
    expect(resolveConfirmation({
      buttonId: 'confirm_send', confirmed: false, message: '✅ Benar, kirim', pending: null,
    })).toEqual({ kind: 'stale' });
    // Forged confirmed flag without a pending mutation → still stale.
    expect(resolveConfirmation({
      buttonId: 'confirm_send', confirmed: true, message: '✅ Benar, kirim', pending: null,
    })).toEqual({ kind: 'stale' });
  });

  it('resolveConfirmation: edit/cancel are deterministic', () => {
    expect(resolveConfirmation({
      buttonId: 'edit_data', message: '✏️ Ubah', pending: PENDING,
    })).toEqual({ kind: 'edit' });
    expect(resolveConfirmation({
      buttonId: 'cancel_request', message: '❌ Batal', pending: PENDING,
    })).toEqual({ kind: 'cancel' });
    // Stale edit click → stale, not a fresh route.
    expect(resolveConfirmation({
      buttonId: 'edit_data', message: '✏️ Ubah', pending: null,
    })).toEqual({ kind: 'stale' });
  });

  it('resolveConfirmation: affirmative TEXT → reverify, never execute', () => {
    for (const text of ['Ya', 'ya', 'YA', 'Ya, lanjutkan', '✅ Benar, kirim']) {
      expect(resolveConfirmation({
        message: text, pending: PENDING,
      })).toEqual({ kind: 'reverify' });
    }
  });

  it('resolveConfirmation: ordinary text → route', () => {
    expect(resolveConfirmation({ message: 'halo', pending: PENDING })).toEqual({ kind: 'route' });
    expect(resolveConfirmation({ message: 'Ya', pending: null })).toEqual({ kind: 'route' });
  });
});

describe('isExplicitConfirmation (button titles)', () => {
  it('matches the confirm button title', () => {
    expect(isExplicitConfirmation('✅ Benar, kirim')).toBe(true);
    expect(isExplicitConfirmation('Benar, kirim')).toBe(true);
  });

  it('still matches plain affirmatives', () => {
    for (const t of ['Ya', 'ya', 'Ya.', 'Ya, lanjutkan', 'setuju', 'betul', 'ok', 'lanjut']) {
      expect(isExplicitConfirmation(t)).toBe(true);
    }
  });

  it('rejects non-confirmations', () => {
    for (const t of ['tidak', 'batal', 'mungkin ya', 'yakin', '', '✏️ Ubah', '❌ Batal']) {
      expect(isExplicitConfirmation(t)).toBe(false);
    }
  });
});

describe('runStagedTurn VERIFY → EXECUTE (mocked gateway)', () => {
  it('VERIFY default mints pendingTool and renders summary WITHOUT executing', async () => {
    const input = stagedInput({ confirmed: false });
    const turn = await runStagedTurn(input);
    expect(turn.terminalState).toBe('SUCCEEDED');
    expect(turn.stage).toBe('VERIFY');
    expect(turn.response).toContain('Mohon periksa kembali');
    expect(mockGatewayExecute).not.toHaveBeenCalled();
    // The pending mutation is minted so the next turn's button can bind.
    expect(input.ctx.slots.pendingTool).toEqual(
      expect.objectContaining({ tool: 'create_complaint' }),
    );
    expect(buildPendingMutation('complaint', input.ctx.slots as any)).not.toBeNull();
  });

  it('VERIFY with typed "Ya" (not button-bound) re-renders summary, NO execution', async () => {
    const input = stagedInput({ message: 'Ya', confirmed: false });
    const turn = await runStagedTurn(input);
    expect(turn.terminalState).toBe('SUCCEEDED');
    expect(turn.stage).toBe('VERIFY');
    expect(turn.response).toContain('Mohon periksa kembali');
    expect(mockGatewayExecute).not.toHaveBeenCalled();
  });

  it('VERIFY with button title text but confirmed=false does NOT execute', async () => {
    const input = stagedInput({ message: '✅ Benar, kirim', confirmed: false });
    const turn = await runStagedTurn(input);
    expect(turn.stage).toBe('VERIFY');
    expect(mockGatewayExecute).not.toHaveBeenCalled();
  });

  it('EXECUTE with confirmed=true + pendingTool runs the mutation once', async () => {
    const input = stagedInput({
      message: '✅ Benar, kirim',
      confirmed: true,
      decision: { stage: 'EXECUTE', source: 'deterministic', confidence: 1, reasons: [] },
    });
    input.ctx.slots.pendingTool = { ...PENDING };
    const turn = await runStagedTurn(input);
    expect(turn.terminalState).toBe('SUCCEEDED');
    expect(turn.stage).toBe('EXECUTE');
    expect(turn.toolsUsed).toEqual(['create_complaint']);
    expect(mockGatewayExecute).toHaveBeenCalledTimes(1);
    expect(mockGatewayExecute.mock.calls[0][0]).toBe('create_complaint');
    // Single-use: pendingTool cleared after execution (replay protection).
    expect(input.ctx.slots.pendingTool).toBeUndefined();
  });

  it('EXECUTE with confirmed=true but NO pendingTool fails over WITHOUT executing', async () => {
    const input = stagedInput({
      confirmed: true,
      decision: { stage: 'EXECUTE', source: 'deterministic', confidence: 1, reasons: [] },
    });
    const turn = await runStagedTurn(input);
    expect(turn.terminalState).toBe('FAILED');
    expect(turn.degradationReason).toBe('execute_without_pending_tool');
    expect(mockGatewayExecute).not.toHaveBeenCalled();
  });

  it('EXECUTE with confirmed=false asks for confirmation, NO execution', async () => {
    const input = stagedInput({
      confirmed: false,
      decision: { stage: 'EXECUTE', source: 'deterministic', confidence: 1, reasons: [] },
    });
    input.ctx.slots.pendingTool = { ...PENDING };
    const turn = await runStagedTurn(input);
    expect(turn.intent).toBe('awaiting_confirmation');
    expect(mockGatewayExecute).not.toHaveBeenCalled();
  });

  it('VERIFY with confirmed=true executes through the bound mutation', async () => {
    const input = stagedInput({ confirmed: true });
    input.ctx.slots.pendingTool = { ...PENDING };
    const turn = await runStagedTurn(input);
    expect(turn.terminalState).toBe('SUCCEEDED');
    expect(mockGatewayExecute).toHaveBeenCalledTimes(1);
    expect(input.ctx.slots.pendingTool).toBeUndefined();
  });
});

describe('processMessageV2 confirmation wiring (mocked store)', () => {
  const baseInput = {
    userId: '6281',
    villageId: 'v1',
    message: '✅ Benar, kirim',
    channel: 'whatsapp' as const,
    messageId: 'mid-1',
  };

  it('confirm_send + bound pending → EXECUTE succeeds and clears pendingTool', async () => {
    mockLoadTurnState.mockResolvedValue({
      stage: 'VERIFY',
      slots: { ...baseSlots(), pendingTool: { ...PENDING } },
      assessorConfidences: [],
    });
    const res = await processMessageV2({
      ...baseInput, buttonId: 'confirm_send', confirmed: true,
    });
    expect(res.success).toBe(true);
    expect(res.intent).toBe('mutation');
    expect(mockGatewayExecute).toHaveBeenCalledTimes(1);
    // Replay protection: every turn-state save in this flow must persist
    // WITHOUT pendingTool (a replayed click then finds no pending mutation
    // and is rejected as stale).
    const saves = mockSaveTurnState.mock.calls;
    expect(saves.length).toBeGreaterThan(0);
    for (const [, , state] of saves) {
      expect((state as any).slots.pendingTool).toBeUndefined();
    }
  });

  it('stale confirm_send click (no pending) is rejected deterministically', async () => {
    mockLoadTurnState.mockResolvedValue({
      stage: 'VERIFY',
      slots: baseSlots(), // pendingTool already consumed
      assessorConfidences: [],
    });
    const res = await processMessageV2({
      ...baseInput, buttonId: 'confirm_send', confirmed: false,
    });
    expect(res.intent).toBe('stale_confirmation');
    expect(res.response).toBe(STALE_CONFIRMATION_COPY);
    expect(mockGatewayExecute).not.toHaveBeenCalled();
  });

  it('replayed second click after success is rejected (pendingTool single-use)', async () => {
    // First click: pending present → executes.
    mockLoadTurnState.mockResolvedValue({
      stage: 'VERIFY',
      slots: { ...baseSlots(), pendingTool: { ...PENDING } },
      assessorConfidences: [],
    });
    const first = await processMessageV2({
      ...baseInput, messageId: 'mid-1', buttonId: 'confirm_send', confirmed: true,
    });
    expect(first.success).toBe(true);
    expect(mockGatewayExecute).toHaveBeenCalledTimes(1);

    // Second click (replay): pendingTool already consumed → stale.
    mockLoadTurnState.mockResolvedValue({
      stage: 'EXECUTE',
      slots: baseSlots(), // no pendingTool anymore
      assessorConfidences: [],
    });
    const second = await processMessageV2({
      ...baseInput, messageId: 'mid-2', buttonId: 'confirm_send', confirmed: false,
    });
    expect(second.intent).toBe('stale_confirmation');
    expect(mockGatewayExecute).toHaveBeenCalledTimes(1); // still 1 — no double ticket
  });

  it('typed "Ya" after VERIFY re-shows the summary, never executes', async () => {
    mockLoadTurnState.mockResolvedValue({
      stage: 'VERIFY',
      slots: { ...baseSlots(), pendingTool: { ...PENDING } },
      assessorConfidences: [],
    });
    const res = await processMessageV2({ ...baseInput, message: 'Ya' });
    expect(res.success).toBe(true);
    expect(res.response).toContain('Mohon periksa kembali');
    expect(mockGatewayExecute).not.toHaveBeenCalled();
  });

  it('edit_data drops the pending mutation and asks for the correction', async () => {
    mockLoadTurnState.mockResolvedValue({
      stage: 'VERIFY',
      slots: { ...baseSlots(), pendingTool: { ...PENDING } },
      assessorConfidences: [],
    });
    const res = await processMessageV2({
      ...baseInput, message: '✏️ Ubah', buttonId: 'edit_data',
    });
    expect(res.intent).toBe('correction');
    expect(mockGatewayExecute).not.toHaveBeenCalled();
    expect(mockSaveTurnState).toHaveBeenCalled();
    const saved = mockSaveTurnState.mock.calls[0][2];
    expect(saved.slots.pendingTool).toBeUndefined();
    expect(saved.stage).toBe('COLLECT');
  });
});
