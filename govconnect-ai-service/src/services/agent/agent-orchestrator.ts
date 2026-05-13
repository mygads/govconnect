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
import { executeToolCall, type ToolCallResult, type ToolExecutionTrace, type ToolTrustLevel } from './tool-executor';
import { buildAgentSystemPrompt, buildAgentDynamicContext, type AgentPromptContext } from './agent-prompt';
import { isContactDirectoryLookup } from '../important-contacts.service';

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
  guardrail?: {
    type: 'sufficient_service_info_stop';
    trigger: 'found' | 'needs_clarification' | 'suggested_response';
    toolName: AgentToolName;
    sourceKind?: string;
    iterations: number;
  };
}

interface ToolContext {
  userId: string;
  villageId?: string;
  channel: 'whatsapp' | 'webchat';
  traceId?: string;
  isEvaluation?: boolean;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
  activeServiceSlug?: string;
  activeServiceName?: string;
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
  activeServiceSlug?: string;
  activeServiceName?: string;
  routingDecision?: {
    action: string;
    confidence: string;
    primaryIntent: string;
    mixedSignals: boolean;
    stateAffinity?: string;
    reasons: string[];
    allowedToolHints?: string[];
  };
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

interface PreferredToolReplyCandidate {
  toolName: AgentToolName;
  replyText?: string;
  guidanceText?: string;
  score: number;
  index: number;
}

const READ_ONLY_TOOLS = new Set<AgentToolName>([
  'get_village_profile',
  'get_service_info',
  'get_complaint_categories',
  'get_emergency_contacts',
  'get_important_contact',
  'search_knowledge',
  'search_documents',
  'search_user_memory',
  'get_my_history',
  'check_status',
]);

const ACTION_PRIORITY_TOOLS = new Set<AgentToolName>([
  'create_complaint',
  'create_service_request',
  'update_complaint',
  'get_service_request_edit_link',
  'cancel_request',
]);

function isMutationTool(toolName: AgentToolName): boolean {
  return !READ_ONLY_TOOLS.has(toolName);
}

const TOOL_REPLY_BASE_PRIORITY: Partial<Record<AgentToolName, number>> = {
  create_service_request: 5000,
  get_service_request_edit_link: 5000,
  create_complaint: 4900,
  update_complaint: 4850,
  cancel_request: 4800,
  check_status: 4600,
  get_my_history: 4500,
  get_service_info: 4200,
  get_important_contact: 4180,
  get_emergency_contacts: 4160,
  get_village_profile: 4140,
  get_complaint_categories: 4100,
  search_user_memory: 3400,
  search_knowledge: 1400,
  search_documents: 1300,
};

const TOOL_REPLY_TRUST_PRIORITY: Record<ToolTrustLevel, number> = {
  trusted_fact: 400,
  trusted_record: 320,
  action_result: 220,
  untrusted_retrieval: 80,
};

const TOOL_REPLY_SOURCE_PRIORITY: Record<string, number> = {
  official_service_info: 180,
  contact_directory_lookup: 175,
  official_emergency_contacts: 170,
  official_village_profile: 165,
  status_lookup: 160,
  user_history: 150,
  official_complaint_categories: 145,
  service_request_link: 190,
  service_request_edit_link: 190,
  complaint_creation: 185,
  complaint_update: 180,
  request_cancellation: 175,
  complaint_creation_pending: 170,
  request_cancellation_pending: 165,
  user_memory: 140,
  system_reference_explainer: 110,
  knowledge_retrieval: 30,
  document_retrieval: 25,
  tool_error: 20,
  tool_argument_error: 15,
  tool_deduplication: 10,
};

function readToolReplyFields(result: ToolCallResult): { replyText?: string; guidanceText?: string } {
  const payload = result?.data;
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const resultData = result as unknown as Record<string, unknown>;

  return {
    replyText:
      readStringField(data, 'suggested_response')
      || readStringField(resultData, 'suggested_response')
      || readStringField(data, 'reply_text')
      || readStringField(data, 'replyText'),
    guidanceText:
      readStringField(data, 'guidance_text')
      || readStringField(resultData, 'guidance_text')
      || readStringField(data, 'guidanceText'),
  };
}

function derivePreferredToolReplyScore(
  toolName: AgentToolName,
  result: ToolCallResult,
  index: number,
): number {
  const trustLevel = result.meta?.trustLevel || 'action_result';
  const sourceKind = result.meta?.sourceKind || '';
  const basePriority = TOOL_REPLY_BASE_PRIORITY[toolName] || 0;
  const trustPriority = TOOL_REPLY_TRUST_PRIORITY[trustLevel] || 0;
  const sourcePriority = TOOL_REPLY_SOURCE_PRIORITY[sourceKind] || 0;
  const successPriority = result.success ? 40 : ACTION_PRIORITY_TOOLS.has(toolName) ? 10 : -20;

  return basePriority + trustPriority + sourcePriority + successPriority + index;
}

function isBetterPreferredToolReplyCandidate(
  candidate: PreferredToolReplyCandidate,
  current?: PreferredToolReplyCandidate,
): boolean {
  if (!current) return true;
  if (candidate.score !== current.score) return candidate.score > current.score;
  return candidate.index > current.index;
}

function derivePreferredToolReply(
  toolResults: Array<{ toolName: AgentToolName; result: ToolCallResult }>,
): { replyText?: string; guidanceText?: string } {
  let bestReply: PreferredToolReplyCandidate | undefined;
  let bestGuidance: PreferredToolReplyCandidate | undefined;

  toolResults.forEach(({ toolName, result }, index) => {
    const { replyText, guidanceText } = readToolReplyFields(result);
    if (!replyText && !guidanceText) {
      return;
    }

    const candidate: PreferredToolReplyCandidate = {
      toolName,
      replyText,
      guidanceText,
      score: derivePreferredToolReplyScore(toolName, result, index),
      index,
    };

    if (replyText && isBetterPreferredToolReplyCandidate(candidate, bestReply)) {
      bestReply = candidate;
    }

    if (guidanceText && isBetterPreferredToolReplyCandidate(candidate, bestGuidance)) {
      bestGuidance = candidate;
    }
  });

  return {
    replyText: bestReply?.replyText,
    guidanceText: bestGuidance?.guidanceText,
  };
}

function isExplicitServiceActionRequest(userMessage: string): boolean {
  const normalized = (userMessage || '').toLowerCase();
  return [
    /\b(kirim(?:kan)?|tolong kirim|minta|mana)\s+(link|tautan|form|formulir)(?:nya)?\b/i,
    /\b(link|tautan|form|formulir)(?:nya)?\s+(mana|sekarang|saja)\b/i,
    /\b(lanjut(?:kan)?|proses)\s+(ajukan|pengajuan|permohonan)\b/i,
    /\b(ajukan(?:kan)?|buat(?:kan)?|proseskan)\s+(layanan|permohonan|pengajuan)\b/i,
    /\b(isi\s+formulir)\b/i,
  ].some((pattern) => pattern.test(normalized));
}

type IntentFamily = 'complaint' | 'service' | 'village_profile' | 'contact' | 'status' | 'knowledge';

const MIXED_INTENT_CONNECTOR_PATTERN = /\b(dan|juga|sekalian|sama|trus|terus|lalu|kemudian|serta|plus|sambil)\b/i;
const MIXED_INTENT_FAMILY_LABELS: Record<IntentFamily, string> = {
  complaint: 'pengaduan',
  service: 'layanan',
  village_profile: 'profil desa',
  contact: 'kontak',
  status: 'status',
  knowledge: 'informasi umum',
};
const MIXED_INTENT_FAMILY_TOOLS: Record<IntentFamily, AgentToolName[]> = {
  complaint: ['create_complaint', 'get_complaint_categories', 'update_complaint'],
  service: ['get_service_info', 'create_service_request', 'get_service_request_edit_link'],
  village_profile: ['get_village_profile'],
  contact: ['get_important_contact', 'get_emergency_contacts'],
  status: ['check_status', 'get_my_history', 'cancel_request'],
  knowledge: ['search_knowledge'],
};

const NON_OFFICE_LOCAL_ENTITY_PATTERN = /\b(puskesmas|pustu|klinik|poliklinik|posyandu|bidan(?:\s+desa)?|pasar|lapangan|sekolah|paud|tk|sd|smp|sma|masjid|mushola|bumdes|pkh|blt|bansos)\b/i;
const LOCAL_KNOWLEDGE_QUERY_PATTERN = /\b(jadwal|kapan|jam\s+(buka|operasional|pelayanan|tutup)|alamat|lokasi|dimana|di\s+mana|maps?|google\s*maps?|info(?:rmasi)?)\b/i;

function isNonOfficeLocalKnowledgeQueryText(userMessage: string): boolean {
  const normalized = (userMessage || '').toLowerCase().trim();
  if (!normalized) return false;
  if (isContactDirectoryLookup(userMessage)) return false;
  if (!NON_OFFICE_LOCAL_ENTITY_PATTERN.test(normalized)) return false;
  if (/\b(kantor\s+desa|kantor\s+kelurahan|balai\s+desa|sekretariat\s+desa)\b/i.test(normalized)) return false;
  return LOCAL_KNOWLEDGE_QUERY_PATTERN.test(normalized);
}

function isOfficeContactProfileQueryText(userMessage: string): boolean {
  const normalized = (userMessage || '').toLowerCase();
  if (isNonOfficeLocalKnowledgeQueryText(userMessage)) return false;
  return /\b(jam buka|jam operasional|nomor kantor|telepon kantor|kontak kantor|kantor desa|kantor kelurahan|balai desa|sekretariat desa)\b/i.test(normalized)
    || (/\b(alamat|lokasi|maps|gmaps|jadwal)\b/i.test(normalized) && /\b(desa|kelurahan|kantor|balai|sekretariat)\b/i.test(normalized));
}

function detectIntentFamilies(userMessage: string): Set<IntentFamily> {
  const normalized = (userMessage || '').toLowerCase();
  const families = new Set<IntentFamily>();
  const hasContactCue = /\b(nomor|kontak|telp|telepon|hubungi|whatsapp|wa|hp)\b/i.test(normalized);
  const hasContactTarget = /\b(kepala\s+desa|kades|sekdes|rt|rw|puskesmas|damkar|polsek|polres|bidan|ambulans|ambulan|pln|pdam|kantor)\b/i.test(normalized);
  const isOfficeContactProfileQuery = isOfficeContactProfileQueryText(userMessage);
  const isLocalKnowledgeQuery = isNonOfficeLocalKnowledgeQueryText(userMessage);

  if (/\b(lapor|pengaduan|aduan|keluhan|jalan rusak|jalan berlubang|lampu mati|sampah|banjir|drainase|selokan|pohon tumbang|fasilitas rusak)\b/i.test(normalized)) {
    families.add('complaint');
  }
  if (/\b(ktp|kk|akta|domisili|sktm|skck|pindah|nikah|layanan|surat|dokumen|syarat|persyaratan|biaya|proses)\b/i.test(normalized)) {
    families.add('service');
  }
  if (isOfficeContactProfileQuery) {
    families.add('village_profile');
  }
  if (isLocalKnowledgeQuery) {
    families.add('knowledge');
  }
  if (hasContactCue && hasContactTarget && !isOfficeContactProfileQuery) {
    families.add('contact');
  }
  if (/\b(status|cek\s+status|tracking|lacak|riwayat|lap-[\w-]+|lay-[\w-]+|lyn-[\w-]+|rpt-[\w-]+)\b/i.test(normalized)) {
    families.add('status');
  }

  return families;
}

function mapToolsToIntentFamilies(toolsUsed: string[]): Set<IntentFamily> {
  const toolFamilies = new Set<IntentFamily>();

  for (const tool of toolsUsed) {
    if (tool === 'create_complaint' || tool === 'get_complaint_categories' || tool === 'update_complaint') {
      toolFamilies.add('complaint');
    }
    if (tool === 'get_service_info' || tool === 'create_service_request' || tool === 'get_service_request_edit_link') {
      toolFamilies.add('service');
    }
    if (tool === 'get_village_profile') {
      toolFamilies.add('village_profile');
    }
    if (tool === 'get_important_contact' || tool === 'get_emergency_contacts') {
      toolFamilies.add('contact');
    }
    if (tool === 'check_status' || tool === 'get_my_history' || tool === 'cancel_request') {
      toolFamilies.add('status');
    }
    if (tool === 'search_knowledge') {
      toolFamilies.add('knowledge');
    }
  }

  return toolFamilies;
}

function hasMixedIntentRequest(userMessage: string): boolean {
  const requestedFamilies = detectIntentFamilies(userMessage);
  if (requestedFamilies.size < 2) {
    return false;
  }

  const normalized = (userMessage || '').toLowerCase();
  return MIXED_INTENT_CONNECTOR_PATTERN.test(normalized) || normalized.includes('?');
}

function getUncoveredMixedIntentFamilies(userMessage: string, toolsUsed: string[]): IntentFamily[] {
  if (!hasMixedIntentRequest(userMessage)) {
    return [];
  }

  const requestedFamilies = detectIntentFamilies(userMessage);
  const coveredFamilies = mapToolsToIntentFamilies(toolsUsed);
  return Array.from(requestedFamilies).filter((family) => !coveredFamilies.has(family));
}

/**
 * Detect user messages that combine two distinct intents in one turn.
 * When true, the agent loop must NOT early-terminate on a single tool
 * result — the second intent has to be addressed first.
 */
function isMixedIntentMessage(userMessage: string, toolsUsed: string[]): boolean {
  return getUncoveredMixedIntentFamilies(userMessage, toolsUsed).length > 0;
}

function getRemainingMixedIntentTools(
  userMessage: string,
  toolsUsed: string[],
  allowedToolNames: AgentToolName[],
): AgentToolName[] {
  const usedTools = new Set(toolsUsed);
  const allowedTools = new Set(allowedToolNames);

  return Array.from(new Set(
    getUncoveredMixedIntentFamilies(userMessage, toolsUsed)
      .flatMap((family) => MIXED_INTENT_FAMILY_TOOLS[family])
      .filter((tool) => allowedTools.has(tool) && !usedTools.has(tool)),
  ));
}

function shouldForceMixedIntentContinuation(
  userMessage: string,
  toolsUsed: string[],
  allowedToolNames: AgentToolName[],
): boolean {
  return getRemainingMixedIntentTools(userMessage, toolsUsed, allowedToolNames).length > 0;
}

function buildMixedIntentContinuationPrompt(
  userMessage: string,
  toolsUsed: string[],
  allowedToolNames: AgentToolName[],
): string | null {
  const uncoveredFamilies = getUncoveredMixedIntentFamilies(userMessage, toolsUsed);
  const remainingTools = getRemainingMixedIntentTools(userMessage, toolsUsed, allowedToolNames);
  if (uncoveredFamilies.length === 0 || remainingTools.length === 0) {
    return null;
  }

  const uncoveredLabels = uncoveredFamilies.map((family) => MIXED_INTENT_FAMILY_LABELS[family]).join(', ');
  return `[INSTRUKSI INTERNAL] Permintaan user masih punya bagian yang belum terjawab: ${uncoveredLabels}. Jangan akhiri jawaban dulu. Gunakan tool yang masih relevan bila perlu (${remainingTools.join(', ')}), lalu beri satu jawaban final yang merangkum semua bagian.`;
}

function buildMixedIntentSynthesisPrompt(userMessage: string, toolsUsed: string[]): string | null {
  if (!hasMixedIntentRequest(userMessage)) {
    return null;
  }

  const uncoveredFamilies = getUncoveredMixedIntentFamilies(userMessage, toolsUsed);
  if (uncoveredFamilies.length > 0) {
    return null;
  }

  const coveredFamilies = Array.from(mapToolsToIntentFamilies(toolsUsed));
  if (coveredFamilies.length < 2) {
    return null;
  }

  const coveredLabels = coveredFamilies.map((family) => MIXED_INTENT_FAMILY_LABELS[family]).join(', ');
  return `[INSTRUKSI INTERNAL] Semua bagian permintaan user sekarang sudah punya grounding (${coveredLabels}). Susun satu jawaban final yang natural, ringkas, dan menjawab semua bagian sekaligus. Jangan tampilkan proses internal atau nama tool.`;
}

function buildMixedIntentLoopExhaustedReply(
  userMessage: string,
  toolsUsed: string[],
  allowedToolNames: AgentToolName[],
  preferredReplyText?: string,
): string {
  const uncoveredFamilies = getUncoveredMixedIntentFamilies(userMessage, toolsUsed);
  if (uncoveredFamilies.length === 0) {
    return buildAgentFallbackReply(userMessage, toolsUsed);
  }

  const unresolvedLabels = uncoveredFamilies.map((family) => MIXED_INTENT_FAMILY_LABELS[family]).join(', ');
  const unresolvedToolHint = getRemainingMixedIntentTools(userMessage, toolsUsed, allowedToolNames);
  const partialReply = preferredReplyText ? validateFinalAgentReply(preferredReplyText, toolsUsed, userMessage) : '';
  const suffix = unresolvedToolHint.length > 0
    ? ` Bagian ${unresolvedLabels} belum berhasil saya pastikan sekarang.`
    : ` Saya belum berhasil memastikan bagian ${unresolvedLabels} sekarang.`;
  const retryHint = 'Kalau mau, kirim ulang bagian yang belum itu satu per satu ya, nanti saya bantu lanjutkan.';

  return partialReply
    ? `${partialReply}\n\nMaaf Pak/Bu,${suffix} ${retryHint}`
    : `Maaf Pak/Bu, permintaan tadi terdiri dari beberapa bagian dan ${unresolvedLabels} belum berhasil saya pastikan sekarang. ${retryHint}`;
}

function getSufficientServiceInfoStopReason(
  userMessage: string,
  toolResults: Array<{ toolName: AgentToolName; result: ToolCallResult }>,
): { trigger: 'found' | 'needs_clarification' | 'suggested_response'; toolName: AgentToolName; sourceKind?: string } | null {
  const wantsImmediateAction = isExplicitServiceActionRequest(userMessage);
  const toolsUsed = toolResults.map(({ toolName }) => toolName);
  if (hasMixedIntentRequest(userMessage)) {
    return null;
  }

  for (const { toolName, result } of toolResults) {
    if (toolName !== 'get_service_info' || result?.success !== true || result.meta?.sourceKind !== 'official_service_info') {
      continue;
    }

    const payload = result.data;
    if (!payload || typeof payload !== 'object') {
      continue;
    }

    const data = payload as Record<string, unknown>;
    const found = typeof data.found === 'boolean' ? data.found : undefined;
    const needsClarification = data.needs_clarification === true;
    const hasSuggestedReply = !!(
      readStringField(data, 'suggested_response')
      || readStringField(result as unknown as Record<string, unknown>, 'suggested_response')
      || readStringField(data, 'reply_text')
      || readStringField(data, 'replyText')
    );

    if (!hasSuggestedReply) {
      continue;
    }

    if (needsClarification) {
      return { trigger: 'needs_clarification', toolName, sourceKind: result.meta?.sourceKind };
    }

    if (found === false) {
      return { trigger: 'suggested_response', toolName, sourceKind: result.meta?.sourceKind };
    }

    if (found === true && !wantsImmediateAction) {
      return { trigger: 'found', toolName, sourceKind: result.meta?.sourceKind };
    }
  }

  return null;
}

function shouldStopAfterSufficientServiceInfo(
  userMessage: string,
  toolResults: Array<{ toolName: AgentToolName; result: ToolCallResult }>,
): boolean {
  return !!getSufficientServiceInfoStopReason(userMessage, toolResults);
}

function parseTextToolCall(text: string, allowedToolNames: AgentToolName[]): { toolName: AgentToolName; args: Record<string, unknown> } | null {
  const functionMatch = text.match(/<function=([a-z_]+)>/i);
  if (!functionMatch) return null;

  const toolName = functionMatch[1] as AgentToolName;
  if (!allowedToolNames.includes(toolName)) return null;
  if (isMutationTool(toolName)) return null;

  const args: Record<string, unknown> = {};
  const parameterPattern = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/gi;
  let parameterMatch: RegExpExecArray | null;
  while ((parameterMatch = parameterPattern.exec(text)) !== null) {
    args[parameterMatch[1]] = parameterMatch[2].trim();
  }

  return { toolName, args };
}

function shouldAllowTextToolFallback(input: {
  userMessage: string;
  toolName: AgentToolName;
  allowedToolNames: AgentToolName[];
  heuristicTools: AgentToolName[];
  requiredTools: AgentToolName[];
  toolsUsed: string[];
}): { allowed: boolean; reason: string } {
  if (input.toolsUsed.length > 0) {
    return { allowed: false, reason: 'tools_already_used' };
  }

  if (!READ_ONLY_TOOLS.has(input.toolName)) {
    return { allowed: false, reason: 'tool_not_read_only' };
  }

  if (input.allowedToolNames.length !== 1 || input.allowedToolNames[0] !== input.toolName) {
    return { allowed: false, reason: 'multiple_allowed_tools' };
  }

  if (input.requiredTools.length > 0 && !input.requiredTools.includes(input.toolName)) {
    return { allowed: false, reason: 'tool_not_required' };
  }

  if (hasMixedIntentRequest(input.userMessage)) {
    return { allowed: false, reason: 'mixed_intent_request' };
  }

  if (detectAmbiguousIntent(input.userMessage, input.heuristicTools, input.allowedToolNames)) {
    return { allowed: false, reason: 'ambiguous_intent' };
  }

  return { allowed: true, reason: 'single_read_only_grounding_tool' };
}

function validateFinalAgentReply(text: string, toolsUsed: string[], userMessage?: string): string {
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

  // Guard against fabricated phone numbers: if the user asked for a contact
  // and the reply mentions a phone number BUT no contact tool was actually
  // used, downgrade the reply so we never invent a number.
  if (userMessage) {
    const askedForContact = /\b(nomor|nomer|no|kontak|telp|telepon|hp|wa|whatsapp)\b/i.test(userMessage);
    // Strict phone pattern: matches Indonesian mobile/landline formats only.
    // Must NOT match LAP-20260101-001, NIK (16 digits), or year-counts ("tahun 2024").
    const repliedWithNumber = /(?:(?<![-\w])0\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}(?!\d)|\+?62\s?\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}|(?<!\d)08\d{8,11}(?!\d)|\(0\d{2,3}\)\s?\d{6,8})/.test(text);
    const usedContactTool = toolsUsed.some((tool) => tool === 'get_important_contact' || tool === 'get_emergency_contacts' || tool === 'get_village_profile');
    // Skip if the reply is referencing LAP/LAY codes (status lookup talk).
    const mentionsReferenceCode = /\b(LAP|LAY|LYN|RPT)-\d{8}-\d{3}\b/i.test(text);
    if (askedForContact && repliedWithNumber && !usedContactTool && !mentionsReferenceCode) {
      return 'Maaf Pak/Bu, untuk nomor kontaknya saya belum bisa memastikan dari sini. Kalau mau, sebutkan nama atau jabatannya lebih spesifik, nanti saya cek ke daftar kontak desa ya.';
    }
  }

  return text;
}
function buildAgentFallbackReply(userMessage: string, toolsUsed: string[] = []): string {
  const normalized = (userMessage || '').toLowerCase();
  const looksOutOfScopeGeneral = /\b(javascript|typescript|python|java|coding|ngoding|code|program|loop|for\s*\(|console\.log|1\s*\+\s*1|matematika|rumus|algoritma)\b/i.test(normalized);
  const looksLikeStatus = /\b(lap|lay|lyn|rpt)-[\w-]+\b/i.test(userMessage);
  const looksLikeExternalAdminQuery =
    /\b(cara|bagaimana|gimana|mau bikin|buat|urus|pengurusan)\b/i.test(normalized)
    && /\b(sim|paspor|bpjs|visa|imigrasi|npwp|stnk|bpkb)\b/i.test(normalized);

  if (looksLikeExternalAdminQuery) {
    return 'Maaf Pak/Bu, informasi untuk layanan itu belum tersedia di sistem kami. Kalau perlu penjelasan lebih lanjut, silakan datang ke kantor desa pada jam kerja ya.';
  }

  if (looksOutOfScopeGeneral) {
    return 'Maaf Pak/Bu, saya fokus membantu layanan desa dan penggunaan GovConnect. Kalau ada pertanyaan soal administrasi desa, pengaduan, status layanan, atau cara pakai GovConnect, saya bantu ya.';
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
  requiredTools: AgentToolName[] = [],
): { choice: AgentToolChoice; reason: string } {
  if (allowedToolsCount === 0) {
    return {
      choice: 'auto',
      reason: 'no_allowed_tools',
    };
  }

  const normalized = (userMessage || '').toLowerCase().trim();

  if (isMixedIntentMessage(userMessage, []) && allowedToolNames.some((tool) => [
    'get_service_info',
    'get_village_profile',
    'get_important_contact',
    'get_emergency_contacts',
    'check_status',
    'get_my_history',
    'create_complaint',
    'get_complaint_categories',
  ].includes(tool))) {
    return {
      choice: 'required',
      reason: 'mixed_intent_grounding_requires_tool',
    };
  }

  if (requiredTools.includes('get_important_contact')) {
    return {
      choice: 'required',
      reason: 'contact_directory_lookup_requires_tool',
    };
  }

  if (requiredTools.includes('check_status') && /\b(?:lap|lay|lyn|rpt)-[\w-]+\b/i.test(userMessage)) {
    return {
      choice: 'required',
      reason: 'status_reference_requires_tool',
    };
  }

  if (
    requiredTools.includes('get_village_profile')
    && allowedToolNames.length === 1
    && /\b(alamat|lokasi|maps|gmaps|jam buka|jam operasional|kontak|nomor kantor|telepon kantor|kantor desa)\b/i.test(normalized)
  ) {
    return {
      choice: 'required',
      reason: 'village_profile_fact_requires_tool',
    };
  }

  const shortAmbiguousUtterance = normalized.split(/\s+/).filter(Boolean).length <= 3
    && /\b(mau|ingin|tolong|bantu|lapor|urus|gimana|bagaimana|bingung|info|status)\b/i.test(normalized)
    && !/\b(?:lap|lay|lyn|rpt)-[\w-]+\b/i.test(userMessage);
  if (shortAmbiguousUtterance) {
    return {
      choice: 'auto',
      reason: 'short_ambiguous_utterance',
    };
  }

  const ambiguous = detectAmbiguousIntent(userMessage, heuristicTools, allowedToolNames);
  if (ambiguous) {
    return {
      choice: 'auto',
      reason: 'ambiguous_or_multi_intent',
    };
  }

  const singleGroundingTool = allowedToolNames.length === 1
    ? allowedToolNames[0]
    : null;
  if (singleGroundingTool && ['get_service_info', 'get_village_profile', 'get_emergency_contacts'].includes(singleGroundingTool)) {
    return {
      choice: 'required',
      reason: 'single_grounding_tool_available',
    };
  }

  return {
    choice: 'auto',
    reason: 'multiple_non_mandatory_tools_available',
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
  const toolSelection = await selectAllowedTools(userMessage, conversationCtx);
  const {
    heuristicTools,
    learnedTools,
    requiredTools,
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
    'get_important_contact',
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
    requiredTools,
  );
  const firstTurnToolChoice = firstTurnToolResolution.choice;
  const firstTurnToolChoiceReason = firstTurnToolResolution.reason;

  const messages: AgentMessage[] = [{ role: 'system', content: systemPrompt }];

  // Dynamic per-turn context (datetime, routing, memory, sentiment, state)
  // is delivered as a leading user message so the static system prompt
  // above stays byte-identical across turns and benefits from provider
  // prefix caching.
  const dynamicContext = buildAgentDynamicContext(promptCtx);
  if (dynamicContext) {
    messages.push({ role: 'user', content: dynamicContext });
  }

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
  const executedToolSignatures = new Set<string>();
  const preferredToolResults: Array<{ toolName: AgentToolName; result: ToolCallResult }> = [];
  let totalTokens = 0;
  let iterations = 0;
  let model = '';
  let preferredReplyText: string | undefined;
  let preferredGuidanceText: string | undefined;
  const tokenContext = buildAgentGatewayTokenContext(toolCtx);

  const criticalToolIntent = allowedToolNames.some((tool) =>
    tool === 'get_important_contact'
    || tool === 'create_complaint'
    || tool === 'create_service_request'
    || tool === 'check_status'
    || tool === 'update_complaint'
    || tool === 'cancel_request',
  );

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    iterations = i + 1;

    const toolChoice: AgentToolChoice = i === 0 ? firstTurnToolChoice : 'auto';
    const response = await callLLMWithTools(messages, allowedTools, toolChoice, tokenContext, {
      criticalTurn: criticalToolIntent,
    });
    if (!response) {
      return {
        replyText: buildMixedIntentLoopExhaustedReply(userMessage, toolsUsed, allowedToolNames, preferredReplyText),
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

      // Tool execution strategy:
      // - Parse + dedup all tool calls first into a plan.
      // - Read-only tools (no side effects on DB/case) run in parallel.
      // - Mutation tools (create/update/cancel, service form link) run
      //   sequentially in the order the model emitted them so ordering
      //   semantics stay intact.
      type ExecutableTask = {
        tc: ToolCall;
        toolName: AgentToolName;
        args: Record<string, unknown>;
        kind: 'read' | 'mutation';
      };

      const parallelTasks: ExecutableTask[] = [];
      const serialTasks: ExecutableTask[] = [];

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

        const toolSignature = `${toolName}:${JSON.stringify(args)}`;
        if (executedToolSignatures.has(toolSignature)) {
          logger.info('Skipping duplicate tool call', { toolName, args, iteration: i + 1 });
          toolResults.push({
            toolName,
            result: {
              success: true,
              data: { cached: true, message: 'Tool already executed with same arguments' },
              meta: { trustLevel: 'action_result', sourceKind: 'tool_deduplication' },
            },
            role: 'tool',
            tool_call_id: tc.id,
            name: toolName,
            content: JSON.stringify({ success: true, cached: true }),
          });
          continue;
        }
        executedToolSignatures.add(toolSignature);
        toolsUsed.push(toolName);

        const kind: 'read' | 'mutation' = READ_ONLY_TOOLS.has(toolName) ? 'read' : 'mutation';
        (kind === 'read' ? parallelTasks : serialTasks).push({ tc, toolName, args, kind });
      }

      // Run read-only tools in parallel.
      const parallelResults = await Promise.all(
        parallelTasks.map((task) =>
          executeToolCall(task.toolName, task.args, { ...toolCtx, userMessage }),
        ),
      );
      for (let pIdx = 0; pIdx < parallelTasks.length; pIdx += 1) {
        const task = parallelTasks[pIdx];
        const result = parallelResults[pIdx];
        toolTrace.push(result.trace);
        toolResults.push({
          toolName: task.toolName,
          result: result.result,
          role: 'tool',
          tool_call_id: task.tc.id,
          name: task.toolName,
          content: result.content,
        });
      }

      // Run mutation tools sequentially to preserve ordering semantics.
      for (const task of serialTasks) {
        const result = await executeToolCall(task.toolName, task.args, { ...toolCtx, userMessage });
        toolTrace.push(result.trace);
        toolResults.push({
          toolName: task.toolName,
          result: result.result,
          role: 'tool',
          tool_call_id: task.tc.id,
          name: task.toolName,
          content: result.content,
        });
      }


      preferredToolResults.push(...toolResults.map(({ toolName, result }) => ({ toolName, result })));
      const preferredFromTools = derivePreferredToolReply(preferredToolResults);
      preferredReplyText = preferredFromTools.replyText;
      preferredGuidanceText = preferredFromTools.guidanceText;

      for (const tr of toolResults) {
        messages.push(tr);
      }

      const sufficientStopReason = preferredReplyText
        ? getSufficientServiceInfoStopReason(userMessage, toolResults)
        : null;
      if (preferredReplyText && sufficientStopReason) {
        logger.info('Agent early termination: service info already sufficient', {
          iterations: i + 1,
          toolsUsed,
          trigger: sufficientStopReason.trigger,
        });
        return {
          replyText: validateFinalAgentReply(preferredReplyText, toolsUsed, userMessage),
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
          iterations: i + 1,
          model,
          durationMs: Date.now() - startTime,
          guardrail: {
            type: 'sufficient_service_info_stop',
            trigger: sufficientStopReason.trigger,
            toolName: sufficientStopReason.toolName,
            sourceKind: sufficientStopReason.sourceKind,
            iterations: i + 1,
          },
        };
      }

      // Early termination: if multiple tools returned "not found" and we have a suggested response,
      // return immediately instead of continuing to loop.
      //
      // Mixed-intent turns are excluded even after all parts are grounded,
      // because the model still needs one synthesis pass to merge the answers
      // into a single natural reply.
      if (i >= 1 && preferredReplyText && !hasMixedIntentRequest(userMessage)) {
        const notFoundCount = toolResults.filter(tr => {
          const data = tr.result?.data;
          return tr.result?.success === true &&
            data && typeof data === 'object' &&
            ('found' in data ? (data as any).found === false : false);
        }).length;

        if (notFoundCount >= 1) {
          logger.info('Agent early termination: tool returned not found with suggested response', {
            iterations: i + 1,
            toolsUsed,
            notFoundCount,
          });
          return {
            replyText: validateFinalAgentReply(preferredReplyText, toolsUsed, userMessage),
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
            iterations: i + 1,
            model,
            durationMs: Date.now() - startTime,
          };
        }
      }

      const mixedIntentSynthesisPrompt = buildMixedIntentSynthesisPrompt(userMessage, toolsUsed);
      if (mixedIntentSynthesisPrompt) {
        messages.push({ role: 'user', content: mixedIntentSynthesisPrompt });
      }

      continue;
    }

    const finalText = extractText(assistantMsg?.content);
    const textToolCall = finalText ? parseTextToolCall(finalText, allowedToolNames) : null;
    if (textToolCall) {
      const textToolFallbackDecision = shouldAllowTextToolFallback({
        userMessage,
        toolName: textToolCall.toolName,
        allowedToolNames,
        heuristicTools,
        requiredTools,
        toolsUsed,
      });

      if (textToolFallbackDecision.allowed) {
        logger.warn('Executing text-tool fallback', {
          toolName: textToolCall.toolName,
          iteration: i + 1,
          userId: toolCtx.userId,
          villageId: toolCtx.villageId,
          matchedPolicyKey,
          matchedPolicySource,
          fallbackReason: textToolFallbackDecision.reason,
        });

        toolsUsed.push(textToolCall.toolName);
        const result = await executeToolCall(textToolCall.toolName, textToolCall.args, { ...toolCtx, userMessage });
        result.trace = {
          ...result.trace,
          sourceKind: result.trace.sourceKind
            ? `${result.trace.sourceKind}|text_tool_fallback`
            : 'text_tool_fallback',
        };
        toolTrace.push(result.trace);

        preferredToolResults.push({ toolName: textToolCall.toolName, result: result.result });
        const preferredFromTools = derivePreferredToolReply(preferredToolResults);
        preferredReplyText = preferredFromTools.replyText;
        preferredGuidanceText = preferredFromTools.guidanceText;

        messages.push({ role: 'assistant', content: finalText });
        messages.push({
          role: 'tool',
          tool_call_id: `text_tool_${i}`,
          name: textToolCall.toolName,
          content: result.content,
        });
        continue;
      }

      logger.warn('Ignoring text-tool fallback', {
        toolName: textToolCall.toolName,
        iteration: i + 1,
        userId: toolCtx.userId,
        villageId: toolCtx.villageId,
        matchedPolicyKey,
        matchedPolicySource,
        fallbackReason: textToolFallbackDecision.reason,
      });
    }

    if (finalText) {
      const mixedIntentContinuationPrompt = buildMixedIntentContinuationPrompt(userMessage, toolsUsed, allowedToolNames);
      if (mixedIntentContinuationPrompt) {
        logger.info('Agent continuation required: mixed intent still partially uncovered', {
          iterations,
          toolsUsed,
          allowedToolNames,
          uncoveredFamilies: getUncoveredMixedIntentFamilies(userMessage, toolsUsed),
        });
        messages.push({ role: 'assistant', content: finalText });
        messages.push({ role: 'user', content: mixedIntentContinuationPrompt });
        continue;
      }

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
        replyText: validateFinalAgentReply(preferredReplyText || finalText, toolsUsed, userMessage),
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
    replyText: buildMixedIntentLoopExhaustedReply(userMessage, toolsUsed, allowedToolNames, preferredReplyText),
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
  options: { criticalTurn?: boolean } = {},
): Promise<AgentGatewayResponse | null> {
  // Critical turns (complaint creation, contact lookup, status check, service
  // request) need more deterministic behavior. Drop the temperature further
  // and allow a longer deliberation window so tool_calls land cleanly.
  const temperature = options.criticalTurn ? 0.1 : 0.3;
  const maxTokens = options.criticalTurn ? 1800 : 1500;

  const result = await callAIGatewayPrompt({
    lane: 'llm',
    modelPriority: [],
    messages: messages as GatewayChatMessage[],
    temperature,
    maxTokens,
    timeoutMs: 20_000,
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

async function selectAllowedTools(
  userMessage: string,
  conversationCtx: ConversationContext = {},
): Promise<{
  heuristicTools: AgentToolName[];
  learnedTools: AgentToolName[];
  suggestedTools: AgentToolName[];
  requiredTools: AgentToolName[];
  hardDeniedTools: AgentToolName[];
  allowedToolNames: AgentToolName[];
  matchedPolicyKey?: string;
  matchedPolicySource?: string;
  matchedPolicyConfidence?: number;
  toolPolicyReason: string;
}> {
  const normalized = userMessage.toLowerCase().trim();
  const heuristicSet = new Set<AgentToolName>();
  const suggestedSet = new Set<AgentToolName>();
  const requiredSet = new Set<AgentToolName>();
  const hardDeniedSet = new Set<AgentToolName>();
  const routingDecision = conversationCtx.routingDecision;
  const knownToolNames = new Set(AGENT_TOOLS.map((tool) => tool.function.name as AgentToolName));
  const routingHintTools = (routingDecision?.allowedToolHints || [])
    .filter((tool): tool is AgentToolName => knownToolNames.has(tool as AgentToolName));
  const hasActiveServiceContext = !!conversationCtx.activeServiceSlug || !!conversationCtx.activeServiceName;
  const isShortServiceFollowUp = hasActiveServiceContext && /\b(berapa lama|lama proses(?:nya)?|syarat(?:nya)?|persyaratan(?:nya)?|biaya(?:nya)?|online|offline|link(?:nya)?|form(?:nya)?|formulir(?:nya)?|ajukan|pengajuan|harus ke kantor|ke kantor)\b/i.test(normalized);
  const hasReference = /\b(?:lap|lay|lyn|rpt)-[\w-]+\b/i.test(userMessage);
  const isGreetingOnly = /^(halo|hai|hi|hello|assalamualaikum|permisi|p|selamat (pagi|siang|sore|malam))[\s!.,?]*$/i.test(userMessage);

  if (isGreetingOnly) {
    return {
      heuristicTools: [],
      learnedTools: [],
      suggestedTools: [],
      requiredTools: [],
      hardDeniedTools: [],
      allowedToolNames: [],
      toolPolicyReason: 'greeting_only_no_tools',
    };
  }

  const add = (...names: AgentToolName[]) => names.forEach((name) => heuristicSet.add(name));
  const suggest = (...names: AgentToolName[]) => names.forEach((name) => suggestedSet.add(name));
  const requireTool = (...names: AgentToolName[]) => names.forEach((name) => requiredSet.add(name));
  const deny = (...names: AgentToolName[]) => names.forEach((name) => {
    hardDeniedSet.add(name);
    heuristicSet.delete(name);
  });

  if (routingHintTools.length > 0) {
    suggest(...routingHintTools);
    add(...routingHintTools);
  }
  if (isShortServiceFollowUp) {
    add('get_service_info', 'create_service_request');
  }
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
  const isActiveEmergencySituation =
    /\b(kebakaran|terbakar|api\s+besar|kecelakaan|tabrakan|pingsan|kejang|tenggelam|pencurian|perampokan|penjambretan|banjir mendadak|tanah longsor|gempa|ledakan|orang\s+(sakit\s+keras|meninggal))\b/i.test(normalized)
    || /\b(tolong|bantu|gawat)\b.*\b(sekarang|segera|barusan|di\s+depan|di\s+rumah)\b/i.test(normalized);
  const isOfficeContactProfileQuery = isOfficeContactProfileQueryText(userMessage);
  const isVillageProfileQuery = isOfficeContactProfileQuery;
  const isLocalKnowledgeQuery = isNonOfficeLocalKnowledgeQueryText(userMessage);
  const isMemoryQuery = /\b(sebelumnya|tadi|terakhir|alamat saya|preferensi saya|yang pernah saya|saya pernah)\b/i.test(normalized);
  const isStatusByReference = hasReference && /\b(status|cek|periksa|tracking|lacak)\b/i.test(normalized);
  const isCancelIntent = /\b(batal|batalkan|cancel)\b/i.test(normalized);
  const isContactDirectoryLookupIntent =
    !hasReference
    && !isOfficeContactProfileQuery
    && /\b(nomor|nomer|no|kontak|telp|telepon|hp|wa|whatsapp)\b/i.test(normalized)
    && /\b(kepala desa|kades|lurah|sekdes|sekretaris desa|damkar|pemadam|polisi|polsek|polres|babinsa|bhabinkamtibmas|puskesmas|pustu|klinik|bidan|rumah sakit|\brs\b|rsud|ambulans|ambulan|kecamatan|camat|rt|rw|bpd|pln|pdam|basarnas|sar|bpbd|admin|petugas|kantor)\b/i.test(normalized)
    && !/\b(kebakaran|terbakar|kecelakaan|tabrakan|pingsan|sakit keras|pencurian|perampokan|banjir mendadak|longsor|gempa|ledakan|tenggelam)\b/i.test(normalized);
  const requestedIntentFamilies = detectIntentFamilies(userMessage);
  const hasMixedIntentFamilies = isMixedIntentMessage(userMessage, []);
  const hasKnowledgeMixedIntent = requestedIntentFamilies.has('knowledge');
  const shouldPreferAuthoritativeDbTools =
    isShortServiceFollowUp
    || isServiceInfoRequest
    || isVillageProfileQuery
    || isStatusByReference
    || isContactDirectoryLookupIntent
    || isEmergencyQuery;
  const hasComplaintIncidentKeyword = /\b(jalan rusak|jalan berlubang|lampu mati|sampah|drainase|selokan|banjir|pohon tumbang|fasilitas rusak|aspal rusak|jalan licin|jalan amblas|amblas|longsor|licin|gelap|bau menyengat|tersumbat|kecelaka+an|kebakaran|orang pingsan|ledakan)\b/i.test(normalized);
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
    requireTool('check_status');
    add('check_status');
  }

  if (isServiceEditRequest) {
    add('get_service_request_edit_link', 'check_status');
  }

  if (isComplaintUpdateRequest) {
    add('update_complaint', 'check_status');
  }

  if (isVillageProfileQuery) {
    requireTool('get_village_profile');
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

  if (isLocalKnowledgeQuery) {
    add('search_knowledge');
  }

  if (isContactDirectoryLookupIntent) {
    requireTool('get_important_contact');
    add('get_important_contact');
    if (!hasMixedIntentFamilies) {
      deny(
        'get_emergency_contacts',
        'get_service_info',
        'create_service_request',
        'search_knowledge',
        'search_documents',
        'create_complaint',
        'get_complaint_categories',
      );
    }
  }

  if (isActiveEmergencySituation) {
    requireTool('get_emergency_contacts');
    add('get_emergency_contacts');
    deny('get_important_contact');
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

  if (routingDecision?.mixedSignals || routingDecision?.confidence === 'medium') {
    if (routingDecision.primaryIntent !== 'contact_lookup') {
      if (hasKnowledgeMixedIntent) {
        if (requestedIntentFamilies.has('service')) {
          add('get_service_info');
        }
        if (requestedIntentFamilies.has('village_profile')) {
          add('get_village_profile');
        }
        add('search_knowledge');
      } else {
        add('get_village_profile', 'get_service_info');
        if (!shouldPreferAuthoritativeDbTools) {
          add('search_knowledge');
        }
      }
    }
    if (routingDecision.primaryIntent === 'complaint_creation' || routingDecision.primaryIntent === 'emergency_contact') {
      add('get_emergency_contacts', 'create_complaint', 'get_complaint_categories');
    }
  }

  if (hasMixedIntentFamilies) {
    if (requestedIntentFamilies.has('service')) {
      add('get_service_info');
    }
    if (requestedIntentFamilies.has('village_profile')) {
      add('get_village_profile');
    }
    if (requestedIntentFamilies.has('contact')) {
      add('get_important_contact');
    }
    if (requestedIntentFamilies.has('status')) {
      add('check_status', 'get_my_history');
    }
    if (requestedIntentFamilies.has('complaint')) {
      add('create_complaint', 'get_complaint_categories');
    }
    if (requestedIntentFamilies.has('knowledge')) {
      add('search_knowledge');
    }
  }

  if (shouldPreferAuthoritativeDbTools && !hasKnowledgeMixedIntent) {
    heuristicSet.delete('search_knowledge');
    heuristicSet.delete('search_documents');
  }

  if (heuristicSet.size === 0) {
    add(
      'get_village_profile',
      'get_service_info',
      'search_knowledge',
      'search_documents',
    );
  }

  if (isVillageProfileQuery && !hasMixedIntentFamilies) {
    add('get_village_profile');
    deny(
      'get_important_contact',
      'get_emergency_contacts',
      'get_service_info',
      'create_service_request',
      'search_knowledge',
      'search_documents',
      'create_complaint',
      'get_complaint_categories',
      'get_my_history',
      'search_user_memory',
      'check_status',
      'cancel_request',
      'get_service_request_edit_link',
      'update_complaint',
    );
  }

  if (isLocalKnowledgeQuery && !hasMixedIntentFamilies) {
    add('search_knowledge');
    deny(
      'get_village_profile',
      'get_important_contact',
      'get_emergency_contacts',
      'get_service_info',
      'create_service_request',
      'search_documents',
      'create_complaint',
      'get_complaint_categories',
      'get_my_history',
      'search_user_memory',
      'check_status',
      'cancel_request',
      'get_service_request_edit_link',
      'update_complaint',
    );
  }

  if (isContactDirectoryLookupIntent && !hasMixedIntentFamilies) {
    add('get_important_contact');
    [
      'get_emergency_contacts',
      'get_service_info',
      'create_service_request',
      'search_knowledge',
      'search_documents',
      'create_complaint',
      'get_complaint_categories',
      'get_my_history',
      'search_user_memory',
      'check_status',
      'cancel_request',
      'get_service_request_edit_link',
      'update_complaint',
      'get_village_profile',
    ].forEach((tool) => heuristicSet.delete(tool as AgentToolName));
  }

  const heuristicTools = Array.from(heuristicSet);
  const suggestedTools = Array.from(suggestedSet);
  const hardDeniedTools = Array.from(hardDeniedSet);
  const learnedPolicy = await resolveLearnedToolPolicy(userMessage);
  const learnedTools = (isContactDirectoryLookupIntent
    ? (learnedPolicy.tools || []).filter((tool) => tool === 'get_important_contact')
    : learnedPolicy.tools || []
  ).filter((tool) => !hardDeniedSet.has(tool) && (!isMutationTool(tool) || heuristicSet.has(tool)));
  const allowedToolNames = Array.from(new Set<AgentToolName>([
    ...heuristicTools,
    ...learnedTools,
  ])).filter((tool) => !hardDeniedSet.has(tool));
  const requiredTools = Array.from(requiredSet).filter((tool) => allowedToolNames.includes(tool));

  const policyReasons = [
    suggestedTools.length > 0 ? `routing_hints:${suggestedTools.join(',')}` : null,
    requiredTools.length > 0 ? `required:${requiredTools.join(',')}` : null,
    hardDeniedTools.length > 0 ? `denied:${hardDeniedTools.join(',')}` : null,
    routingDecision?.mixedSignals ? 'mixed_signals_broadened' : null,
    learnedTools.length > 0 ? 'learned_policy_applied' : 'heuristic_policy_applied',
  ].filter(Boolean).join('|');

  return {
    heuristicTools,
    learnedTools,
    suggestedTools,
    requiredTools,
    hardDeniedTools,
    allowedToolNames,
    matchedPolicyKey: learnedPolicy.matchedPolicyKey,
    matchedPolicySource: learnedPolicy.matchedPolicySource,
    matchedPolicyConfidence: learnedPolicy.confidence,
    toolPolicyReason: policyReasons,
  };
}

export const __test_only__ = {
  selectAllowedTools,
  detectAmbiguousIntent,
  resolveFirstTurnToolChoice,
  parseTextToolCall,
  shouldAllowTextToolFallback,
  derivePreferredToolReply,
  shouldStopAfterSufficientServiceInfo,
  getUncoveredMixedIntentFamilies,
  shouldForceMixedIntentContinuation,
  buildMixedIntentLoopExhaustedReply,
};
