/**
 * P1-11: anaphoric questions during VERIFY.
 *
 * Regression scenario: the previous turn left the citizen at VERIFY with a
 * minted pending mutation; the citizen then asks a question about it
 * ("kapan selesainya?") instead of confirming. The question must be answered
 * WITH the pending mutation as context, the stage must stay VERIFY, the
 * mutation must survive, and the confirmation prompt must be repeated.
 *
 * - VERIFY + question  → stays VERIFY, pending mutation intact, answer + summary
 * - VERIFY + "ya"      → executes the mutation (unchanged behavior)
 * - VERIFY + "batal"   → cancels (unchanged behavior)
 * - question vs confirmation is decided by the assessor (LLM), not regex
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/ai-gateway.service', () => ({
  callAIGatewayPrompt: vi.fn(),
}));
vi.mock('../../gateway/tool-gateway', () => ({
  gatewayExecute: vi.fn(),
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
vi.mock('../../lib/prisma', () => ({ default: null }));

import { callAIGatewayPrompt } from '../../services/ai-gateway.service';
import { gatewayExecute } from '../../gateway/tool-gateway';
import {
  loadTurnState,
  saveTurnState,
} from '../pipeline-store';
import { runStagedTurn, type StagedAgentInput } from '../staged-agent';
import { createPipelineContext } from '../stage-types';
import { assessStage } from '../stage-assessor';
import { resolveConfirmation } from '../confirmation';
import { processMessageV2 } from '../process-message-v2';

const mockPrompt = vi.mocked(callAIGatewayPrompt);
const mockGateway = vi.mocked(gatewayExecute);
const mockLoadTurnState = vi.mocked(loadTurnState);
const mockSaveTurnState = vi.mocked(saveTurnState);

/** Complete complaint slots — the state the prior VERIFY turn left behind. */
function completeComplaintSlots() {
  return {
    _intent: 'complaint',
    category: 'Jalan',
    location: 'Jl. Merdeka No. 10',
    description: 'jalan berlubang besar',
    pendingTool: {
      tool: 'create_complaint',
      args: {
        category: 'Jalan',
        location: 'Jl. Merdeka No. 10',
        description: 'jalan berlubang besar',
      },
    },
  };
}

function finalMsg(text: string) {
  return {
    text,
    message: { content: text },
    model: 'test-model',
    provider: 'test',
    metrics: {},
  };
}

