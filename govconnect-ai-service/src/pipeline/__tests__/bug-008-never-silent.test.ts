/**
 * BUG-008 — never-silent delivery helpers.
 *
 * hasDeliverableFallback decides whether a failed turn's response is worth
 * delivering to the citizen (static fallback with real content) instead of
 * the 503 + failed_messages path.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../gateway/tool-gateway', () => ({ gatewayExecute: vi.fn() }));
vi.mock('../../services/ai-gateway.service', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../services/ai-gateway.service')>();
  return { ...orig, callAIGatewayPrompt: vi.fn() };
});
vi.mock('../pipeline-store', () => ({
  appendAudit: vi.fn(async () => true),
  idempotencyCheck: vi.fn(async () => ({ hit: false })),
  idempotencyStore: vi.fn(async () => undefined),
  loadTurnState: vi.fn(async () => null),
  saveTurnState: vi.fn(async () => true),
  clearTurnState: vi.fn(async () => undefined),
  getDailyCostUsd: vi.fn(async () => null),
}));

import { hasDeliverableFallback, isProcessingFailure } from '../../services/unified-message-processor.service';

const FALLBACK_TEXT =
  'Mohon maaf, sistem kami sedang mengalami gangguan. Laporan Anda tercatat ' +
  'dengan nomor TMP-20260929-001 dan petugas desa akan menindaklanjuti.';

describe('hasDeliverableFallback', () => {
  it('returns true for a failed turn with static fallback text', () => {
    expect(hasDeliverableFallback({
      success: false, response: FALLBACK_TEXT, intent: 'ERROR', error: 'empty_llm_output',
    } as any)).toBe(true);
  });

  it('returns false for empty responses', () => {
    expect(hasDeliverableFallback({ success: false, response: '   ', intent: 'ERROR', error: 'x' } as any)).toBe(false);
    expect(hasDeliverableFallback({ success: false, response: '', intent: 'ERROR', error: 'x' } as any)).toBe(false);
  });

  it('returns false for known hollow-apology strings', () => {
    expect(hasDeliverableFallback({
      success: true, response: 'Mohon maaf, terjadi gangguan pada sistem kami.', intent: 'ERROR',
    } as any)).toBe(false);
  });

  it('returns true for normal successful responses', () => {
    expect(hasDeliverableFallback({
      success: true, response: 'Jadwal posyandu hari Sabtu.', intent: 'info',
    } as any)).toBe(true);
  });
});

describe('isProcessingFailure (regression lock)', () => {
  it('still flags failed turns with an error', () => {
    expect(isProcessingFailure({ success: false, response: FALLBACK_TEXT, intent: 'ERROR', error: 'x' } as any)).toBe(true);
  });

  it('still flags empty responses', () => {
    expect(isProcessingFailure({ success: true, response: '', intent: 'x' } as any)).toBe(true);
  });

  it('does not flag normal successful turns', () => {
    expect(isProcessingFailure({ success: true, response: 'Baik, dicatat.', intent: 'x' } as any)).toBe(false);
  });
});
