/**
 * Eval harness — shared helpers for cases.
 *
 * IMPORTANT: the vi.mock() calls live in `__tests__/eval-harness.test.ts`
 * (vitest hoists them for the whole test file's module graph). This module
 * only wraps the mocked functions so cases can script LLM/tool behaviour.
 */
import { vi } from 'vitest';
import { gatewayExecute } from '../gateway/tool-gateway';
import { callAIGatewayPrompt, type GatewayPromptResult } from '../services/ai-gateway.service';
import { createPipelineContext, type PipelineContext } from '../pipeline/stage-types';
import type { ToolCallResult } from '../services/agent/tool-executor';

/** Thrown by `check()` on expectation mismatch. The runner maps it to FAIL. */
export class EvalAssertion extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalAssertion';
  }
}

/** Assert a condition; throws EvalAssertion with context on failure. */
export function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new EvalAssertion(message);
}

/** The mocked tool gateway — script per-tool behaviour in your case. */
export const mockGatewayExecute = () => vi.mocked(gatewayExecute);
/** The mocked LLM lane — script the model's replies per case. */
export const mockCallLlm = () => vi.mocked(callAIGatewayPrompt);

/** Evaluation-scoped pipeline context: no production writes (P1-1). */
export function evalContext(traceId: string): PipelineContext {
  return createPipelineContext({
    traceId,
    userId: 'eval-user',
    tenantId: 'eval-village',
    channel: 'whatsapp',
    isEvaluation: true,
    sideEffectMode: 'evaluation',
  });
}

export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Scripted LLM turn: plain final text, no tool calls. */
export function llmTextResult(text: string): GatewayPromptResult {
  return {
    text,
    message: { role: 'assistant', content: text },
    model: 'eval-mock',
    provider: 'mock',
    metrics: {},
  } as unknown as GatewayPromptResult;
}

/** Scripted LLM turn: OpenAI-style tool_calls the staged agent will parse. */
export function llmToolResult(calls: ScriptedToolCall[], text = ''): GatewayPromptResult {
  return {
    text,
    message: {
      role: 'assistant',
      content: text || null,
      tool_calls: calls.map((c, i) => ({
        id: `eval_call_${i}`,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    },
    model: 'eval-mock',
    provider: 'mock',
    metrics: {},
  } as unknown as GatewayPromptResult;
}

/** Mocked successful tool execution with a citizen-facing suggested_response. */
export function toolOk(tool: string, suggestedResponse: string, tenantId = 'eval-village') {
  return {
    ok: true as const,
    result: {
      success: true,
      suggested_response: suggestedResponse,
      village_id: tenantId,
    } as unknown as ToolCallResult,
    trace: { tool, success: true, durationMs: 5 },
  };
}
