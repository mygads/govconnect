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
import { callAIGatewayPrompt, type GatewayChatMessage } from '../ai-gateway.service';
import { AGENT_TOOLS, type AgentToolName } from './tool-definitions';
import { resolveLearnedToolPolicy } from './tool-policy.service';
import { executeToolCall, type ToolCallResult, type ToolExecutionTrace } from './tool-executor';
import { buildAgentSystemPrompt, type AgentPromptContext } from './agent-prompt';

const MAX_TOOL_ITERATIONS = 5;

type AgentToolChoice = 'auto' | 'required';

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
  guidanceText?: string;
  toolsUsed: string[];
  heuristicTools: AgentToolName[];
  learnedTools: AgentToolName[];
  allowedToolNames: AgentToolName[];
  matchedPolicyKey?: string;
  matchedPolicySource?: string;
  matchedPolicyConfidence?: number;
  toolPolicyReason: string;
  firstTurnToolChoice: AgentToolChoice;
  firstTurnToolChoiceReason: string;
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
  traceId?: string;
  isEvaluation?: boolean;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
}

interface AgentGatewayTokenContext {
  village_id?: string | null;
  wa_user_id?: string | null;
  channel?: 'whatsapp' | 'webchat' | null;
  trace_id?: string | null;
}

interface ConversationContext {
  summary?: string;
  recentMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function derivePreferredToolReply(
  toolResults: Array<{ toolName: AgentToolName; result: ToolCallResult }>,
): { replyText?: string; guidanceText?: string } {
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const result = toolResults[index]?.result;
    const payload = result?.data;
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const resultData = result as unknown as Record<string, unknown>;

    const replyText =
      readStringField(data, 'suggested_response')
      || readStringField(resultData, 'suggested_response')
      || readStringField(data, 'reply_text')
      || readStringField(data, 'replyText');
    const guidanceText =
      readStringField(data, 'guidance_text')
      || readStringField(resultData, 'guidance_text')
      || readStringField(data, 'guidanceText');

    if (replyText || guidanceText) {
      return { replyText, guidanceText };
    }
  }

  return {};
}

function parseTextToolCall(text: string, allowedToolNames: AgentToolName[]): { toolName: AgentToolName; args: Record<string, unknown> } | null {
  const functionMatch = text.match(/<function=([a-z_]+)>/i);
  if (!functionMatch) return null;

  const toolName = functionMatch[1] as AgentToolName;
  if (!allowedToolNames.includes(toolName)) return null;

  const args: Record<string, unknown> = {};
  const parameterPattern = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/gi;
  let parameterMatch: RegExpExecArray | null;
  while ((parameterMatch = parameterPattern.exec(text)) !== null) {
    args[parameterMatch[1]] = parameterMatch[2].trim();
  }

  return { toolName, args };
}

function validateFinalAgentReply(text: string, toolsUsed: string[]): string {
  const normalized = text.toLowerCase();
  if (/<tool_call>|<function=|<parameter=/i.test(text)) {
    return buildAgentFallbackReply('', toolsUsed);
  }

  if (/\b(ai|bot|llm|tool|prompt|retrieval|basis pengetahuan|dokumen internal)\b/i.test(text)) {
    return 'Maaf Pak/Bu, saya bantu jawab dari informasi layanan yang tersedia. Bisa sebutkan kebutuhan atau detail yang ingin dicek?';
  }

  const claimsActionSuccess = /\b(sudah|berhasil|telah)\b.*\b(dibuat|dikirim|dibatalkan|diubah|diperbarui|tercatat)\b/i.test(normalized);
  const usedActionTool = toolsUsed.some((tool) => [
    'create_complaint',
    'create_service_request',
    'update_complaint',
    'cancel_request',
    'get_service_request_edit_link',
  ].includes(tool));
  if (claimsActionSuccess && !usedActionTool) {
    return 'Saya belum bisa memastikan aksi itu sudah tercatat. Kirim detail atau nomor referensinya ya, nanti saya bantu cek langkah berikutnya.';
  }

  return text;
}
function buildAgentFallbackReply(userMessage: string, toolsUsed: string[] = []): string {
  const normalized = (userMessage || '').toLowerCase();
  const looksLikeStatus = /\b(lap|lay|lyn|rpt)-[\w-]+\b/i.test(userMessage);
  const looksLikeExternalAdminQuery =
    /\b(cara|bagaimana|gimana|mau bikin|buat|urus|pengurusan)\b/i.test(normalized)
    && /\b(sim|paspor|bpjs|visa|imigrasi|npwp|stnk|bpkb)\b/i.test(normalized);

  if (looksLikeExternalAdminQuery) {
    return 'Maaf Pak/Bu, informasi untuk layanan itu belum tersedia di sistem kami. Kalau perlu penjelasan lebih lanjut, silakan datang ke kantor desa pada jam kerja ya.';
  }

  if (!looksLikeStatus && (toolsUsed.includes('search_knowledge') || toolsUsed.includes('get_service_info'))) {
    return 'Maaf Pak/Bu, informasinya belum berhasil kami temukan sekarang. Untuk sementara, silakan datang ke kantor desa pada jam kerja atau kirim pertanyaan yang lebih spesifik ya.';
  }

  return 'Maaf, saya membutuhkan waktu lebih lama untuk memproses permintaan ini. Silakan coba lagi.';
}

