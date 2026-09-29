/**
 * Test for P1-6: voice-note transcripts must replace input.message BEFORE
 * routing and slot extraction.
 *
 * Regression: transcription used to happen after routeMessage() and the
 * COLLECT slot-FSM, so stage/intent/slots were computed from an
 * empty/placeholder message and the transcript never entered the slots.
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
vi.mock('../lapor-bridge', () => ({
  enqueueComplaintToLapor: vi.fn(async () => undefined),
}));
vi.mock('../voice-pipeline', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../voice-pipeline')>();
  return { ...orig, handleVoiceNote: vi.fn() };
});
vi.mock('../staged-agent', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../staged-agent')>();
  return {
    ...orig,
    runStagedTurn: vi.fn(async (input: { message: string; decision: { stage: string } }) => {
      captured.push({ message: input.message, stage: input.decision.stage });
      return {
        terminalState: 'SUCCEEDED',
        stage: input.decision.stage,
        response: 'ok',
        guidanceText: undefined,
        intent: 'test',
        fields: {},
        toolsUsed: [],
        toolTrace: [],
        degraded: false,
      };
    }),
  };
});

const captured: Array<{ message: string; stage: string }> = [];

import { handleVoiceNote } from '../voice-pipeline';
import { runStagedTurn } from '../staged-agent';
import { processMessageV2 } from '../process-message-v2';

const mockHandleVoiceNote = vi.mocked(handleVoiceNote);
void runStagedTurn;

beforeEach(() => {
  vi.clearAllMocks();
  captured.length = 0;
});

function voiceInput(message = '') {
  return {
    message,
    userId: 'user-v',
    villageId: 'desa-1',
    channel: 'whatsapp',
    messageId: 'wa-voice-1',
    mediaType: 'audio/ogg; codecs=opus',
    mediaUrl: 'https://media.local/voice/123.ogg',
  } as Parameters<typeof processMessageV2>[0];
}

describe('P1-6: voice transcript precedes routing', () => {
  it('routes and extracts slots from the transcript, not the empty message', async () => {
    mockHandleVoiceNote.mockResolvedValue({
      transcript: 'jalan rusak parah di RT 01 RW 02 mohon diperbaiki',
    } as never);

    const result = await processMessageV2(voiceInput());
    expect(result.success).toBe(true);
    expect(captured.length).toBe(1);
    // The agent loop received the transcript…
    expect(captured[0].message).toContain('[transkrip voice note]');
    expect(captured[0].message).toContain('jalan rusak parah di RT 01 RW 02');
    // …and routing saw it too: a complaint transcript routes to COLLECT,
    // which an empty placeholder message would never do.
    expect(captured[0].stage).toBe('COLLECT');
  });

  it('an informational transcript routes to INFORMATION', async () => {
    mockHandleVoiceNote.mockResolvedValue({
      transcript: 'info jam layanan kantor desa',
    } as never);

    await processMessageV2(voiceInput());
    expect(captured.length).toBe(1);
    expect(captured[0].message).toContain('info jam layanan kantor desa');
    expect(captured[0].stage).toBe('INFORMATION');
  });

  it('whisper-unavailable still returns the deterministic fallback', async () => {
    mockHandleVoiceNote.mockResolvedValue({
      reply: 'Maaf, saya belum bisa mendengarkan voice note. Silakan ketik pesan Anda.',
    } as never);

    const result = await processMessageV2(voiceInput());
    expect(result.success).toBe(false);
    expect(result.intent).toBe('voice_note_unsupported');
    expect(captured.length).toBe(0);
  });
});
