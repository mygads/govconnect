/**
 * W1 — Never-silent fallback + terminal state coverage.
 *
 * Memastikan setiap turn berakhir di salah satu TerminalState yang valid,
 * khususnya:
 *  1. CANCELLED — ketika user membatalkan (isCancellation).
 *  2. WAITING_FOR_HUMAN — ketika stage HANDOFF (deterministic, tanpa LLM).
 *
 * Sebelum fix: CANCELLED & WAITING_FOR_HUMAN nol assignment di codebase.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock gateway & store agar tidak butuh LLM/DB.
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
  getTakeover: vi.fn(async () => null),
  createFallbackTicket: vi.fn(async () => ({ ok: true, ticketId: 'TMP-TEST-001' })),
}));

import { runStagedTurn, createPipelineContext } from '../staged-agent';

function baseInput(overrides: Record<string, any> = {}) {
  const ctx = createPipelineContext({
    tenantId: 'TEST-DESA-A',
    userId: 'web_test_w1',
    channel: 'webchat',
    traceId: 'trace-w1',
  });
  return {
    message: 'halo',
    decision: { stage: 'TRIAGE', source: 'deterministic', confidence: 1, reasons: [] as string[] },
    ctx,
    villageName: 'Desa Test A',
    ...overrides,
  } as any;
}

describe('W1 terminal states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CANCELLED: pesan pembatalan user → terminalState CANCELLED', async () => {
    const input = baseInput({
      message: 'batalkan saja',
      decision: { stage: 'COLLECT', source: 'deterministic', confidence: 1, reasons: [] },
    });
    const res = await runStagedTurn(input);
    expect(res.terminalState).toBe('CANCELLED');
    expect(res.intent).toBe('cancelled');
    expect(res.response.length).toBeGreaterThan(0); // never-silent
  });

  it('CANCELLED: variasi "nggak jadi" → terminalState CANCELLED', async () => {
    const input = baseInput({
      message: 'nggak jadi deh',
      decision: { stage: 'COLLECT', source: 'deterministic', confidence: 1, reasons: [] },
    });
    const res = await runStagedTurn(input);
    expect(res.terminalState).toBe('CANCELLED');
  });

  it('WAITING_FOR_HUMAN: stage HANDOFF → terminalState WAITING_FOR_HUMAN tanpa LLM', async () => {
    const { callAIGatewayPrompt } = await import('../../services/ai-gateway.service');
    const input = baseInput({
      message: 'saya mau bicara dengan manusia',
      decision: { stage: 'HANDOFF', source: 'deterministic', confidence: 0.95, reasons: ['user requested'] },
    });
    const res = await runStagedTurn(input);
    expect(res.terminalState).toBe('WAITING_FOR_HUMAN');
    expect(res.intent).toBe('handoff');
    expect(res.response.length).toBeGreaterThan(0); // never-silent
    // Deterministic: tidak boleh ada LLM call.
    expect(vi.mocked(callAIGatewayPrompt)).not.toHaveBeenCalled();
  });

  it('WAITING_FOR_HUMAN: response menyebut petugas desa', async () => {
    const input = baseInput({
      message: 'panggilkan petugas',
      decision: { stage: 'HANDOFF', source: 'deterministic', confidence: 0.9, reasons: [] },
    });
    const res = await runStagedTurn(input);
    expect(res.response.toLowerCase()).toMatch(/petugas/);
  });
});