function detectAmbiguousIntent(userMessage: string, heuristicTools: AgentToolName[], allowedToolNames: AgentToolName[]): boolean {
  const normalized = (userMessage || '').toLowerCase().trim();
  if (!normalized) return true;

  const hasReference = /\b(?:lap|lay|lyn|rpt)-[\w-]+\b/i.test(userMessage);
  const isGreetingOrShort =
    /^(halo|hai|hi|hello|assalamualaikum|permisi|p|terima kasih|makasih|thanks)[\s!.,?]*$/i.test(normalized)
    || normalized.split(/\s+/).length <= 2;
  const hasAmbiguousCue = /\b(gimana|bagaimana|tolong bantu|mau (urus|lapor)|bingung|itu gimana)\b/i.test(normalized);

  const hasClearServiceIntent =
    /\b(surat|layanan|ktp|kk|akta|domisili|sktm|pengantar|dokumen)\b/i.test(normalized)
    && /\b(mau|ingin|buat|ajukan|urus|syarat|persyaratan|biaya|proses|cara)\b/i.test(normalized);
  const hasClearComplaintIntent =
    /\b(lapor|pengaduan|keluhan|aduan)\b/i.test(normalized)
    && /\b(jalan rusak|jalan berlubang|lampu mati|sampah|drainase|banjir|pohon tumbang|fasilitas rusak)\b/i.test(normalized);
  const hasStatusOrMutationIntent =
    hasReference
    && /\b(cek|status|tracking|lacak|batal|batalkan|cancel|ubah|update|edit|revisi)\b/i.test(normalized);

  if (isGreetingOrShort && !hasReference) return true;
  if (heuristicTools.length === 0) return true;
  if (hasStatusOrMutationIntent) return false;
  if (hasClearServiceIntent && !hasAmbiguousCue) return false;
  if (hasClearComplaintIntent && !hasAmbiguousCue) return false;
  if (hasAmbiguousCue && !hasReference && !hasClearServiceIntent && !hasClearComplaintIntent) return true;

  const actionTools: AgentToolName[] = [
    'create_complaint',
    'create_service_request',
    'update_complaint',
    'cancel_request',
    'get_service_request_edit_link',
  ];
  const lookupTools: AgentToolName[] = [
    'search_knowledge',
    'search_documents',
    'get_service_info',
    'get_village_profile',
    'get_emergency_contacts',
  ];

  const includesActionTool = allowedToolNames.some((tool) => actionTools.includes(tool));
  const includesLookupTool = allowedToolNames.some((tool) => lookupTools.includes(tool));

  return includesActionTool && includesLookupTool && !hasReference && !hasClearServiceIntent && !hasClearComplaintIntent;
}

