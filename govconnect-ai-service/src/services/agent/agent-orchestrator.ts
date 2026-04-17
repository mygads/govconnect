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
import { resolveLearnedToolPolicy } from './tool-policy.service';
import { executeToolCall, type ToolExecutionTrace } from './tool-executor';
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

export interface AgentResult {
  replyText: string;
  toolsUsed: string[];
  heuristicTools: AgentToolName[];
  learnedTools: AgentToolName[];
  allowedToolNames: AgentToolName[];
  matchedPolicyKey?: string;
  matchedPolicySource?: string;
  matchedPolicyConfidence?: number;
  toolTrace: ToolExecutionTrace[];
  totalTokens: number;
  iterations: number;
  model: string;
  durationMs: number;
}

interface ToolContext {
  userId: string;
  villageId?: string;
  channel: 'whatsapp' | 'webchat';
  isEvaluation?: boolean;
}

interface ConversationContext {
  summary?: string;
  recentMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Run the agent loop for a single user message.
 */
export async function runAgent(
  userMessage: string,
  promptCtx: AgentPromptContext,
  toolCtx: ToolContext,
  conversationCtx: ConversationContext = {},
): Promise<AgentResult> {
  const startTime = Date.now();
  const systemPrompt = buildAgentSystemPrompt(promptCtx);
  const toolSelection = await selectAllowedTools(userMessage);
  const {
    heuristicTools,
    learnedTools,
    allowedToolNames,
    matchedPolicyKey,
    matchedPolicySource,
    matchedPolicyConfidence,
  } = toolSelection;
  const allowedTools = AGENT_TOOLS.filter((tool) => allowedToolNames.includes(tool.function.name as AgentToolName));

  const messages: AgentMessage[] = [{ role: 'system', content: systemPrompt }];

  if (conversationCtx.summary) {
    messages.push({
      role: 'assistant',
      content: `[Ringkasan konteks percakapan sebelumnya]\n${conversationCtx.summary}`,
    });
  }

  for (const historyMessage of conversationCtx.recentMessages || []) {
    messages.push({
      role: historyMessage.role,
      content: historyMessage.content,
    });
  }

  messages.push({ role: 'user', content: userMessage });

  const toolsUsed: string[] = [];
  const toolTrace: ToolExecutionTrace[] = [];
  let totalTokens = 0;
  let iterations = 0;
  let model = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    iterations = i + 1;

    const response = await callLLMWithTools(messages, allowedTools);
    if (!response) {
      return {
        replyText: 'Maaf, terjadi gangguan pada sistem. Silakan coba lagi nanti.',
        toolsUsed,
        heuristicTools,
        learnedTools,
        allowedToolNames,
        matchedPolicyKey,
        matchedPolicySource,
        matchedPolicyConfidence,
        toolTrace,
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
          toolTrace.push(result.trace);

          return {
            role: 'tool' as const,
            tool_call_id: tc.id,
            name: toolName,
            content: result.content,
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
        allowedToolNames,
        matchedPolicyKey,
        matchedPolicySource,
        matchedPolicyConfidence,
        toolTrace,
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
        heuristicTools,
        learnedTools,
        allowedToolNames,
        matchedPolicyKey,
        matchedPolicySource,
        matchedPolicyConfidence,
        toolTrace,
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
    allowedToolNames,
    matchedPolicyKey,
    matchedPolicySource,
    userId: toolCtx.userId,
  });

  return {
    replyText: 'Maaf, saya membutuhkan waktu lebih lama untuk memproses permintaan ini. Silakan coba lagi.',
    toolsUsed,
    heuristicTools,
    learnedTools,
    allowedToolNames,
    matchedPolicyKey,
    matchedPolicySource,
    matchedPolicyConfidence,
    toolTrace,
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
  tools: typeof AGENT_TOOLS,
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
    temperature: 0.3,
    max_tokens: 1500,
    stream: false,
  };

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

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

async function selectAllowedTools(userMessage: string): Promise<{
  heuristicTools: AgentToolName[];
  learnedTools: AgentToolName[];
  allowedToolNames: AgentToolName[];
  matchedPolicyKey?: string;
  matchedPolicySource?: string;
  matchedPolicyConfidence?: number;
}> {
  const normalized = userMessage.toLowerCase().trim();
  const heuristicSet = new Set<AgentToolName>();
  const hasReference = /\b(?:lap|lay|lyn|rpt)-[\w-]+\b/i.test(userMessage);
  const isGreetingOnly = /^(halo|hai|hi|hello|assalamualaikum|permisi|p|selamat (pagi|siang|sore|malam))[\s!.,?]*$/i.test(userMessage);

  if (isGreetingOnly) {
    return {
      heuristicTools: [],
      learnedTools: [],
      allowedToolNames: [],
    };
  }

  const add = (...names: AgentToolName[]) => names.forEach((name) => heuristicSet.add(name));

  if (/\b(riwayat|history|laporan saya|permohonan saya|pengajuan saya)\b/i.test(normalized)) {
    add('get_my_history', 'search_user_memory');
  }

  if (/\b(sebelumnya|tadi|terakhir|alamat saya|preferensi saya|yang pernah saya|saya pernah)\b/i.test(normalized)) {
    add('search_user_memory');
  }

  if (/\b(batal|batalkan|cancel)\b/i.test(normalized)) {
    add('cancel_request', 'check_status');
  }

  if (hasReference && /\b(status|cek|periksa|tracking|lacak)\b/i.test(normalized)) {
    add('check_status');
  }

  if (/\b(edit|ubah data|perbaiki data|revisi data)\b/i.test(normalized) && /\b(lay|lyn)-[\w-]+\b/i.test(userMessage)) {
    add('get_service_request_edit_link', 'check_status');
  }

  if (/\b(ubah laporan|update laporan|perbarui laporan|tambah keterangan|ubah alamat|update pengaduan|revisi laporan)\b/i.test(normalized)
    && /\blap-[\w-]+\b/i.test(userMessage)) {
    add('update_complaint', 'check_status');
  }

  if (/\b(alamat|lokasi|maps|gmaps|jam buka|jam operasional|kontak|nomor kantor|telepon kantor|kantor desa)\b/i.test(normalized)) {
    add('get_village_profile');
  }

  if (/\b(darurat|ambulans|pemadam|polisi|nomor darurat|kontak penting)\b/i.test(normalized)) {
    add('get_emergency_contacts');
  }

  if (/\b(lapor|pengaduan|keluhan|jalan rusak|jalan berlubang|lampu mati|sampah|drainase|banjir|pohon tumbang|fasilitas rusak)\b/i.test(normalized)) {
    add('create_complaint', 'get_complaint_categories');
  }

  if (/\b(surat|layanan|dokumen|syarat|persyaratan|biaya|proses|ktp|kk|sktm|domisili|akta|pindah|kelahiran|kematian)\b/i.test(normalized)) {
    add('get_service_info', 'create_service_request');
  }

  if (/\b(pdf|dokumen|lampiran|berkas|sop|peraturan|sk|surat keputusan|file)\b/i.test(normalized)) {
    add('search_documents');
  }

  if (/\b(apa|bagaimana|kenapa|mengapa|kebijakan|prosedur|aturan|faq|panduan)\b/i.test(normalized)) {
    add('search_knowledge');
  }

  if (heuristicSet.size === 0) {
    add(
      'get_village_profile',
      'get_service_info',
      'search_knowledge',
      'search_documents',
      'check_status',
      'get_complaint_categories',
    );
  }

  const heuristicTools = Array.from(heuristicSet);
  const learnedPolicy = await resolveLearnedToolPolicy(userMessage);
  const learnedTools = learnedPolicy.tools || [];
  const allowedToolNames = Array.from(new Set<AgentToolName>([
    ...heuristicTools,
    ...learnedTools,
  ]));

  return {
    heuristicTools,
    learnedTools,
    allowedToolNames,
    matchedPolicyKey: learnedPolicy.matchedPolicyKey,
    matchedPolicySource: learnedPolicy.matchedPolicySource,
    matchedPolicyConfidence: learnedPolicy.confidence,
  };
}
