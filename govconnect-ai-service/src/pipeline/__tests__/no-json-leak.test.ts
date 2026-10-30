/**
 * P0-3 — no raw JSON / debug structures may ever reach the citizen as a chat reply.
 *
 * Covers:
 * 1. `outbound-sanitizer`: the central guard (looksLikeRawJson + sanitizeOutboundText).
 * 2. `tool-result-text`: toolResultToUserText never returns raw JSON.
 * 3. `tool-executor`: the tool-exception path yields a natural-language
 *    suggested_response (no stack, no JSON dump of internals).
 * 4. `fallback-policy`: buildFallback responses are natural language.
 * 5. `processMessageV2` choke: a raw-JSON response leaving the pipeline is
 *    substituted with a friendly copy (integration through the R6 block).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// --- 3. tool-executor error path: force dispatchTool to throw by making
// getComplaintTypes (no internal try/catch in the tool) reject with a
// scary-looking error. The citizen-facing output must stay natural.
vi.mock('../../services/case-client.service', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/case-client.service')>();
  return {
    ...mod,
    getComplaintTypes: vi.fn(async () => {
      throw new Error('db exploded\n    at Query.run (node:internal/pg:123:45)\n    at async getComplaintTypes');
    }),
  };
});

// --- 5. processMessageV2 choke: mock the staged agent so the turn returns a
// raw-JSON reply, and route deterministically (no LLM assessor).
vi.mock('../staged-agent', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../staged-agent')>();
  return {
    ...mod,
    runStagedTurn: vi.fn(async () => ({
      terminalState: 'SUCCEEDED' as const,
      response: '{"success":false,"error":"db exploded","stack":"at fake (x.js:1:1)"}',
      stage: 'INFORMATION' as const,
      intent: 'information',
      toolsUsed: ['get_complaint_categories'],
      toolTrace: [],
      degraded: false,
      durationMs: 12,
      assessorCalls: 0,
    })),
  };
});
vi.mock('../stage-router', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../stage-router')>();
  return {
    ...mod,
    routeMessage: vi.fn(() => ({
      stage: 'INFORMATION',
      source: 'deterministic',
      confidence: 1,
      reasons: ['test-json-leak'],
      hints: {},
    })),
  };
});
vi.mock('../../gateway/tool-gateway', () => ({
  gatewayExecute: vi.fn(),
}));
vi.mock('../../services/ai-gateway.service', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/ai-gateway.service')>();
  return {
    ...mod,
    callAIGatewayPrompt: vi.fn(),
  };
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
vi.mock('../takeover', () => ({
  isTakeoverActive: vi.fn(async () => ({ active: false })),
}));
vi.mock('../../security/canary-docs', () => ({
  checkOutboundForCanary: vi.fn(async () => ({ leaked: false, labels: [] as string[] })),
  CANARY_SAFE_REPLY: 'SAFE_REPLY_STATIC',
}));
vi.mock('../semantic-cache', () => ({
  semanticCacheLookup: vi.fn(async () => null),
  semanticCacheStore: vi.fn(async () => undefined),
}));

import { looksLikeRawJson, sanitizeOutboundText, RAW_JSON_SUBSTITUTE_COPY } from '../outbound-sanitizer';
import { toolResultToUserText } from '../tool-result-text';
import { executeToolCall } from '../../services/agent/tool-executor';
import { buildFallback } from '../fallback-policy';
import { processMessageV2 } from '../process-message-v2';

const NATURAL = 'Halo! Saya Gana, asisten AI layanan Desa. Ada yang bisa saya bantu?';

describe('P0-3 looksLikeRawJson', () => {
  it('flags a full JSON object reply', () => {
    expect(looksLikeRawJson('{"success":false,"error":"x"}')).toBe(true);
  });
  it('flags a pretty-printed JSON object', () => {
    expect(looksLikeRawJson('{\n  "success": true,\n  "data": {}\n}')).toBe(true);
  });
  it('flags a full JSON array reply', () => {
    expect(looksLikeRawJson('[{"a":1},{"a":2}]')).toBe(true);
  });
  it('does not flag natural language', () => {
    expect(looksLikeRawJson(NATURAL)).toBe(false);
  });
  it('does not flag text that merely contains braces mid-sentence', () => {
    expect(looksLikeRawJson('Untuk info {layanan} desa, hubungi kantor ya.')).toBe(false);
  });
  it('does not flag malformed JSON', () => {
    expect(looksLikeRawJson('{"unclosed": true')).toBe(false);
    expect(looksLikeRawJson('{bukan json}')).toBe(false);
  });
  it('does not flag empty / short text', () => {
    expect(looksLikeRawJson('')).toBe(false);
    expect(looksLikeRawJson('{')).toBe(false);
  });
  it('flags even an empty JSON object as a leak', () => {
    expect(looksLikeRawJson('{}')).toBe(true);
  });
  it('does not flag ticket references and markdown', () => {
    expect(looksLikeRawJson('Nomor referensi sementara Anda: *LAP-20260101-001*.')).toBe(false);
  });
});

describe('P0-3 sanitizeOutboundText (central guard)', () => {
  it('substitutes a raw-JSON reply with the natural-language copy', () => {
    const out = sanitizeOutboundText('{"success":false,"error":"db exploded"}');
    expect(out.substituted).toBe(true);
    expect(out.text).toBe(RAW_JSON_SUBSTITUTE_COPY);
    expect(looksLikeRawJson(out.text)).toBe(false);
    expect(out.text).not.toContain('{');
  });
  it('substitutes a raw-JSON array reply', () => {
    const out = sanitizeOutboundText('[{"tool":"x"}]');
    expect(out.substituted).toBe(true);
    expect(out.text.length).toBeGreaterThan(0);
  });
  it('passes natural language through untouched', () => {
    const out = sanitizeOutboundText(NATURAL);
    expect(out.substituted).toBe(false);
    expect(out.text).toBe(NATURAL);
  });
  it('never returns empty (never-silent)', () => {
    const out = sanitizeOutboundText('   ');
    expect(out.substituted).toBe(true);
    expect(out.text.trim().length).toBeGreaterThan(0);
    expect(looksLikeRawJson(out.text)).toBe(false);
  });
});

describe('P0-3 toolResultToUserText', () => {
  const FALLBACK = 'Berhasil diproses. Petugas desa akan menindaklanjuti.';
  it('prefers the top-level suggested_response', () => {
    expect(
      toolResultToUserText({ success: true, suggested_response: 'Ini jawabannya.' }, FALLBACK),
    ).toBe('Ini jawabannya.');
  });
  it('prefers a nested suggested_response inside data', () => {
    expect(
      toolResultToUserText(
        { success: true, data: { contacts: [{ a: 1 }], suggested_response: 'Kontak: Damkar 113.' } },
        FALLBACK,
      ),
    ).toBe('Kontak: Damkar 113.');
  });
  it('falls back (never JSON) when the result is data-only', () => {
    const out = toolResultToUserText(
      { success: true, data: { categories: [{ name: 'x' }], total: 1 } },
      FALLBACK,
    );
    expect(out).toBe(FALLBACK);
    expect(looksLikeRawJson(out)).toBe(false);
  });
  it('falls back for undefined / empty results', () => {
    expect(toolResultToUserText(undefined, FALLBACK)).toBe(FALLBACK);
    expect(toolResultToUserText({ success: false, suggested_response: '   ' }, FALLBACK)).toBe(FALLBACK);
  });
});

describe('P0-3 tool-executor exception path', () => {
  it('maps a throwing tool to natural-language output (no stack, no raw dump)', async () => {
    const res = await executeToolCall(
      'get_complaint_categories',
      {},
      { userId: 'u1', channel: 'webchat' } as never,
    );
    expect(res.result.success).toBe(false);
    // error is a stable code, not the raw exception text
    expect(res.result.error).toMatch(/^tool_failed:get_complaint_categories$/);
    expect(res.result.error).not.toContain('at Query.run');
    // the citizen-facing text is natural language
    const reply = res.result.suggested_response ?? '';
    expect(reply.length).toBeGreaterThan(0);
    expect(looksLikeRawJson(reply)).toBe(false);
    expect(reply).not.toContain('"stack"');
    expect(reply).not.toContain('at Query.run');
    expect(reply).toMatch(/maaf/i);
  });
});

describe('P0-3 fallback-policy responses', () => {
  it('buildFallback produces natural language, never raw JSON', () => {
    const { response } = buildFallback({
      stage: 'INFORMATION',
      terminalState: 'FAILED',
      userId: 'u1',
      traceId: 't1',
      intentHint: 'information',
      error: '{"weird":"error object"}',
    });
    expect(looksLikeRawJson(response)).toBe(false);
    expect(response).toMatch(/mohon maaf/i);
    expect(response).not.toContain('"weird"');
  });
});

describe('P0-3 processMessageV2 outbound choke (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('substitutes a raw-JSON turn reply before it leaves the pipeline', async () => {
    const res = await processMessageV2({
      userId: '6281',
      villageId: 'v1',
      message: 'halo',
      channel: 'whatsapp',
      messageId: 'mid-json-1',
    });
    expect(looksLikeRawJson(res.response ?? '')).toBe(false);
    expect(res.response).toBe(RAW_JSON_SUBSTITUTE_COPY);
    expect((res.metadata as Record<string, unknown> | undefined)?.rawJsonBlocked).toBe(true);
  });

  it('leaves a natural-language turn reply untouched', async () => {
    const { runStagedTurn } = await import('../staged-agent');
    vi.mocked(runStagedTurn).mockResolvedValueOnce({
      terminalState: 'SUCCEEDED' as const,
      response: NATURAL,
      stage: 'INFORMATION' as const,
      intent: 'information',
      toolsUsed: [],
      toolTrace: [],
      degraded: false,
      durationMs: 5,
      assessorCalls: 0,
    });
    const res = await processMessageV2({
      userId: '6281',
      villageId: 'v1',
      message: 'halo',
      channel: 'whatsapp',
      messageId: 'mid-json-2',
    });
    expect(res.response).toBe(NATURAL);
    expect((res.metadata as Record<string, unknown> | undefined)?.rawJsonBlocked).toBeUndefined();
  });
});