function resolveFirstTurnToolChoice(
  userMessage: string,
  heuristicTools: AgentToolName[],
  allowedToolNames: AgentToolName[],
  allowedToolsCount: number,
): { choice: AgentToolChoice; reason: string } {
  if (allowedToolsCount === 0) {
    return {
      choice: 'auto',
      reason: 'no_allowed_tools',
    };
  }

  const normalized = (userMessage || '').toLowerCase().trim();
  const shortAmbiguousUtterance = normalized.split(/\s+/).filter(Boolean).length <= 3
    && /\b(mau|ingin|tolong|bantu|lapor|urus|gimana|bagaimana|bingung|info|status)\b/i.test(normalized)
    && !/\b(?:lap|lay|lyn|rpt)-[\w-]+\b/i.test(userMessage);
  if (shortAmbiguousUtterance) {
    return {
      choice: 'auto',
      reason: 'short_ambiguous_utterance',
    };
  }

  const hasKnowledgeOnlySignal = /\b(govconnect|kanal|whatsapp|webchat|5w1h|embedding|kebijakan data|penggunaan data|keamanan data|privasi|notifikasi|tahap layanan|layanan umum|pelayanan publik|alur layanan|format file|file terlalu besar|penamaan file|update data|memperbarui data|salah pilih layanan|nomor layanan|lay-)\b/i.test(normalized);
  const hasRetrievalTool = allowedToolNames.some((tool) => tool === 'search_knowledge' || tool === 'search_documents');

  if (hasKnowledgeOnlySignal && hasRetrievalTool) {
    return {
      choice: 'required',
      reason: 'knowledge_query_with_retrieval_tools',
    };
  }

  const ambiguous = detectAmbiguousIntent(userMessage, heuristicTools, allowedToolNames);
  return {
    choice: ambiguous ? 'auto' : 'required',
    reason: ambiguous ? 'ambiguous_or_multi_intent' : 'clear_operational_or_factual_intent',
  };
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
    allowedToolNames: selectedAllowedToolNames,
    matchedPolicyKey,
    matchedPolicySource,
    matchedPolicyConfidence,
    toolPolicyReason,
  } = toolSelection;
  const knowledgeTestToolAllowlist = new Set<AgentToolName>([
    'get_village_profile',
    'get_service_info',
    'get_complaint_categories',
    'get_emergency_contacts',
    'search_knowledge',
    'search_documents',
  ]);
  const allowedToolNames = toolCtx.sideEffectMode === 'knowledge_test'
    ? selectedAllowedToolNames.filter((tool) => knowledgeTestToolAllowlist.has(tool))
    : selectedAllowedToolNames;
  const allowedTools = AGENT_TOOLS.filter((tool) => allowedToolNames.includes(tool.function.name as AgentToolName));
  const firstTurnToolResolution = resolveFirstTurnToolChoice(
    userMessage,
    heuristicTools,
    allowedToolNames,
    allowedTools.length,
  );
  const firstTurnToolChoice = firstTurnToolResolution.choice;
  const firstTurnToolChoiceReason = firstTurnToolResolution.reason;

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
  let preferredReplyText: string | undefined;
  let preferredGuidanceText: string | undefined;
  const tokenContext = buildAgentGatewayTokenContext(toolCtx);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    iterations = i + 1;

    const toolChoice: AgentToolChoice = i === 0 ? firstTurnToolChoice : 'auto';
    const response = await callLLMWithTools(messages, allowedTools, toolChoice, tokenContext);
    if (!response) {
      return {
        replyText: buildAgentFallbackReply(userMessage, toolsUsed),
        toolsUsed,
        heuristicTools,
        learnedTools,
        allowedToolNames,
        matchedPolicyKey,
        matchedPolicySource,
        matchedPolicyConfidence,
        toolPolicyReason,
        firstTurnToolChoice,
        firstTurnToolChoiceReason,
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

    if (assistantMsg?.tool_calls && assistantMsg.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: assistantMsg.content as string | null,
        tool_calls: assistantMsg.tool_calls,
      });

      const toolResults: Array<{
        toolName: AgentToolName;
        result: ToolCallResult;
        role: 'tool';
        tool_call_id: string;
        name: AgentToolName;
        content: string;
      }> = [];

      for (const tc of assistantMsg.tool_calls as ToolCall[]) {
        const toolName = tc.function.name as AgentToolName;
        let args: Record<string, unknown>;

        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          logger.warn('Failed to parse tool arguments', { toolName, raw: tc.function.arguments });
          const result: ToolCallResult = {
            success: false,
            error: 'Invalid JSON arguments for tool call',
            meta: { trustLevel: 'action_result', sourceKind: 'tool_argument_error' },
          };
          toolTrace.push({
            tool: toolName,
            success: false,
            durationMs: 0,
            trustLevel: 'action_result',
            sourceKind: 'tool_argument_error',
          });
          toolResults.push({
            toolName,
            result,
            role: 'tool',
            tool_call_id: tc.id,
            name: toolName,
            content: JSON.stringify(result),
          });
          continue;
        }

        toolsUsed.push(toolName);
        const result = await executeToolCall(toolName, args, { ...toolCtx, userMessage });
        toolTrace.push(result.trace);

        toolResults.push({
          toolName,
          result: result.result,
          role: 'tool',
          tool_call_id: tc.id,
          name: toolName,
          content: result.content,
        });
      }


      for (const tr of toolResults) {
        const preferredFromTool = derivePreferredToolReply([{ toolName: tr.toolName, result: tr.result }]);
        if (preferredFromTool.replyText) {
          preferredReplyText = preferredFromTool.replyText;
        }
        if (preferredFromTool.guidanceText) {
          preferredGuidanceText = preferredFromTool.guidanceText;
        }
        messages.push(tr);
      }

      continue;
    }

    const finalText = extractText(assistantMsg?.content);
    const textToolCall = finalText ? parseTextToolCall(finalText, allowedToolNames) : null;
    if (textToolCall) {
      toolsUsed.push(textToolCall.toolName);
      const result = await executeToolCall(textToolCall.toolName, textToolCall.args, { ...toolCtx, userMessage });
      toolTrace.push(result.trace);

      const preferredFromTool = derivePreferredToolReply([{ toolName: textToolCall.toolName, result: result.result }]);
      if (preferredFromTool.replyText) {
        preferredReplyText = preferredFromTool.replyText;
      }
      if (preferredFromTool.guidanceText) {
        preferredGuidanceText = preferredFromTool.guidanceText;
      }

      messages.push({ role: 'assistant', content: finalText });
      messages.push({
        role: 'tool',
        tool_call_id: `text_tool_${i}`,
        name: textToolCall.toolName,
        content: result.content,
      });
      continue;
    }

    if (finalText) {
      const durationMs = Date.now() - startTime;

      logger.info('Agent completed', {
        iterations,
        toolsUsed,
        allowedToolNames,
        matchedPolicyKey,
        matchedPolicySource,
        matchedPolicyConfidence,
        toolPolicyReason,
        firstTurnToolChoice,
        firstTurnToolChoiceReason,
        toolTrace,
        totalTokens,
        model,
        durationMs,
        userId: toolCtx.userId,
      });

      return {
        replyText: validateFinalAgentReply(preferredReplyText || finalText, toolsUsed),
        guidanceText: preferredGuidanceText,
        toolsUsed,
        heuristicTools,
        learnedTools,
        allowedToolNames,
        matchedPolicyKey,
        matchedPolicySource,
        matchedPolicyConfidence,
        toolPolicyReason,
        firstTurnToolChoice,
        firstTurnToolChoiceReason,
        toolTrace,
        totalTokens,
        iterations,
        model,
        durationMs,
      };
    }

    break;
  }

  logger.warn('Agent loop exhausted without final response', {
    iterations,
    toolsUsed,
    allowedToolNames,
    matchedPolicyKey,
    matchedPolicySource,
    firstTurnToolChoice,
    userId: toolCtx.userId,
  });

  return {
    replyText: buildAgentFallbackReply(userMessage, toolsUsed),
    toolsUsed,
    heuristicTools,
    learnedTools,
    allowedToolNames,
    matchedPolicyKey,
    matchedPolicySource,
    matchedPolicyConfidence,
    toolPolicyReason,
    firstTurnToolChoice,
    firstTurnToolChoiceReason,
    toolTrace,
    totalTokens,
    iterations,
    model: model || 'unknown',
    durationMs: Date.now() - startTime,
  };
}

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