function stagedInputVerifyQuestion(): StagedAgentInput {
  const input: StagedAgentInput = {
    message: 'kapan selesainya?',
    decision: {
      stage: 'VERIFY',
      source: 'deterministic',
      confidence: 0.6,
      reasons: ['assessor_verify_pending_protected'],
      hints: { verifyQuestion: true },
    },
    ctx: createPipelineContext({
      traceId: 't-p111',
      userId: 'user-p111',
      tenantId: 'desa-1',
      channel: 'webchat',
      sideEffectMode: 'evaluation',
    }),
    villageName: 'Desa Test',
    language: 'id',
  };
  // The prior VERIFY turn left complete slots behind (restored in prod via
  // loadTurnState); without them the VERIFY branch cannot mint the mutation.
  input.ctx.slots = { ...completeComplaintSlots() };
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('P1-11: question during VERIFY keeps stage + pending mutation', () => {
  it('VERIFY + "kapan selesainya?" → answer with context, stage stays VERIFY, mutation intact', async () => {
    mockPrompt.mockResolvedValueOnce(
      finalMsg('Estimasi penyelesaian biasanya 3–7 hari kerja.') as never,
    );

    const input = stagedInputVerifyQuestion();
    const result = await runStagedTurn(input);

    expect(result.terminalState).toBe('SUCCEEDED');
    expect(result.stage).toBe('VERIFY');
    expect(result.intent).toBe('verify_question');
    // The answer references the question…
    expect(result.response).toContain('3–7 hari kerja');
    // …and the deterministic confirmation summary is repeated.
    expect(result.response).toContain('Mohon periksa kembali');
    // The pending mutation survives untouched (rebuilt from the same slots —
    // buildPendingMutation maps slot names to tool arg names).
    const pending = input.ctx.slots.pendingTool as { tool: string; args: Record<string, unknown> };
    expect(pending).toBeDefined();
    expect(pending.tool).toBe('create_complaint');
    expect(pending.args.deskripsi).toBe('jalan berlubang besar');
    expect(pending.args.alamat).toBe('Jl. Merdeka No. 10');
    // The mutation was NOT executed.
    expect(mockGateway).not.toHaveBeenCalled();
  });

  it('VERIFY + "batal" → still cancels, no execution', async () => {
    const input = stagedInputVerifyQuestion();
    input.message = 'batal';
    input.decision.hints = {};

    const result = await runStagedTurn(input);

    expect(result.terminalState).toBe('CANCELLED');
    expect(result.stage).toBe('CLOSE');
    expect(result.intent).toBe('cancelled');
    expect(result.response).toContain('dibatalkan');
    expect(mockGateway).not.toHaveBeenCalled();
  });
});

describe('P1-11: confirmation/execution path untouched', () => {
  it('VERIFY + "Ya" (webchat) → executes the pending mutation', async () => {
    mockLoadTurnState.mockResolvedValue({
      stage: 'VERIFY',
      slots: completeComplaintSlots(),
      assessorConfidences: [],
      lastTurnAt: new Date().toISOString(),
    } as never);
    mockSaveTurnState.mockResolvedValue(undefined as never);
    mockGateway.mockImplementation(async (name) => ({
      ok: true,
      blocked: false,
      trace: { tool: String(name), success: true, durationMs: 1 },
      result: { success: true, data: { ticket_id: 'LAP-TEST-001' } },
    }) as never);
    mockPrompt.mockResolvedValue(
      finalMsg('Laporan Anda sudah dicatat dengan nomor LAP-TEST-001.') as never,
    );

    const result = await processMessageV2({
      tenantId: 'desa-1',
      userId: 'user-p111',
      channel: 'webchat',
      message: 'Ya',
      messageId: 'm-p111-exec',
      sideEffectMode: 'evaluation',
    } as never);

    expect(result.success).toBe(true);
    expect(result.intent).toBe('mutation');
    expect(mockGateway).toHaveBeenCalledTimes(1);
    expect(mockGateway.mock.calls[0][0]).toBe('create_complaint');
  });

  it('processMessageV2: question during VERIFY keeps VERIFY + mutation, answers + repeats summary', async () => {
    mockLoadTurnState.mockResolvedValue({
      stage: 'VERIFY',
      slots: completeComplaintSlots(),
      assessorConfidences: [],
      lastTurnAt: new Date().toISOString(),
    } as never);
    mockSaveTurnState.mockResolvedValue(undefined as never);
    mockPrompt.mockResolvedValueOnce(
      finalMsg('Estimasi penyelesaian biasanya 3–7 hari kerja.') as never,
    );

    const result = await processMessageV2({
      tenantId: 'desa-1',
      userId: 'user-p111',
      channel: 'webchat',
      message: 'kapan selesainya?',
      messageId: 'm-p111-q',
      sideEffectMode: 'evaluation',
    } as never);

    expect(result.success).toBe(true);
    expect(result.response).toContain('3–7 hari kerja');
    expect(result.response).toContain('Mohon periksa kembali');
    // The full pipeline kept the VERIFY routing (not lost to INFORMATION).
    expect(result.metadata?.routing?.action).toBe('VERIFY');
    expect(result.metadata?.routing?.primaryIntent).toBe('verify_question');
    // Mutation never executed.
    expect(mockGateway).not.toHaveBeenCalled();
  });
});

describe('P1-11: question vs confirmation decided by assessor, not regex', () => {
  it('"kapan selesainya?" is a route, not a confirmation', () => {
    const confirmation = resolveConfirmation({
      message: 'kapan selesainya?',
      buttonId: undefined,
      channel: 'webchat',
      pending: completeComplaintSlots().pendingTool as never,
    });
    expect(confirmation.kind).toBe('route');
  });

  it('assessor deterministic fallback protects an interrupted VERIFY (no LLM)', async () => {
    const decision = await assessStage({
      message: 'kapan selesainya?',
      fromStage: 'VERIFY',
      verifyPending: true,
    });
    expect(decision.stage).toBe('VERIFY');
    expect(decision.reasons).toContain('assessor_verify_pending_protected');
  });

  it('fail-safe: even a new-topic message stays VERIFY when the LLM assessor is unavailable', async () => {
    // Without the LLM hook only the deterministic fallback runs; it cannot
    // tell "lapor lagi" (new report) from a question about the pending item,
    // so staying in VERIFY is the safe choice (no execution, no data loss).
    const decision = await assessStage({
      message: 'saya mau lapor lagi soal lampu jalan',
      fromStage: 'VERIFY',
      verifyPending: true,
    });
    expect(decision.stage).toBe('VERIFY');
    expect(decision.reasons).toContain('assessor_verify_pending_protected');
  });
});
