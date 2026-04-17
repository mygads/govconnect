/**
 * Agent Orchestrator — function-calling loop for single-agent architecture.
 *
 * Fase 2.3: Implements the core agent loop:
 * 1. Send system prompt + tools + user message to LLM
 * 2. If LLM returns tool_calls → execute them → feed results back
 * 3. Loop until LLM returns final text (max iterations for safety)
 *
 * Uses OpenAI-compatible /chat/completions with tools parameter.
 */

import logger from '../../utils/logger';
import { config } from '../../config/env';
import { getDefaultGatewayModels } from '../ai-gateway.service';
import { recordTokenUsage } from '../token-usage.service';
import { AGENT_TOOLS, type AgentToolName } from './tool-definitions';
import { executeToolCall, type ToolCallResult } from './tool-executor';
import { buildAgentSystemPrompt, type AgentPromptContext } from './agent-prompt';

const MAX_TOOL_ITERATIONS = 5;
const AGENT_TIMEOUT_MS = 30_000;

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ToolCallUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface AgentResult {
  replyText: string;
  toolsUsed: string[];
  totalTokens: number;
  iterations: number;
  model: string;
  durationMs: number;
}

interface ToolContext {
  userId: string;
  villageId?: string;
  channel: 'whatsapp' | 'webchat';
}

/**
 * Run the agent loop for a single user message.
 */
export async function runAgent(
  userMessage: string,
  promptCtx: AgentPromptContext,
  toolCtx: ToolContext,
): Promise<AgentResult> {
  const startTime = Date.now();
  const systemPrompt = buildAgentSystemPrompt(promptCtx);

  const messages: AgentMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const toolsUsed: string[] = [];
  let totalTokens = 0;
  let iterations = 0;
  let model = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    iterations = i + 1;

    const response = await callLLMWithTools(messages);
    if (!response) {
      return {
        replyText: 'Maaf, terjadi gangguan pada sistem. Silakan coba lagi nanti.',
        toolsUsed,
        totalTokens,
        iterations,
        model: model || 'unknown',
        durationMs: Date.now() - startTime,
      };
    }

    model = response.model || model;
    totalTokens += response.usage?.total_tokens ?? 0;

    const choice = response.choices?.[0];
    if (!choice) break;

    const assistantMsg = choice.message;

    // If finish_reason is 'tool_calls' or message has tool_calls, execute them
    if (assistantMsg?.tool_calls && assistantMsg.tool_calls.length > 0) {
      // Add the assistant message with tool_calls to history
      messages.push({
        role: 'assistant',
        content: assistantMsg.content as string | null,
        tool_calls: assistantMsg.tool_calls,
      });

      // Execute each tool call in parallel
      const toolResults = await Promise.all(
        assistantMsg.tool_calls.map(async (tc: ToolCall) => {
          const toolName = tc.function.name as AgentToolName;
          let args: Record<string, unknown> = {};

          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            logger.warn('Failed to parse tool arguments', { toolName, raw: tc.function.arguments });
          }

          toolsUsed.push(toolName);
          const result = await executeToolCall(toolName, args, toolCtx);

          return {
            role: 'tool' as const,
            tool_call_id: tc.id,
            name: toolName,
            content: result,
          };
        }),
      );

      // Add all tool results to message history
      for (const tr of toolResults) {
        messages.push(tr);
      }

      // Continue loop — LLM will process tool results
      continue;
    }

    // No tool_calls — this is the final text response
    const finalText = extractText(assistantMsg?.content);
    if (finalText) {
      const durationMs = Date.now() - startTime;

      logger.info('Agent completed', {
        iterations,
        toolsUsed,
        totalTokens,
        model,
        durationMs,
        userId: toolCtx.userId,
      });

      // Record token usage
      recordTokenUsage({
        model,
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
        duration_ms: durationMs,
        layer_type: 'agent',
        call_type: 'agent_orchestrator',
        wa_user_id: toolCtx.userId,
        channel: toolCtx.channel,
      });

      return {
        replyText: finalText,
        toolsUsed,
        totalTokens,
        iterations,
        model,
        durationMs,
      };
    }

    // Empty response — break
    break;
  }

  // Exhausted iterations or empty response
  logger.warn('Agent loop exhausted without final response', {
    iterations,
    toolsUsed,
    userId: toolCtx.userId,
  });

  return {
    replyText: 'Maaf, saya membutuhkan waktu lebih lama untuk memproses permintaan ini. Silakan coba lagi.',
    toolsUsed,
    totalTokens,
    iterations,
    model: model || 'unknown',
    durationMs: Date.now() - startTime,
  };
}

// ─── Internal helpers ───

function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('')
      .trim();
  }
  return '';
}

function getAgentGatewayConfig() {
  const laneConfig = config.llmGateway || config.aiGateway;
  return {
    baseUrl: laneConfig?.baseUrl || '',
    apiKey: laneConfig?.apiKeys?.[0] || '',
    provider: laneConfig?.provider || 'openrouter',
  };
}

function getAgentModels(): string[] {
  // Prefer full NLU models for agent (need strong function calling)
  return getDefaultGatewayModels('full');
}

async function callLLMWithTools(
  messages: AgentMessage[],
): Promise<any | null> {
  const gwConfig = getAgentGatewayConfig();
  if (!gwConfig.baseUrl || !gwConfig.apiKey) {
    logger.error('Agent gateway not configured');
    return null;
  }

  const models = getAgentModels();
  if (models.length === 0) {
    logger.error('No agent models configured');
    return null;
  }

  const model = models[0];

  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role };
      if (m.content !== undefined && m.content !== null) msg.content = m.content;
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.name) msg.name = m.name;
      return msg;
    }),
    tools: AGENT_TOOLS,
    tool_choice: 'auto',
    temperature: 0.3,
    max_tokens: 1500,
    stream: false,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

    const response = await fetch(`${gwConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gwConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger.error('Agent LLM call failed', {
        status: response.status,
        error: errText.substring(0, 200),
        model,
      });
      return null;
    }

    const data: any = await response.json();

    if (data.error) {
      logger.error('Agent LLM returned error', { error: data.error, model });
      return null;
    }

    return data;
  } catch (error: any) {
    logger.error('Agent LLM call exception', { error: error.message, model });
    return null;
  }
}