interface AgentGatewayResponse {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: ToolCall[];
    };
  }>;
}

function buildAgentGatewayTokenContext(toolCtx: ToolContext): AgentGatewayTokenContext {
  return {
    village_id: toolCtx.villageId ?? null,
    wa_user_id: toolCtx.channel === 'whatsapp' ? toolCtx.userId : null,
    channel: toolCtx.channel,
    trace_id: toolCtx.traceId ?? null,
  };
}

async function callLLMWithTools(
  messages: AgentMessage[],
  tools: typeof AGENT_TOOLS,
  toolChoice: AgentToolChoice,
  tokenContext: AgentGatewayTokenContext,
): Promise<AgentGatewayResponse | null> {
  const result = await callAIGatewayPrompt({
    lane: 'llm',
    modelPriority: [],
    messages: messages as GatewayChatMessage[],
    temperature: 0.3,
    maxTokens: 1500,
    timeoutMs: 30_000,
    layerType: 'agent',
    callType: 'agent_orchestrator',
    context: tokenContext,
    extraBody: tools.length > 0 ? { tools, tool_choice: toolChoice } : undefined,
  });


  if (!result) return null;

  return {
    model: result.model,
    usage: result.usage,
    choices: result.choices as AgentGatewayResponse['choices'],
  };
}

