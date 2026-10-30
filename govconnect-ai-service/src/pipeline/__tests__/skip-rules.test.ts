/**
 * Tests for R8 skip rules.
 *
 * - "DB hit → skip RAG": the static system prompt carries the rule (the
 *   relevance judgment "sudah menjawab" needs the model — a hard
 *   deterministic block on "DB returned non-empty" would be unsafe because
 *   non-empty ≠ relevant). Compliance is measured via the
 *   `rag_after_db_hit` telemetry emitted when RAG runs after a successful
 *   DB read in the same turn.
 * - "cache hit → skip LLM": already implemented at the pipeline boundary
 *   (process-message-v2 §2b returns the cached answer before runStagedTurn);
 *   covered by the semantic-cache tests.
 * - STATUS_CHECK: its tool allowlist contains no RAG tools at all
 *   ({check_status, get_my_history}), so the skip is structural.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/ai-gateway.service', () => ({
  callAIGatewayPrompt: vi.fn(),
}));
vi.mock('../../gateway/tool-gateway', () => ({
  gatewayExecute: vi.fn(),
}));
vi.mock('../../lib/prisma', () => ({ default: null }));
const infoSpy = vi.fn();
const warnSpy = vi.fn();
vi.mock('../../utils/logger', () => ({
  default: {
    info: (...args: unknown[]) => infoSpy(...args),
    warn: (...args: unknown[]) => warnSpy(...args),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { callAIGatewayPrompt } from '../../services/ai-gateway.service';
import { gatewayExecute } from '../../gateway/tool-gateway';
import { buildStaticSystemPrompt } from '../prompt-builder';
import { STAGE_TOOL_ALLOWLIST } from '../../gateway/tool-policy';
import { runStagedTurn, type StagedAgentInput } from '../staged-agent';
import { createPipelineContext } from '../stage-types';

const mockPrompt = vi.mocked(callAIGatewayPrompt);
const mockGateway = vi.mocked(gatewayExecute);

function toolCallMsg(name: string, id: string) {
  return {
    text: '',
    message: {
      tool_calls: [
        { id, type: 'function', function: { name, arguments: '{}' } },
      ],
    },
    model: 'test-model',
    provider: 'test',
    metrics: {},
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

function okTool(name: string) {
  return {
    ok: true,
    blocked: false,
    trace: { tool: name, success: true, durationMs: 1 },
    result: { success: true, data: `hasil ${name}` },
  };
}

function stagedInput(): StagedAgentInput {
  return {
    message: 'jam layanan kantor desa?',
    decision: { stage: 'INFORMATION', source: 'deterministic', confidence: 1, reasons: ['test'] },
    ctx: createPipelineContext({
      traceId: 't-r8',
      userId: 'user-r8',
      tenantId: 'desa-1',
      channel: 'whatsapp',
      sideEffectMode: 'evaluation',
    }),
    villageName: 'Desa Test',
    language: 'id',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('R8: DB→skip RAG prompt rule', () => {
  it('static system prompt carries the skip rule', () => {
    const prompt = buildStaticSystemPrompt();
    expect(prompt).toContain('search_knowledge');
    expect(prompt).toContain('JANGAN panggil search_knowledge/search_documents');
  });

  it('STATUS_CHECK allowlist has no RAG tools (structural skip)', () => {
    const tools = [...STAGE_TOOL_ALLOWLIST['STATUS_CHECK']];
    expect(tools).not.toContain('search_knowledge');
    expect(tools).not.toContain('search_documents');
  });
});

describe('R8: rag_after_db_hit telemetry', () => {
  it('fires when RAG runs after a successful DB read in the same turn', async () => {
    mockPrompt
      .mockResolvedValueOnce(toolCallMsg('get_service_info', 'c1') as never)
      .mockResolvedValueOnce(toolCallMsg('search_knowledge', 'c2') as never)
      .mockResolvedValueOnce(finalMsg('Jam layanan 08.00–14.00.') as never);
    mockGateway.mockImplementation(async (name) => okTool(String(name)) as never);

    const res = await runStagedTurn(stagedInput());
    expect(res.terminalState).toBe('SUCCEEDED');
    expect(res.response).toContain('Jam layanan');
    const hits = infoSpy.mock.calls.filter((c) => c[0] === '[staged-agent] rag_after_db_hit');
    expect(hits.length).toBe(1);
    expect(hits[0][1]).toMatchObject({ tool: 'search_knowledge', traceId: 't-r8' });
  });

  it('does not fire when RAG runs without any prior DB hit', async () => {
    mockPrompt
      .mockResolvedValueOnce(toolCallMsg('search_knowledge', 'c1') as never)
      .mockResolvedValueOnce(finalMsg('Info dari dokumen.') as never);
    mockGateway.mockImplementation(async (name) => okTool(String(name)) as never);

    await runStagedTurn(stagedInput());
    const hits = infoSpy.mock.calls.filter((c) => c[0] === '[staged-agent] rag_after_db_hit');
    expect(hits.length).toBe(0);
  });

  it('does not fire when the DB read failed (no hit to skip after)', async () => {
    mockPrompt
      .mockResolvedValueOnce(toolCallMsg('get_service_info', 'c1') as never)
      .mockResolvedValueOnce(toolCallMsg('search_knowledge', 'c2') as never)
      .mockResolvedValueOnce(finalMsg('Info dari dokumen.') as never);
    mockGateway.mockImplementation(async (name) => {
      if (String(name) === 'get_service_info') {
        return { ok: false, blocked: false, trace: { tool: name, success: false, durationMs: 1 }, error: 'db_down' } as never;
      }
      return okTool(String(name)) as never;
    });

    await runStagedTurn(stagedInput());
    const hits = infoSpy.mock.calls.filter((c) => c[0] === '[staged-agent] rag_after_db_hit');
    expect(hits.length).toBe(0);
  });
});