async function selectAllowedTools(userMessage: string): Promise<{
  heuristicTools: AgentToolName[];
  learnedTools: AgentToolName[];
  allowedToolNames: AgentToolName[];
  matchedPolicyKey?: string;
  matchedPolicySource?: string;
  matchedPolicyConfidence?: number;
  toolPolicyReason: string;
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
      toolPolicyReason: 'greeting_only_no_tools',
    };
  }

  const add = (...names: AgentToolName[]) => names.forEach((name) => heuristicSet.add(name));
  const isServiceEditRequest =
    /\b(edit|ubah data|update data|perbarui data|perbaiki data|revisi data)\b/i.test(normalized)
    && /\b(lay|lyn)-[\w-]+\b/i.test(userMessage);
  const isComplaintUpdateRequest =
    /\b(ubah laporan|update laporan|perbarui laporan|tambah keterangan|ubah alamat|update pengaduan|revisi laporan)\b/i.test(normalized)
    && /\blap-[\w-]+\b/i.test(userMessage);
  const isMyStatusLookup =
    !hasReference
    && /\b(status|cek|periksa|tracking|lacak)\b/i.test(normalized)
    && /\b(layanan|laporan|pengajuan|permohonan)\b/i.test(normalized)
    && /\b(saya|milik saya)\b/i.test(normalized);
  const hasComplaintGenericTerm = /\b(pengaduan|keluhan|laporan)\b/i.test(normalized);
  const isServiceInfoRequest =
    !isServiceEditRequest
    && !isMyStatusLookup
    && !/\b(tahap layanan umum|layanan umum|pelayanan publik|kanal pelayanan|status layanan\/pengaduan|notifikasi|salah pilih layanan|update data|memperbarui data|penamaan file|format file|file terlalu besar|penggunaan data|keamanan data)\b/i.test(normalized)
    && /\b(surat|layanan|dokumen|syarat|persyaratan|biaya|proses|ktp|kk|sktm|domisili|akta|pindah|kelahiran|kematian)\b/i.test(normalized);
  const isGeneralKnowledgeQuestion = /\b(apa|bagaimana|kenapa|mengapa|kebijakan|prosedur|aturan|faq|panduan)\b/i.test(normalized);
  const isComplaintKnowledgeRequest =
    hasComplaintGenericTerm && /\b(contoh|prioritas|checklist|sop|panduan|prosedur|alur|status|jelaskan|apa|bagaimana)\b/i.test(normalized);
  const isGenericKnowledgeStatusQuestion =
    !hasReference
    && !isMyStatusLookup
    && /\b(status|notifikasi|tahap|alur|kanal|5w1h|embedding)\b/i.test(normalized);
  const isMyHistoryRequest = /\b(riwayat|history|laporan saya|permohonan saya|pengajuan saya)\b/i.test(normalized);
  const isDocumentQuery = /\b(pdf|dokumen|lampiran|berkas|sop|peraturan|sk|surat keputusan|file)\b/i.test(normalized);
  const isVillageDocumentQuery = /\b(luas wilayah|luas desa|km2|batas wilayah|jumlah penduduk|sejarah desa|profil desa|visi|misi|rpjm|rencana pembangunan)\b/i.test(normalized);
  const isEmergencyQuery = /\b(darurat|ambulans|pemadam|polisi|nomor darurat|kontak penting)\b/i.test(normalized);
  const isVillageProfileQuery = /\b(alamat|lokasi|maps|gmaps|jam buka|jam operasional|kontak|nomor kantor|telepon kantor|kantor desa)\b/i.test(normalized);
  const isMemoryQuery = /\b(sebelumnya|tadi|terakhir|alamat saya|preferensi saya|yang pernah saya|saya pernah)\b/i.test(normalized);
  const isStatusByReference = hasReference && /\b(status|cek|periksa|tracking|lacak)\b/i.test(normalized);
  const isCancelIntent = /\b(batal|batalkan|cancel)\b/i.test(normalized);
  const hasComplaintIncidentKeyword = /\b(jalan rusak|jalan berlubang|lampu mati|sampah|drainase|banjir|pohon tumbang|fasilitas rusak|amblas|longsor|licin|gelap|bau menyengat|tersumbat)\b/i.test(normalized);
  const hasExplicitComplaintCreationIntent = /\b(mau lapor|ingin lapor|buat laporan|buat pengaduan|laporkan|saya lapor|aduan)\b/i.test(normalized);
  const hasComplaintLocationDetail = /\b(rt\s*\d+|rw\s*\d+|dekat|dusun|lorong|gang|jalan\s+[a-z0-9]|jl\.?\s+[a-z0-9]|patokan|pos ronda|nomor\s*rumah)\b/i.test(normalized);
  const isServiceLikeReport = /\blapor\b/i.test(normalized)
    && /\b(meninggal|kematian|lahir|kelahiran|pindah|nikah|cerai|ktp|kk|domisili|akta|sktm|surat)\b/i.test(normalized);
  const isComplaintActionQuestion =
    (hasExplicitComplaintCreationIntent || hasComplaintIncidentKeyword)
    && !/\b(apa|bagaimana|contoh|prioritas|checklist|sop|panduan|prosedur|alur|status)\b/i.test(normalized);
  const isKnowledgeOnlyQuestion =
    !isMyStatusLookup
    && !hasReference
    && !isServiceInfoRequest
    && !isServiceEditRequest
    && !isComplaintUpdateRequest
    && !isComplaintActionQuestion
    && /\b(govconnect|kanal|whatsapp|webchat|5w1h|embedding|kebijakan data|penggunaan data|keamanan data|privasi|notifikasi|tahap layanan|layanan umum|pelayanan publik|alur layanan|format file|file terlalu besar|penamaan file|update data|memperbarui data|salah pilih layanan|nomor layanan|lay-)\b/i.test(normalized);

  if (isMyHistoryRequest) {
    add('get_my_history', 'search_user_memory');
  }

  if (isMyStatusLookup) {
    add('get_my_history', 'search_user_memory');
  }

  if (isMemoryQuery) {
    add('search_user_memory');
  }

  if (isCancelIntent) {
    add('cancel_request', 'check_status');
  }

  if (isStatusByReference) {
    add('check_status');
  }

  if (isServiceEditRequest) {
    add('get_service_request_edit_link', 'check_status');
  }

  if (isComplaintUpdateRequest) {
    add('update_complaint', 'check_status');
  }

  if (isVillageProfileQuery) {
    add('get_village_profile');
  }

  if (isGenericKnowledgeStatusQuestion) {
    add('search_knowledge');
  }

  if (isVillageDocumentQuery) {
    add('search_documents');
  }

  if (isEmergencyQuery) {
    add('get_emergency_contacts');
  }

  if (isDocumentQuery) {
    add('search_documents');
    add('search_knowledge');
  }

  if (isGeneralKnowledgeQuestion) {
    add('search_knowledge');
  }

  if (isComplaintKnowledgeRequest) {
    add('search_knowledge');
  }

  if (isServiceInfoRequest) {
    add('get_service_info', 'create_service_request');
  }

  if (isMyStatusLookup) {
    heuristicSet.delete('search_knowledge');
    heuristicSet.delete('get_service_info');
    heuristicSet.delete('create_service_request');
  }

  if (isComplaintKnowledgeRequest) {
    heuristicSet.delete('create_complaint');
    heuristicSet.delete('get_complaint_categories');
  }

  if (isServiceInfoRequest) {
    heuristicSet.delete('search_knowledge');
  }

  if (isStatusByReference) {
    heuristicSet.delete('search_knowledge');
  }

  if (isCancelIntent) {
    heuristicSet.delete('search_knowledge');
  }

  if (isVillageProfileQuery) {
    heuristicSet.delete('search_knowledge');
  }

  if (isEmergencyQuery) {
    heuristicSet.delete('search_knowledge');
  }

  if (isVillageDocumentQuery) {
    heuristicSet.delete('search_knowledge');
  }

  if (isDocumentQuery) {
    heuristicSet.delete('get_service_info');
    heuristicSet.delete('create_service_request');
  }

  if (isMyHistoryRequest) {
    heuristicSet.delete('search_knowledge');
    heuristicSet.delete('get_service_info');
    heuristicSet.delete('create_service_request');
  }

  if (isComplaintKnowledgeRequest) {
    heuristicSet.delete('get_service_info');
    heuristicSet.delete('create_service_request');
  }

  if (isGenericKnowledgeStatusQuestion) {
    heuristicSet.delete('get_service_info');
    heuristicSet.delete('create_service_request');
  }

  if (isServiceInfoRequest) {
    heuristicSet.delete('get_my_history');
  }

  if (isStatusByReference) {
    heuristicSet.delete('get_my_history');
  }

  if (isCancelIntent) {
    heuristicSet.delete('get_my_history');
  }

  if (isVillageProfileQuery) {
    heuristicSet.delete('get_my_history');
  }

  if (isEmergencyQuery) {
    heuristicSet.delete('get_my_history');
  }

  if (isDocumentQuery || isVillageDocumentQuery) {
    heuristicSet.delete('get_my_history');
    heuristicSet.delete('search_user_memory');
  }

  if (isGenericKnowledgeStatusQuestion || isGeneralKnowledgeQuestion) {
    heuristicSet.delete('get_my_history');
  }

  if (isComplaintKnowledgeRequest) {
    heuristicSet.delete('get_my_history');
    heuristicSet.delete('search_user_memory');
  }

  if (isServiceInfoRequest) {
    heuristicSet.delete('search_user_memory');
  }

  if (isStatusByReference) {
    heuristicSet.delete('search_user_memory');
  }

  if (isCancelIntent) {
    heuristicSet.delete('search_user_memory');
  }

  if (isVillageProfileQuery || isEmergencyQuery) {
    heuristicSet.delete('search_user_memory');
  }

  if (isGenericKnowledgeStatusQuestion) {
    heuristicSet.delete('search_user_memory');
  }

  if (isMyStatusLookup) {
    heuristicSet.delete('check_status');
  }

  if (isServiceInfoRequest) {
    heuristicSet.delete('check_status');
  }

  if (isComplaintKnowledgeRequest) {
    heuristicSet.delete('check_status');
  }

  if (isDocumentQuery || isVillageDocumentQuery) {
    heuristicSet.delete('check_status');
  }

  if (isGeneralKnowledgeQuestion && !isComplaintKnowledgeRequest && !isGenericKnowledgeStatusQuestion) {
    heuristicSet.delete('check_status');
  }

  if (isVillageProfileQuery || isEmergencyQuery) {
    heuristicSet.delete('check_status');
  }

  if (isMyHistoryRequest) {
    heuristicSet.delete('check_status');
  }

  if (isMyStatusLookup) {
    heuristicSet.delete('cancel_request');
  }

  if (isServiceInfoRequest || isComplaintKnowledgeRequest || isDocumentQuery || isVillageDocumentQuery || isVillageProfileQuery || isEmergencyQuery) {
    heuristicSet.delete('cancel_request');
  }

  if (isGeneralKnowledgeQuestion && !isComplaintKnowledgeRequest && !isGenericKnowledgeStatusQuestion) {
    heuristicSet.delete('cancel_request');
  }

  if (isMyHistoryRequest) {
    heuristicSet.delete('cancel_request');
  }

  if (isMyStatusLookup || isServiceInfoRequest || isComplaintKnowledgeRequest || isGenericKnowledgeStatusQuestion) {
    heuristicSet.delete('get_service_request_edit_link');
    heuristicSet.delete('update_complaint');
  }

  if (isDocumentQuery || isVillageDocumentQuery || isVillageProfileQuery || isEmergencyQuery) {
    heuristicSet.delete('get_service_request_edit_link');
    heuristicSet.delete('update_complaint');
  }

  if (isMyHistoryRequest) {
    heuristicSet.delete('get_service_request_edit_link');
    heuristicSet.delete('update_complaint');
  }

  if (isGeneralKnowledgeQuestion && !isComplaintKnowledgeRequest && !isGenericKnowledgeStatusQuestion) {
    heuristicSet.delete('get_service_request_edit_link');
    heuristicSet.delete('update_complaint');
  }

  if (isComplaintKnowledgeRequest || isGeneralKnowledgeQuestion || isDocumentQuery || isVillageDocumentQuery || isVillageProfileQuery || isEmergencyQuery || isMyHistoryRequest || isMyStatusLookup) {
    heuristicSet.delete('create_service_request');
  }

  if ((isServiceInfoRequest || isGeneralKnowledgeQuestion || isDocumentQuery || isVillageDocumentQuery || isVillageProfileQuery || isEmergencyQuery || isMyHistoryRequest || isMyStatusLookup || isGenericKnowledgeStatusQuestion) && !(hasComplaintIncidentKeyword && hasComplaintLocationDetail) && !hasExplicitComplaintCreationIntent) {
    heuristicSet.delete('create_complaint');
    heuristicSet.delete('get_complaint_categories');
  }

  if (isComplaintKnowledgeRequest || isServiceInfoRequest || isMyHistoryRequest || isMyStatusLookup || isGenericKnowledgeStatusQuestion || isVillageProfileQuery || isEmergencyQuery) {
    heuristicSet.delete('search_documents');
  }

  if (isVillageDocumentQuery || isDocumentQuery) {
    heuristicSet.delete('get_village_profile');
    heuristicSet.delete('get_emergency_contacts');
  }

  if (isEmergencyQuery) {
    heuristicSet.delete('get_village_profile');
  }

  if (isVillageProfileQuery) {
    heuristicSet.delete('get_emergency_contacts');
  }

  if (isMyStatusLookup) {
    heuristicSet.delete('get_village_profile');
    heuristicSet.delete('get_emergency_contacts');
  }

  if (isComplaintKnowledgeRequest) {
    heuristicSet.delete('search_documents');
  }

  if (isServiceInfoRequest) {
    heuristicSet.delete('search_documents');
  }

  if (isGeneralKnowledgeQuestion && !isComplaintKnowledgeRequest && !isDocumentQuery && !isVillageDocumentQuery && !isGenericKnowledgeStatusQuestion) {
    heuristicSet.delete('search_documents');
  }

  if (isGenericKnowledgeStatusQuestion) {
    heuristicSet.delete('search_documents');
  }

  if (isKnowledgeOnlyQuestion) {
    add('search_knowledge');
    heuristicSet.delete('get_service_info');
    heuristicSet.delete('create_service_request');
    heuristicSet.delete('create_complaint');
    heuristicSet.delete('get_complaint_categories');
    heuristicSet.delete('check_status');
    heuristicSet.delete('cancel_request');
  }

  if (isMemoryQuery && !isMyHistoryRequest && !isMyStatusLookup) {
    heuristicSet.delete('search_knowledge');
  }

  if (isServiceLikeReport) {
    heuristicSet.delete('create_complaint');
    heuristicSet.delete('get_complaint_categories');
  }

  if (isServiceLikeReport && !isServiceEditRequest && !isMyStatusLookup) {
    add('get_service_info', 'create_service_request');
  }

  if (isMyStatusLookup) {
    add('get_my_history');
  }

  if (isComplaintKnowledgeRequest) {
    add('search_knowledge');
  }

  if (isServiceInfoRequest) {
    add('get_service_info');
  }

  if (isStatusByReference) {
    add('check_status');
  }

  if (isCancelIntent) {
    add('cancel_request');
  }

  if (isMyHistoryRequest) {
    add('get_my_history');
  }

  if (isVillageProfileQuery) {
    add('get_village_profile');
  }

  if (isEmergencyQuery) {
    add('get_emergency_contacts');
  }

  if (isVillageDocumentQuery || isDocumentQuery) {
    add('search_documents');
  }

  if (isGenericKnowledgeStatusQuestion || isGeneralKnowledgeQuestion || isKnowledgeOnlyQuestion) {
    add('search_knowledge');
  }

  if (isMemoryQuery && !isServiceInfoRequest && !isComplaintKnowledgeRequest && !isGenericKnowledgeStatusQuestion && !isGeneralKnowledgeQuestion && !isVillageDocumentQuery && !isDocumentQuery && !isVillageProfileQuery && !isEmergencyQuery) {
    add('search_user_memory');
  }

  if (isMyStatusLookup || isMyHistoryRequest) {
    add('search_user_memory');
  }

  if (isServiceInfoRequest || isServiceLikeReport) {
    add('get_service_info');
  }

  if (isComplaintKnowledgeRequest) {
    add('search_knowledge');
  }

  if (isGenericKnowledgeStatusQuestion) {
    add('search_knowledge');
  }

  if (isVillageDocumentQuery || isDocumentQuery) {
    add('search_documents');
  }

  if (isVillageProfileQuery) {
    add('get_village_profile');
  }

  if (isEmergencyQuery) {
    add('get_emergency_contacts');
  }

  const isComplaintInfoQuery =
    hasComplaintGenericTerm &&
    /\b(contoh|prioritas|checklist|sop|panduan|prosedur|alur|status|jelaskan|apa|bagaimana)\b/i.test(normalized);

  if (isComplaintInfoQuery) {
    add('search_knowledge');
  } else if (!isComplaintUpdateRequest && !isServiceLikeReport && (hasExplicitComplaintCreationIntent || hasComplaintIncidentKeyword)) {
    add('create_complaint', 'get_complaint_categories');
  }

  if (!isComplaintUpdateRequest && !isServiceLikeReport && hasComplaintIncidentKeyword && hasComplaintLocationDetail) {
    add('create_complaint', 'get_complaint_categories');
  }

  if (!isServiceEditRequest && !isMyStatusLookup && /\b(surat|layanan|dokumen|syarat|persyaratan|biaya|proses|ktp|kk|sktm|domisili|akta|pindah|kelahiran|kematian)\b/i.test(normalized)) {
    add('get_service_info', 'create_service_request');
  }

  if (/\b(pdf|dokumen|lampiran|berkas|sop|peraturan|sk|surat keputusan|file)\b/i.test(normalized)) {
    add('search_documents');
    add('search_knowledge');
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
    toolPolicyReason: learnedTools.length > 0 ? 'learned_policy_applied' : 'heuristic_policy_applied',
  };
}
