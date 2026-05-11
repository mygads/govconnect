/**
 * Unified Message Processor Service — ORCHESTRATOR
 *
 * SINGLE SOURCE OF TRUTH for message processing across all channels
 * (WhatsApp, Webchat, etc.).
 *
 * Decomposed into focused modules (Jan 2025):
 *   ump-types.ts         — shared interfaces (ProcessMessageInput/Result)
 *   ump-state.ts         — LRU caches, photo helpers, pending-state accessors
 *   ump-utils.ts         — name extraction, history, address, context builders
 *   complaint-handler.ts — complaint CRUD + address confirmation
 *   service-handler.ts   — service info / request / edit
 *   status-handler.ts    — status check (complaint & service request)
 *   agent/*              — single orchestrator agent + explicit tools
 *
 * This file retains only:
 *   • processUnifiedMessage (the main orchestrator)
 *   • barrel re-exports for backward compatibility
 */

import logger from '../utils/logger';
import { formatVillageDateTimeForPrompt } from '../utils/wib-datetime';
import { sanitizeUserInput } from './context-builder.service';
import { getVillageProfileSummary } from './knowledge.service';
import { isSpamMessage } from './rag.service';
import { getAutoFillSuggestionsWithFallback } from './user-profile.service';
import { normalizeText } from './text-normalizer.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { createProcessingTracker } from './processing-status.service';
import { getSmartFallback, getErrorFallback } from './fallback-response.service';
import { validateResponse } from './ump-formatters';
import { getCachedResponse, setCachedResponse } from './response-cache.service';
import { buildHybridMemorySummary } from './hybrid-memory.service';
import { recordGuardrailEvent } from './runtime-observability.service';
import { recordToolPolicyEvent } from './agent/tool-policy.service';
import { recordToolExecutionTraces } from './tool-execution-trace.service';
import { verifyAnswer } from './answer-policy.service';
import { reconcile as reconcileDbVsRag } from './db-rag-reconciler.service';
import {
  isCrossChannelEnabled,
  getCrossChannelContextForLLM,
  linkUserToPhone,
  updateSharedData,
  recordChannelActivity,
} from './cross-channel-context.service';
import {
  recordUnhelpful,
  recordHelpful,
  isStuck,
  buildStuckEscalationSuffix,
  type UnhelpfulReason,
} from './stuck-user-tracker.service';
import {
  extractAndRecordPromises,
  resolvePromisesByKind,
  buildOpenPromisesContext,
  deriveFulfilledPromisesFromTools,
  resolveForwardPromiseOnTakeover,
} from './promise-tracker.service';
import {
  analyzeSentimentWithLLM,
  getSentimentContext,
  needsHumanEscalation,
} from './sentiment-analysis.service';
import { startTakeoverForUser } from './channel-client.service';
import { getEnhancedContext } from './conversation-context.service';
import { getVillageBehaviorConfig, formatVillageBehaviorConfig } from './village-behavior.service';
import { canProcessVillageAI } from './ai-wallet.service';
import { finishAiBillingTurn, startAiBillingTurn, type AiBillingTurnHandle } from './ai-turn-billing.service';
import { analyzeIncomingMedia } from './media-analysis.service';

// ── Decomposed module imports ──
import type { ProcessMessageInput, ProcessMessageResult } from './ump-types';
import {
  incrementActiveProcessing,
  decrementActiveProcessing,
  clearActiveServiceInfo,
  clearPendingEmergencyComplaintOffer,
  clearPendingServiceClarification,
  clearPendingServiceFormOffer,
  setPendingServiceFormOffer,
  getPendingServiceFormOfferWithFallback,
  getActiveServiceInfoWithFallback,
  getPendingServiceClarificationWithFallback,
  getPendingAddressConfirmationWithFallback,
  getPendingAddressRequestWithFallback,
  getPendingComplaintDataWithFallback,
  getPendingEmergencyComplaintOfferWithFallback,
  getPendingCancelConfirmationWithFallback,
  withUserLock,
} from './ump-state';
import {
  fetchConversationHistoryFromChannel,
  appendToHistoryCache,
  buildAgentConversationContext,
  deriveLastDiscussedServiceContext,
} from './ump-utils';
import { handleComplaintCreation, handleComplaintUpdate, handleCancellationRequest, handleHistory } from './complaint-handler';
import { handleServiceInfo, handleServiceRequestCreation } from './service-handler';
import { runAgent } from './agent';
import { handleStatusCheck } from './status-handler';
import {
  decideFastIntent,
  tryHandleActiveServiceFollowUp,
  tryHandleGreetingShortcut,
  tryHandleLatePreAgentState,
  tryHandlePendingOffers,
  tryHandlePendingServiceClarification,
  tryHandleProtocolGuards,
  tryHandleOutOfScopeGuard,
  tryHandleServiceListingShortcut,
  type FastIntentDecision,
} from './pre-agent-state-router.service';

// ── Barrel re-exports (backward compatibility) ──
export type { ChannelType } from './ump-formatters';
export { validateResponse } from './ump-formatters';
export type { ProcessMessageInput, ProcessMessageResult } from './ump-types';
export {
  clearAllUMPCaches,
  clearUserCaches,
  getUMPCacheStats,
  getActiveProcessingCount,
  drainActiveProcessing,
  getPendingAddressConfirmation,
  clearPendingAddressConfirmation,
  setPendingAddressConfirmation,
  clearPendingCancelConfirmation,
  setPendingCancelConfirmation,
  getPendingServiceFormOffer,
  clearPendingServiceFormOffer,
  setPendingServiceFormOffer,
  getPendingAddressRequest,
  clearPendingAddressRequest,
  setPendingAddressRequest,
} from './ump-state';
export { isVagueAddress, resolveComplaintTypeConfig } from './ump-utils';
export { handleComplaintCreation, handleComplaintUpdate, handleCancellationRequest, handleHistory } from './complaint-handler';
export { handleServiceInfo, handleServiceRequestCreation, handleServiceRequestEditLink } from './service-handler';
export { handleStatusCheck } from './status-handler';

/**
 * Process message from any channel
 * This is the SINGLE SOURCE OF TRUTH for message processing
 * 
 * OPTIMIZATION FLOW:
 * 1. Spam check
 * 2. Pending state check
 * 3. Fast intent classification (NEW)
 * 4. Response cache check (NEW)
 * 5. Entity pre-extraction (NEW)
 * 6. If fast path available → return cached/quick response
 * 7. Otherwise → full LLM processing
 */

// ── Agent mode helpers ──

interface AgentProcessInput {
  userId: string;
  message: string;
  channel: 'whatsapp' | 'webchat';
  isEvaluation?: boolean;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
  villageId?: string;
  conversationSummary?: string;
  recentConversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  activeServiceSlug?: string;
  activeServiceName?: string;
  memorySummary?: string;
  villageName?: string;
  villageTimezone?: string | null;
  userName?: string | null;
  sentimentContext?: string;
  routingDecision?: FastIntentDecision;
  pendingStateSummary?: string;
  traceId: string;
  startTime: number;
  tracker: ReturnType<typeof createProcessingTracker>;
  notifyStage: (stage: string, progress: number) => void;
}

const CACHEABLE_AGENT_TOOLS = new Set([
  'get_village_profile',
  'get_complaint_categories',
  'get_emergency_contacts',
  'get_important_contact',
  'get_service_info',
  'search_knowledge',
  'search_documents',
]);

const DEFAULT_GROUNDING_SOURCE_BY_TOOL: Partial<Record<string, string>> = {
  get_village_profile: 'official_village_profile',
  get_service_info: 'official_service_info',
  get_important_contact: 'contact_directory_lookup',
  get_emergency_contacts: 'official_emergency_contacts',
};

interface PendingStateSnapshot {
  serviceOffer?: any;
  emergencyOffer?: any;
  serviceClarification?: any;
  activeServiceInfo?: any;
  addressConfirmation?: any;
  addressRequest?: any;
  complaintData?: any;
  cancelConfirmation?: any;
}

type RoutingOutcomeType = 'handled_pre_agent' | 'deferred_to_agent' | 'released_state_and_deferred' | 'hard_blocked';

interface RoutingOutcomeMeta {
  outcome: RoutingOutcomeType;
  reason: string;
  releasedStates?: string[];
  action?: string;
  primaryIntent?: string;
}

/**
 * Classify an outgoing result to decide whether it was "helpful" from
 * the user's perspective (tool success, direct content) or "unhelpful"
 * (guardrail rewrite, fallback template, tool error). Used by the stuck
 * tracker to offer human escalation after repeated misfires.
 */
function hasPendingOrActiveState(snapshot: PendingStateSnapshot): boolean {
  return Object.values(snapshot).some(Boolean);
}

function classifyHelpfulnessForStuck(result: ProcessMessageResult): 'helpful' | UnhelpfulReason | null {
  const guard = result.metadata?.guardrail;
  if (guard) {
    if (guard.stage === 'answer_policy') return 'answer_policy_rewrite';
    if (guard.stage === 'db_rag_reconciler') return 'reconciler_rewrite';
  }
  if (result.intent === 'TAKEOVER') return 'helpful';
  if (!result.success) return 'fallback_error';
  const trustLevels = new Set((result.metadata?.toolTrace || []).map((t) => t.success));
  if (trustLevels.size === 1 && trustLevels.has(false)) return 'tool_error';

  const responseText = (result.response || '').trim();
  const responseLength = responseText.length;
  const hasClarifyingPrompt = /\?|\b(mohon|silakan|sebutkan|balas|pilih|tuliskan)\b/i.test(responseText);
  const isStatefulClarificationIntent = ['QUESTION', 'SERVICE_INFO', 'CREATE_COMPLAINT', 'CREATE_SERVICE_REQUEST'].includes(result.intent);
  if (!result.metadata?.toolsUsed?.length && responseLength < 80 && hasClarifyingPrompt && isStatefulClarificationIntent) {
    return 'helpful';
  }

  // No tool usage + knowledge intent + very short response = often a generic fallback.
  if (responseLength < 30 && !result.metadata?.toolsUsed?.length) return 'retrieval_empty';
  return 'helpful';
}

/**
 * Record an outcome against the stuck tracker and, when threshold is
 * hit on an unhelpful result, append an escalation offer to the reply.
 * Idempotent for helpful results.
 */
function applyStuckTracker(
  userId: string,
  villageId: string | undefined,
  result: ProcessMessageResult,
): ProcessMessageResult {
  const kind = classifyHelpfulnessForStuck(result);
  if (!kind) return result;

  if (kind === 'helpful') {
    recordHelpful(userId, villageId);
    return result;
  }

  const consecutive = recordUnhelpful(userId, kind, villageId);
  if (!isStuck(userId, villageId)) return result;

  // Only inject the escalation suffix the first time threshold is hit
  // and when there's not already a takeover offer in the text.
  const alreadyOffered = /\b(petugas|takeover)\b/i.test(result.response || '');
  if (alreadyOffered) return result;

  logger.info('[StuckUser] Injecting human-takeover offer', {
    userId,
    villageId,
    consecutive,
    reason: kind,
  });

  return {
    ...result,
    response: `${result.response || ''}${buildStuckEscalationSuffix()}`,
  };
}

/**
 * Append cross-channel context block (if feature enabled) to the memory
 * summary passed to the agent. No-op when the feature flag is off, so
 * existing deployments stay byte-identical.
 */
function enrichMemoryWithCrossChannel(
  userId: string,
  memorySummary: string | undefined,
): string | undefined {
  if (!isCrossChannelEnabled()) return memorySummary;
  try {
    const block = getCrossChannelContextForLLM(userId);
    if (!block) return memorySummary;
    return memorySummary ? `${memorySummary}\n\n${block}` : block;
  } catch {
    return memorySummary;
  }
}

/**
 * Append open-promise reminder to the memory summary so the agent
 * doesn't forget what it told the user last turn. Bounded by the
 * promise tracker TTL (30 min).
 */
function enrichMemoryWithPromises(
  userId: string,
  villageId: string | undefined,
  memorySummary: string | undefined,
  currentMessage?: string,
): string | undefined {
  try {
    const block = buildOpenPromisesContext(userId, villageId, currentMessage);
    if (!block) return memorySummary;
    return memorySummary ? `${memorySummary}\n\n${block}` : block;
  } catch {
    return memorySummary;
  }
}

function syncCrossChannelContext(
  userId: string,
  channel: 'whatsapp' | 'webchat',
  sideEffectMode: ProcessMessageInput['sideEffectMode'],
  isEvaluation: boolean,
  profile: { alamat?: string; rt_rw?: string; nama_lengkap?: string; nik?: string; no_hp?: string },
): void {
  if (!isCrossChannelEnabled() || sideEffectMode === 'knowledge_test' || isEvaluation) {
    return;
  }

  try {
    const phoneNumber = channel === 'whatsapp' ? userId : profile.no_hp;
    if (phoneNumber) {
      linkUserToPhone(userId, phoneNumber);
    }

    const address = [profile.alamat, profile.rt_rw].filter(Boolean).join(', ');
    const sharedData: Record<string, string> = {};
    if (profile.nama_lengkap) sharedData.name = profile.nama_lengkap;
    if (profile.nik) sharedData.nik = profile.nik;
    if (address) sharedData.address = address;
    if (Object.keys(sharedData).length > 0) {
      updateSharedData(userId, sharedData);
    }

    recordChannelActivity(userId);
  } catch {
    // no-op: cross-channel context must never affect primary message handling
  }
}

function isShortContextualFollowUp(message: string): boolean {
  const normalized = (message || '').toLowerCase().trim();
  if (!normalized) return false;
  if (normalized.length > 40) return false;
  return /^(syarat(?:nya)?|biaya(?:nya)?|berapa lama|proses(?:nya)?|ada link\??|link(?:nya)?\??|form(?:nya)?\??|lanjut|iya|ya|oke|ok|siap|nomor\s*\d+|yang\s+.+|harus ke kantor\??|bisa online\??)[\s?.!]*$/i.test(normalized);
}

function buildPendingStateSummary(snapshot: PendingStateSnapshot): string | undefined {
  const lines: string[] = [];
  if (snapshot.serviceOffer?.service_slug) lines.push(`Pending tawaran link layanan: ${snapshot.serviceOffer.service_slug}`);
  if (snapshot.serviceClarification?.alternatives?.length) lines.push(`Pending klarifikasi layanan: ${snapshot.serviceClarification.alternatives.length} opsi`);
  if (snapshot.activeServiceInfo?.service_name) lines.push(`Layanan aktif dibahas: ${snapshot.activeServiceInfo.service_name}`);
  if (snapshot.emergencyOffer) lines.push('Pending tawaran laporan darurat');
  if (snapshot.addressConfirmation) lines.push('Pending konfirmasi alamat pengaduan');
  if (snapshot.addressRequest) lines.push('Pending alamat pengaduan');
  if (snapshot.complaintData?.waitingFor) lines.push(`Pending data pengaduan: ${snapshot.complaintData.waitingFor}`);
  if (snapshot.cancelConfirmation) lines.push('Pending konfirmasi pembatalan');
  return lines.length ? lines.join('\n') : undefined;
}

function shouldHandlePendingOffer(routingDecision: FastIntentDecision, snapshot: PendingStateSnapshot): boolean {
  if (!snapshot.serviceOffer && !snapshot.emergencyOffer) {
    return false;
  }
  if (routingDecision.action !== 'handle_pre_agent') {
    return false;
  }
  return routingDecision.stateAffinity === 'answers_pending_state';
}

function shouldHandlePendingServiceClarification(routingDecision: FastIntentDecision, snapshot: PendingStateSnapshot): boolean {
  if (!snapshot.serviceClarification) {
    return false;
  }
  return routingDecision.action === 'handle_pre_agent'
    && routingDecision.primaryIntent === 'service_clarification';
}

function shouldHandleActiveServiceFollowUp(routingDecision: FastIntentDecision, snapshot: PendingStateSnapshot): boolean {
  if (!snapshot.activeServiceInfo) {
    return false;
  }
  return routingDecision.action === 'handle_pre_agent'
    && routingDecision.primaryIntent === 'service_follow_up';
}

function shouldHandleServiceListing(routingDecision: FastIntentDecision): boolean {
  return routingDecision.action === 'handle_pre_agent'
    && routingDecision.primaryIntent === 'service_listing';
}

function shouldHardBlockOutOfScope(routingDecision: FastIntentDecision): boolean {
  return routingDecision.action === 'hard_block'
    && routingDecision.primaryIntent === 'out_of_scope';
}

function releaseStatesForRoutingDecision(
  userId: string,
  snapshot: PendingStateSnapshot,
  routingDecision: FastIntentDecision,
): string[] {
  if (routingDecision.action !== 'release_state_and_defer') {
    return [];
  }

  const releasedState: string[] = [];

  if (snapshot.serviceOffer) {
    clearPendingServiceFormOffer(userId);
    releasedState.push('pending_service_form_offer');
  }

  if (snapshot.serviceClarification) {
    clearPendingServiceClarification(userId);
    releasedState.push('pending_service_clarification');
  }

  if (snapshot.activeServiceInfo) {
    clearActiveServiceInfo(userId);
    releasedState.push('active_service_info');
  }

  if (snapshot.emergencyOffer) {
    clearPendingEmergencyComplaintOffer(userId);
    releasedState.push('pending_emergency_complaint_offer');
  }

  return releasedState;
}

/**
 * Derive `state_resume_result` for a guardrail-path outcome. This surfaces in
 * observability so RCA can quickly see whether a pending state was consumed,
 * skipped, overridden, or released.
 */
function buildDeferredRoutingOutcome(
  routingDecision: FastIntentDecision,
  releasedStates: string[],
): RoutingOutcomeMeta {
  const reason = routingDecision.reasons[0] || routingDecision.primaryIntent || routingDecision.action;
  return {
    outcome: routingDecision.action === 'release_state_and_defer'
      ? 'released_state_and_deferred'
      : 'deferred_to_agent',
    reason,
    ...(releasedStates.length > 0 ? { releasedStates } : {}),
    action: routingDecision.action,
    primaryIntent: routingDecision.primaryIntent,
  };
}

function deriveRoutingOutcome(result: ProcessMessageResult): RoutingOutcomeMeta | undefined {
  return (result.metadata as any)?.routingOutcome as RoutingOutcomeMeta | undefined;
}

function encodeToolPolicyReasonWithRouting(
  baseReason: string | undefined,
  result: ProcessMessageResult,
): string | undefined {
  const routingOutcome = deriveRoutingOutcome(result);
  if (!routingOutcome) {
    return baseReason;
  }

  return [
    baseReason,
    `route_outcome:${routingOutcome.outcome}`,
    `route_reason:${routingOutcome.reason}`,
    routingOutcome.releasedStates?.length
      ? `released_states:${routingOutcome.releasedStates.join(',')}`
      : undefined,
  ].filter(Boolean).join('|');
}

function deriveStateResumeResult(result: ProcessMessageResult): string | undefined {
  const routingOutcome = deriveRoutingOutcome(result);
  if (routingOutcome?.outcome === 'released_state_and_deferred') {
    return 'released';
  }

  const guardrail = result.metadata?.guardrail;
  if (!guardrail) return undefined;
  const stage = guardrail.stage || '';
  const type = guardrail.type || '';
  const action = guardrail.action || '';
  if (stage === 'pre_agent_state' && type === 'pending_state') {
    if (action === 'handled') return 'resumed';
    if (action === 'released') return 'released';
  }
  if (type === 'complaint_fsm_resume') return 'resumed';
  if (type === 'complaint_fsm_reprompt') return 'reprompted';
  if (type === 'service_clarification') {
    if (action === 'resolved') return 'resumed';
    if (action === 'narrowed') return 'narrowed';
    if (action === 're_prompted') return 'awaiting_input';
  }
  if (type === 'active_service_follow_up') return 'resumed';
  if (type === 'pending_offer') return 'resumed';
  if (type === 'contact_directory_lookup') return 'bypassed_by_lookup';
  if (type === 'service_listing_shortcut') return 'bypassed_by_listing';
  return undefined;
}

/**
 * Legacy helper kept for backwards-compat with older log exports. The new
 * schema persists these fields in dedicated columns, so new code should use
 * the column-level fields directly instead of this encoder.
 *
 * Shape: `raw_source | reasons=<compact-json>`
 */
function encodeDurablePolicySource(input: {
  source?: string;
  firstTurnToolChoice?: string;
  firstTurnToolChoiceReason?: string;
  toolPolicyReason?: string;
}): string | undefined {
  const baseSource = input.source || 'heuristic';
  const reasons: Record<string, string> = {};
  if (input.firstTurnToolChoice) reasons.firstTurnToolChoice = input.firstTurnToolChoice;
  if (input.firstTurnToolChoiceReason) reasons.firstTurnToolChoiceReason = input.firstTurnToolChoiceReason;
  if (input.toolPolicyReason) reasons.toolPolicyReason = input.toolPolicyReason;
  if (Object.keys(reasons).length === 0) {
    return baseSource;
  }
  return `${baseSource}|reasons=${JSON.stringify(reasons)}`;
}

// Keep a reference so the legacy helper stays exported for tools/tests.
void encodeDurablePolicySource;

function isCacheableAgentResult(result: ProcessMessageResult): boolean {
  if (result.intent === 'TAKEOVER' || result.metadata.handoff?.started) {
    return false;
  }

  const toolsUsed = Array.isArray(result.metadata?.toolsUsed) ? result.metadata.toolsUsed : [];
  if (toolsUsed.length === 0) {
    return false;
  }

  return toolsUsed.every((tool) => CACHEABLE_AGENT_TOOLS.has(tool));
}

function attachGroundingMetadata(result: ProcessMessageResult): ProcessMessageResult {
  const existing = result.metadata?.grounding;
  if (existing?.trustedTools?.length || existing?.sourceKinds?.length || existing?.hasTrustedFact || existing?.hasTrustedRecord) {
    return result;
  }

  const toolTrace = Array.isArray(result.metadata?.toolTrace) ? result.metadata.toolTrace : [];
  const trustedTrace = toolTrace.filter((trace) => trace.success && (trace.trustLevel === 'trusted_fact' || trace.trustLevel === 'trusted_record'));
  const trustedTools = new Set<string>();
  const sourceKinds = new Set<string>();

  for (const trace of trustedTrace) {
    if (trace.tool) trustedTools.add(trace.tool);
    if (trace.sourceKind) sourceKinds.add(trace.sourceKind);
  }

  const toolsUsed = Array.isArray(result.metadata?.toolsUsed) ? result.metadata.toolsUsed : [];
  for (const tool of toolsUsed) {
    const sourceKind = DEFAULT_GROUNDING_SOURCE_BY_TOOL[tool];
    if (sourceKind) {
      trustedTools.add(tool);
      sourceKinds.add(sourceKind);
    }
  }

  if (trustedTools.size === 0 && sourceKinds.size === 0) {
    return result;
  }

  return {
    ...result,
    metadata: {
      ...result.metadata,
      grounding: {
        trustedTools: Array.from(trustedTools),
        sourceKinds: Array.from(sourceKinds),
        hasTrustedFact: trustedTrace.some((trace) => trace.trustLevel === 'trusted_fact') || trustedTools.size > 0,
        hasTrustedRecord: trustedTrace.some((trace) => trace.trustLevel === 'trusted_record'),
      },
    },
  };
}

function normalizeAssistantText(text?: string): string | undefined {
  if (!text) return text;

  return text
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/^\s*berdasarkan\s+(informasi|data)(\s+yang\s+(tersedia|kami miliki))?(\s+dari\s+(sumber\s+resmi\s+desa|sistem|data\s+resmi))?,?\s*/i, '')
    .replace(/^\s*menurut\s+(informasi|data)(\s+yang\s+tersedia)?,?\s*/i, '')
    .replace(/^\s*secara\s+singkat:\s*/i, '')
    .trim();
}

function splitFollowUpGuidance(response: string, guidanceText?: string): { response: string; guidanceText?: string } {
  if (!response || guidanceText) {
    return { response, guidanceText };
  }

  const shouldSplitLine = (value: string): boolean => [
    /^ada yang (bisa|ingin) saya bantu lagi\??$/i,
    /^kalau (mau|ingin|perlu)\b/i,
    /^apakah .*bantu/i,
  ].some((pattern) => pattern.test(value));

  const parts = response
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const candidate = parts[parts.length - 1];
    if (shouldSplitLine(candidate)) {
      const mainResponse = parts.slice(0, -1).join('\n\n').trim();
      if (mainResponse) {
        return {
          response: mainResponse,
          guidanceText: candidate,
        };
      }
    }
  }

  const lines = response
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { response, guidanceText };
  }

  const candidateLine = lines[lines.length - 1];
  if (!shouldSplitLine(candidateLine)) {
    return { response, guidanceText };
  }

  const splitMarker = response.lastIndexOf(candidateLine);
  if (splitMarker <= 0) {
    return { response, guidanceText };
  }

  const mainResponse = response.slice(0, splitMarker).trim();
  if (!mainResponse) {
    return { response, guidanceText };
  }

  return {
    response: mainResponse,
    guidanceText: candidateLine,
  };
}

function getKnowledgeTestWorkflowBlock(message: string): { response: string; intent: string } | undefined {
  const normalized = (message || '').toLowerCase();
  const hasReference = /\b(?:lap|lay|lyn|rpt)-[\w-]+\b/i.test(message);

  if (hasReference && /\b(cek|status|tracking|lacak|batal|batalkan|cancel|hapus|delete|ubah|update|edit|revisi|riwayat|history)\b/i.test(normalized)) {
    return {
      intent: 'KNOWLEDGE_TEST_WORKFLOW_BLOCKED',
      response: 'Halaman uji knowledge ini tidak menjalankan cek status, pembatalan, perubahan data, atau riwayat laporan/layanan. Untuk menguji workflow itu secara end-to-end, gunakan kanal WhatsApp atau Webchat sebenarnya.',
    };
  }

  if (/\b(lapor|pengaduan|keluhan|aduan|buat laporan|bikin laporan)\b/i.test(normalized) && /\b(jalan rusak|jalan berlubang|lampu mati|sampah|drainase|banjir|pohon tumbang|fasilitas rusak|rt\s*\d+)\b/i.test(normalized)) {
    return {
      intent: 'KNOWLEDGE_TEST_WORKFLOW_BLOCKED',
      response: 'Halaman uji knowledge ini tidak membuat laporan atau pengaduan. Di sini hanya diuji kualitas jawaban knowledge/RAG. Untuk menguji pembuatan laporan, gunakan kanal WhatsApp atau Webchat sebenarnya.',
    };
  }

  if (/\b(buatkan|buat|ajukan|pengajuan|daftar|urus)\b/i.test(normalized) && /\b(layanan|permohonan|surat|domisili|sktm|ktp|kk|akta)\b/i.test(normalized) && !/\b(syarat|persyaratan|biaya|proses|cara|info|informasi)\b/i.test(normalized)) {
    return {
      intent: 'KNOWLEDGE_TEST_WORKFLOW_BLOCKED',
      response: 'Halaman uji knowledge ini tidak membuat permohonan layanan atau link formulir. Pertanyaan syarat/prosedur tetap bisa diuji di sini, tetapi workflow pengajuan perlu dites lewat WhatsApp atau Webchat sebenarnya.',
    };
  }

  if (/\b(riwayat|history|laporan saya|permohonan saya|layanan saya)\b/i.test(normalized)) {
    return {
      intent: 'KNOWLEDGE_TEST_WORKFLOW_BLOCKED',
      response: 'Halaman uji knowledge ini tidak mengambil riwayat personal user. Di sini hanya diuji jawaban knowledge/RAG global dari data desa.',
    };
  }

  return undefined;
}

function getResidentKnowledgeFallback(message: string, currentReply?: string): { response: string; intent: string; serviceSlug?: string } | undefined {
  const normalized = (message || '').toLowerCase();
  const reply = (currentReply || '').toLowerCase();
  const isGenericTimeout = !reply || reply.includes('membutuhkan waktu lebih lama') || reply.includes('informasinya belum berhasil kami temukan');
  const knowledge = (response: string) => ({ response, intent: 'KNOWLEDGE_QUERY' });


  if (/cara menggunakan govconnect|menggunakan govconnect|wa\/webchat|webchat/i.test(normalized) && isGenericTimeout) {
    return knowledge('Cara menggunakan GovConnect: tulis kebutuhan Bapak/Ibu lewat WA atau Webchat, misalnya ingin mengurus layanan surat, membuat pengaduan, atau cek status. Untuk cek status, kirim nomor LAP-... atau LAY-....');
  }

  if (/format pesan.*layanan|pesan yang direkomendasikan.*layanan|contoh format pesan/i.test(normalized) && isGenericTimeout) {
    return knowledge('Format pesan layanan yang disarankan: sebutkan jenis layanan, nama pemohon, kebutuhan, dan nomor kontak. Contoh: “Saya ingin mengurus surat domisili untuk keperluan administrasi, atas nama Budi.”');
  }

  if (/5w1h|prinsip 5w1h/i.test(normalized) && (isGenericTimeout || !reply.includes('what') || !reply.includes('where') || !reply.includes('when'))) {
    return knowledge('Prinsip 5W1H membantu laporan lebih jelas: What/apa yang terjadi, Who/siapa atau apa yang terdampak, When/kapan, Where/di mana, Why/mengapa penting, dan How/bagaimana kondisinya. Untuk laporan warga, yang paling wajib adalah lokasi, masalah, waktu, dampak, dan bukti foto bila ada.');
  }

  if (/status layanan\/pengaduan|status layanan.*notifikasi|notifikasinya/i.test(normalized)) {
    return knowledge('Status layanan/pengaduan umumnya: OPEN (menunggu diproses), PROCESS (sedang diproses), DONE (selesai), CANCELED (dibatalkan), dan REJECT (ditolak). Notifikasi dikirim lewat WA/Webchat saat ada perubahan status. Kalau Bapak/Ibu punya nomor LAP-... atau LAY-..., kirim nomornya dan saya bantu cek statusnya.');
  }

  if (/kanal pelayanan publik digital|kanal.*pelayanan.*digital/i.test(normalized) && (isGenericTimeout || !reply.includes('wa') || !reply.includes('webchat'))) {
    return knowledge('Kanal pelayanan publik digital yang tersedia adalah WA dan Webchat. Warga bisa memakai kanal tersebut untuk bertanya layanan, pengaduan, cek status, dan menerima notifikasi dari petugas.');
  }

  if (/checklist.*laporan pengaduan|laporan pengaduan.*berkualitas/i.test(normalized) && (isGenericTimeout || !reply.includes('lokasi') || !reply.includes('waktu'))) {
    return knowledge('Checklist laporan pengaduan yang baik: lokasi jelas, waktu kejadian, dampak yang dirasakan, deskripsi masalah singkat, dan foto/video bila ada. Semakin spesifik lokasinya, semakin cepat ditindaklanjuti.');
  }

  if (/contoh laporan pengaduan.*baik|pengaduan yang baik/i.test(normalized) && (isGenericTimeout || !reply.includes('baik'))) {
    return knowledge('Contoh laporan yang baik: “Jalan berlubang di depan Masjid Al-Ikhlas RT 02 RW 01 sejak kemarin sore. Lubangnya besar dan membahayakan pengendara motor.”\n\nIntinya sebutkan lokasi, waktu, dampak, dan lampirkan foto/video bila ada.');
  }

  if (/prioritas penanganan pengaduan/i.test(normalized) && (isGenericTimeout || !reply.includes('tinggi') || !reply.includes('sedang') || !reply.includes('rendah'))) {
    return knowledge('Prioritas penanganan pengaduan:\n1. Tinggi - mengancam keselamatan atau akses utama.\n2. Sedang - mengganggu aktivitas warga.\n3. Rendah - bisa dijadwalkan tanpa risiko mendesak.');
  }

  if (/tahap layanan umum|alur layanan umum|proses layanan umum/i.test(normalized) && isGenericTimeout) {
    return knowledge('Tahap layanan umum biasanya: Pengajuan masuk, berkas diverifikasi, diproses petugas, lalu selesai atau ditolak bila syarat belum sesuai. Statusnya bisa dicek dengan nomor LAY-....');
  }

  if (/format file.*diterima/i.test(normalized) && isGenericTimeout) {
    return knowledge('Format file yang diterima umumnya PDF, JPG, dan PNG. Pastikan dokumen jelas terbaca, tidak tertutup watermark/stiker, dan ukuran file tidak terlalu besar.');
  }

  if (/file terlalu besar|ukuran file.*besar/i.test(normalized) && (isGenericTimeout || !reply.includes('kompres'))) {
    return knowledge('Jika file terlalu besar, kompres dulu ukuran file atau unggah versi yang lebih ringan tetapi tetap jelas terbaca. Untuk foto, gunakan JPG/PNG yang tidak buram; untuk dokumen, PDF biasanya paling aman.');
  }

  if (/penamaan file|nama file.*benar|file yang benar/i.test(normalized) && (isGenericTimeout || !reply.includes('nik_'))) {
    return knowledge('Contoh penamaan file yang rapi: NIK_NamaPemohon.pdf, KTP_NamaPemohon.pdf, KK_NamaPemohon.pdf, atau SuratPengantar_RT01RW02.pdf. Hindari nama file terlalu umum seperti scan1.jpg agar petugas mudah memeriksa.');
  }

  if (/salah pilih layanan/i.test(normalized) && (isGenericTimeout || !reply.includes('ubah layanan'))) {
    return knowledge('Kalau salah pilih layanan, Bapak/Ibu bisa minta *ubah layanan* atau pembaruan data selama pengajuan masih bisa diproses. Jika sudah punya nomor layanan LAY-..., kirim nomornya agar saya bantu arahkan langkah berikutnya.');
  }

  if (/memperbarui data|update data.*terkirim|data yang sudah terkirim/i.test(normalized) && (isGenericTimeout || !reply.includes('ubah data'))) {
    return knowledge('Untuk memperbarui atau ubah data yang sudah terkirim, gunakan tautan edit layanan bila masih tersedia atau kirim nomor LAY-... agar saya bantu arahkan. Perubahan data biasanya hanya bisa dilakukan sebelum layanan berstatus final.');
  }

  if (/cek status layanan\/pengaduan|bagaimana cek status layanan|cek status.*pengaduan/i.test(normalized)) {
    return knowledge('Untuk cek status layanan atau pengaduan, kirim nomor referensi seperti LAP-... untuk laporan atau LAY-... untuk layanan. Setelah nomornya dikirim, saya bisa bantu tampilkan statusnya.');
  }

  if (/apa itu nomor layanan|nomor layanan lay|lay-\.\.\.|apa itu lay/i.test(normalized) && (isGenericTimeout || !reply.includes('lay-'))) {
    return knowledge('Nomor layanan LAY-... adalah nomor referensi permohonan layanan administrasi. Simpan nomor ini untuk cek status, menerima update, atau meminta tautan edit bila data perlu diperbaiki.');
  }

  if (/apa itu embedding/i.test(normalized) && (isGenericTimeout || !reply.includes('vektor'))) {
    return knowledge('Embedding adalah cara mengubah teks atau data menjadi angka vektor agar sistem bisa membandingkan kemiripan makna. Biasanya dipakai untuk pencarian informasi yang lebih relevan.');
  }

  if (/untuk apa data saya digunakan|penggunaan data/i.test(normalized) && (isGenericTimeout || !reply.includes('proses layanan'))) {
    return knowledge('Data Bapak/Ibu digunakan untuk proses layanan dan pengaduan yang sedang diajukan, seperti verifikasi identitas, pencatatan permohonan, tindak lanjut petugas, dan notifikasi status. Data tidak seharusnya dipakai di luar keperluan layanan tersebut.');
  }

  if (/keamanan data|data saya aman|bagaimana keamanan data/i.test(normalized) && (isGenericTimeout || !reply.includes('admin'))) {
    return knowledge('Data Bapak/Ibu hanya dapat diakses oleh admin berwenang untuk proses layanan atau pengaduan. Aktivitas admin dicatat untuk audit, dan data digunakan sesuai kebutuhan layanan yang sedang berjalan.');
  }

  return undefined;
}

function deriveAnalyticsIntent(result: ProcessMessageResult): string {
  if (result.intent && result.intent !== 'AGENT') {
    return result.intent;
  }

  const toolsUsed = Array.isArray(result.metadata?.toolsUsed) ? result.metadata.toolsUsed : [];

  if (toolsUsed.includes('create_complaint')) return 'CREATE_COMPLAINT';
  if (toolsUsed.includes('update_complaint')) return 'UPDATE_COMPLAINT';
  if (toolsUsed.includes('create_service_request')) return 'CREATE_SERVICE_REQUEST';
  if (toolsUsed.includes('get_service_request_edit_link')) return 'EDIT_SERVICE_REQUEST';
  if (toolsUsed.includes('check_status')) return 'CHECK_STATUS';
  if (toolsUsed.includes('cancel_request')) return 'CANCEL_REQUEST';
  if (toolsUsed.includes('get_my_history')) return 'HISTORY';
  if (toolsUsed.includes('get_important_contact')) return 'CONTACT_DIRECTORY';
  if (toolsUsed.includes('search_documents')) return 'DOCUMENT_SEARCH';
  if (toolsUsed.includes('search_knowledge')) return 'KNOWLEDGE_QUERY';
  if (toolsUsed.includes('get_service_info')) return 'SERVICE_INFO';
  if (toolsUsed.includes('get_village_profile')) return 'VILLAGE_PROFILE';
  if (toolsUsed.includes('get_emergency_contacts')) return 'EMERGENCY_CONTACTS';
  if (toolsUsed.includes('search_user_memory')) return 'MEMORY_LOOKUP';

  return result.intent || 'DIRECT_RESPONSE';
}

function deriveAnalyticsSource(result: ProcessMessageResult): string {
  if (result.intent === 'SPAM') return 'spam_guard';
  if (result.intent === 'ERROR') return 'fallback_error';
  if (result.intent === 'TAKEOVER') return 'human_handoff';
  if (result.metadata.agentMode === 'response_cache') return 'response_cache';
  if (result.metadata.agentMode === 'single_orchestrator') return 'agent';
  if (result.metadata.agentMode === 'pre_agent_guard') return 'pre_agent_guard';
  return 'orchestrator';
}

function isExplicitHumanHandoffRequest(message: string): boolean {
  const text = (message || '').toLowerCase().trim();
  if (!text) return false;

  return [
    /\bcs\s+manusia\b/,
    /\b(?:petugas|admin|operator)\s+(?:asli|manusia|desa)\b/,
    /^operator[\s!.,?]*$/,
    /\b(?:minta|mohon)\s+(?:petugas|admin|operator|manusia)\b/,
    /\b(?:minta|mohon|tolong|ingin|mau|butuh|perlu)\b.*\b(?:dibantu|disambungkan|dialihkan|diteruskan|bicara|ngobrol|chat)\b.*\b(?:petugas|admin|operator|manusia)\b/,
    /\b(?:hubungkan|sambungkan|disambungkan|alih(?:kan)?|dialihkan|teruskan|diteruskan)\b.*\b(?:petugas|admin|operator|manusia)\b/,
    /\b(?:mau|ingin|butuh|perlu)\s+(?:orang|manusia|petugas|admin|operator)\b/,
  ].some((pattern) => pattern.test(text));
}

function buildHumanHandoffReply(reason: string): string {
  if (reason === 'user_requested_human_agent') {
    return 'Baik, percakapan ini kami teruskan ke petugas agar dibantu lebih lanjut. Mohon tunggu sebentar ya.';
  }

  return 'Baik, supaya penanganannya lebih pas, percakapan ini kami teruskan ke petugas dulu ya. Mohon tunggu sebentar.';
}

async function maybeTriggerHumanHandoff(input: {
  userId: string;
  channel: 'whatsapp' | 'webchat';
  villageId?: string;
  villageName?: string | null;
  message: string;
  result: ProcessMessageResult;
  sentiment: Awaited<ReturnType<typeof analyzeSentimentWithLLM>>;
  conversationSummary?: string;
  recentConversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  memorySummary?: string;
  isEvaluation?: boolean;
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
}): Promise<{ started: boolean; reason?: string; response?: string }> {
  if (input.isEvaluation || input.sideEffectMode === 'knowledge_test') {
    return { started: false };
  }

  let handoffReason: string | undefined;

  if (isExplicitHumanHandoffRequest(input.message)) {
    handoffReason = 'user_requested_human_agent';
  } else {
    const ctx = getEnhancedContext(input.userId);
    if (input.result.intent === 'AGENT_ERROR') {
      handoffReason = 'agent_error';
    } else if (input.sentiment.isEscalationCandidate || needsHumanEscalation(input.userId)) {
      handoffReason = 'negative_sentiment_escalation';
    } else if (ctx.needsHumanHelp) {
      handoffReason = 'conversation_stuck';
    }
  }

  if (!handoffReason) {
    return { started: false };
  }

  const started = await startTakeoverForUser(input.userId, {
    village_id: input.villageId,
    channel: input.channel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
    admin_id: 'system-auto-handoff',
    admin_name: 'Petugas Desa',
    reason: handoffReason,
    enrichment: {
      intent: input.result.intent,
      last_user_message: input.message,
      conversation_summary: input.conversationSummary || null,
      recent_messages: (input.recentConversationHistory || []).slice(-6),
      active_status: input.result.metadata.agentMode || null,
      related_numbers: Array.from(new Set(input.message.match(/\b(?:LAP|LAY|LYN|RPT)-[A-Z0-9-]+\b/gi) || [])),
      escalation_reason: handoffReason,
      sentiment: input.sentiment.level,
      channel: input.channel,
      village_id: input.villageId || null,
      village_name: input.villageName || null,
      tools_used: input.result.metadata.toolsUsed || [],
      memory_summary: input.memorySummary || null,
    },
  });

  return {
    started,
    reason: handoffReason,
    response: started ? buildHumanHandoffReply(handoffReason) : undefined,
  };
}

async function processWithAgent(input: AgentProcessInput): Promise<ProcessMessageResult> {
  const {
    userId,
    message,
    channel,
    villageId,
    conversationSummary,
    recentConversationHistory,
    activeServiceSlug,
    activeServiceName,
    memorySummary,
    villageName,
    villageTimezone,
    userName,
    sentimentContext,
    routingDecision,
    pendingStateSummary,
    sideEffectMode,
    traceId,
    startTime,
    tracker,
    notifyStage,
  } = input;

  tracker.thinking();
  notifyStage('thinking', 60);

  try {
    const villageBehavior = await getVillageBehaviorConfig(villageId);
    const villageBehaviorSummary = formatVillageBehaviorConfig(villageBehavior);

    const result = await runAgent(
      message,
      {
        villageName: villageName ?? undefined,
        villageBehaviorSummary,
        memorySummary,
        currentDatetime: formatVillageDateTimeForPrompt(villageTimezone),
        userName,
        sentimentContext,
        routingDecision,
        pendingStateSummary,
        sideEffectMode,
      },
      {
        userId,
        villageId,
        channel,
        traceId,
        isEvaluation: input.isEvaluation,
        sideEffectMode,
        activeServiceSlug,
        activeServiceName,
      },
      {
        summary: conversationSummary,
        recentMessages: recentConversationHistory,
        activeServiceSlug,
        activeServiceName,
        routingDecision,
      },
    );

    tracker.complete();
    notifyStage('done', 100);

    logger.info('🤖 [Agent] Response generated', {
      traceId,
      userId,
      channel,
      mode: 'agent',
      toolsUsed: result.toolsUsed,
      iterations: result.iterations,
      totalTokens: result.totalTokens,
      model: result.model,
      durationMs: result.durationMs,
    });

    const derivedIntent = (() => {
      const toolSet = new Set(result.toolsUsed || []);
      if (toolSet.has('create_complaint')) return 'CREATE_COMPLAINT';
      if (toolSet.has('update_complaint')) return 'UPDATE_COMPLAINT';
      if (toolSet.has('create_service_request')) return 'CREATE_SERVICE_REQUEST';
      if (toolSet.has('get_service_request_edit_link')) return 'EDIT_SERVICE_REQUEST';
      if (toolSet.has('check_status')) return 'CHECK_STATUS';
      if (toolSet.has('cancel_request')) return 'CANCEL_REQUEST';
      if (toolSet.has('get_my_history')) return 'HISTORY';
      if (toolSet.has('get_important_contact')) return 'CONTACT_DIRECTORY';
      if (toolSet.has('search_documents') && !toolSet.has('search_knowledge')) return 'DOCUMENT_SEARCH';
      if (toolSet.has('search_knowledge')) return 'KNOWLEDGE_QUERY';
      if (toolSet.has('search_documents')) return 'DOCUMENT_SEARCH';
      if (toolSet.has('get_village_profile')) return 'KNOWLEDGE_QUERY';
      if (toolSet.has('get_emergency_contacts')) return 'EMERGENCY_CONTACTS';
      if (toolSet.has('search_user_memory')) return 'MEMORY_LOOKUP';
      if (toolSet.has('get_service_info') && !toolSet.has('create_service_request')) return 'SERVICE_INFO';
      return 'AGENT';
    })();

    const residentKnowledgeFallback = getResidentKnowledgeFallback(message, result.replyText);
    if (residentKnowledgeFallback?.serviceSlug && sideEffectMode !== 'knowledge_test') {
      setPendingServiceFormOffer(userId, {
        service_slug: residentKnowledgeFallback.serviceSlug,
        village_id: villageId,
        timestamp: Date.now(),
      });
    }
    const finalIntent = residentKnowledgeFallback?.intent || derivedIntent;
    const finalResponse = residentKnowledgeFallback?.response || result.replyText;

    return {
      success: true,
      response: finalResponse,
      guidanceText: result.guidanceText,
      intent: finalIntent,
      metadata: {
        processingTimeMs: Date.now() - startTime,
        model: result.model,
        hasKnowledge: result.toolsUsed.includes('search_knowledge') || result.toolsUsed.includes('search_documents'),
        agentMode: 'single_orchestrator',
        sideEffectMode,
        toolsUsed: result.toolsUsed,
        allowedTools: result.allowedToolNames,
        heuristicTools: result.heuristicTools,
        learnedTools: result.learnedTools,
        toolPolicy: {
          policyKey: result.matchedPolicyKey,
          policySource: result.matchedPolicySource,
          confidence: result.matchedPolicyConfidence,
          firstTurnToolChoice: result.firstTurnToolChoice,
        },
        toolTrace: result.toolTrace,
        // Extra durable reasoning fields. These are read back in the finally
        // block to encode into ai_tool_policy_events.policy_source without
        // needing a schema migration. Stored via any-cast since the public
        // metadata interface doesn't advertise them.
        ...({
          toolPolicyReason: result.toolPolicyReason,
          firstTurnToolChoiceReason: result.firstTurnToolChoiceReason,
        } as any),
        ...(routingDecision ? { routing: routingDecision } : {}),
        ...(result.guardrail ? {
          guardrail: {
            stage: 'agent_orchestrator',
            type: result.guardrail.type,
            action: 'handled',
            reason: result.guardrail.trigger,
            details: {
              toolName: result.guardrail.toolName,
              sourceKind: result.guardrail.sourceKind,
              iterations: result.guardrail.iterations,
              toolsUsed: result.toolsUsed,
            },
          },
        } : {}),
        traceId,
      },
    };
  } catch (error: any) {
    logger.error('🤖 [Agent] Error', { traceId, userId, error: error.message });
    tracker.complete();

    return {
      success: true,
      response: 'Maaf, terjadi gangguan pada sistem. Silakan coba lagi nanti.',
      intent: 'AGENT_ERROR',
      metadata: {
        processingTimeMs: Date.now() - startTime,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId,
      },
      error: error.message,
    };
  }
}

export async function processUnifiedMessage(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  // Per-user serialization: if the same user sends two messages in quick
  // succession, process them in FIFO order so shared state (pending
  // complaint address, active service offer, etc.) doesn't interleave.
  // Different users still run in parallel.
  if (input.userId && !input.isEvaluation) {
    return withUserLock(input.userId, () => processUnifiedMessageInternal(input));
  }
  return processUnifiedMessageInternal(input);
}

async function processUnifiedMessageInternal(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  incrementActiveProcessing();
  const startTime = Date.now();
  const { userId, message, channel, conversationHistory, mediaUrl, villageId, isEvaluation, sideEffectMode, onStageChange, messageId, batchedMessageIds } = input;
  let workingMessage = message;
  let resolvedHistory = conversationHistory;
  let villageTimezone: string | null = null;
  let finalResult: ProcessMessageResult | null = null;
  let routingOutcome: RoutingOutcomeMeta | undefined;
  const finish = (result: ProcessMessageResult) => {
    result = attachGroundingMetadata(result);

    if (sideEffectMode) {
      result.metadata.sideEffectMode = sideEffectMode;
    }
    if (routingOutcome) {
      (result.metadata as any).routingOutcome = routingOutcome;
    }

    // Stuck-user tracker: injects a human-takeover offer if the user
    // has hit several unhelpful outcomes in a row. No-op in evaluation
    // mode because we don't want evaluation runs to mutate tracking.
    if (!isEvaluation && sideEffectMode !== 'knowledge_test') {
      result = applyStuckTracker(userId, villageId, result);

      // Resolve promises that successful tool calls effectively
      // fulfilled, then extract any NEW promises from the outgoing
      // reply so we can remind the agent next turn.
      try {
        const fulfilled = deriveFulfilledPromisesFromTools(result.metadata?.toolsUsed || []);
        if (fulfilled.length > 0) resolvePromisesByKind(userId, fulfilled, villageId);
        // Takeover path always fulfills "will_forward" — the user is now
        // with a human, so the forward promise is done.
        if (result.intent === 'TAKEOVER') {
          resolveForwardPromiseOnTakeover(userId, villageId);
        }
        extractAndRecordPromises(userId, result.response || '', {
          villageId,
          turnId: result.metadata?.traceId,
        });
      } catch (err: any) {
        logger.debug('[PromiseTracker] skipped', { error: err?.message });
      }
    }

    const normalizedResponse = normalizeAssistantText(result.response) || result.response;
    result.response = validateResponse(normalizedResponse);

    if (result.guidanceText) {
      const normalizedGuidance = normalizeAssistantText(result.guidanceText) || result.guidanceText;
      result.guidanceText = validateResponse(normalizedGuidance);
    }

    const split = splitFollowUpGuidance(result.response, result.guidanceText);
    result.response = split.response;
    result.guidanceText = split.guidanceText;
    finalResult = result;
    return result;
  };
  
  // Generate trace ID for correlating all logs in this request
  const traceId = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const resolvedMessageId = messageId || `webchat:${userId}:${traceId}`;
  const billingGroupId = villageId
    ? `msg:${villageId}:${resolvedMessageId}`
    : `${channel}:${userId}:${traceId}`;
  const billingTurn: AiBillingTurnHandle | null = isEvaluation || sideEffectMode === 'knowledge_test'
    ? null
    : startAiBillingTurn({
        village_id: villageId ?? null,
        message_id: resolvedMessageId,
        trace_id: traceId,
        billing_group_id: billingGroupId,
        batched_message_ids: batchedMessageIds ?? [],
        wa_user_id: channel === 'whatsapp' ? userId : null,
        session_id: channel === 'webchat' ? userId : null,
        channel,
      });

  const tracker = createProcessingTracker(userId);
  
  // Wire up onStageChange callback so the caller (e.g. WhatsApp orchestrator)
  // can react to processing stage transitions (e.g. start typing at 80%).
  const notifyStage = (stage: string, progress: number) => {
    if (onStageChange) {
      try { onStageChange(stage, progress); } catch (_) { /* non-critical */ }
    }
  };
  
  const recordGuardrail = async (input: Parameters<typeof recordGuardrailEvent>[0]) => {
    if (sideEffectMode !== 'knowledge_test') {
      await recordGuardrailEvent(input);
    }
  };

  logger.info('🎯 [UnifiedProcessor] Processing message', {
    traceId,
    userId,
    channel,
    messageLength: workingMessage.length,
    hasHistory: !!conversationHistory,
    hasMedia: !!mediaUrl,
  });
  
  try {
    const resolvedVillageId = villageId;
    const agentChannel = channel === 'webchat' ? 'webchat' : 'whatsapp';
    const walletGate = await canProcessVillageAI(resolvedVillageId);
    const explicitHumanHandoffRequest = isExplicitHumanHandoffRequest(workingMessage);
    if (!walletGate.allowed) {
      logger.warn('AI processing blocked by wallet gate', {
        traceId,
        userId,
        villageId: resolvedVillageId,
        balanceUsd: walletGate.balanceUsd,
        status: walletGate.status,
        reason: walletGate.reason,
        explicitHumanHandoffRequest,
      });

      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: 'pre_agent_balance',
        guardType: 'wallet_balance',
        action: explicitHumanHandoffRequest ? 'handoff_allowed' : 'blocked',
        reason: walletGate.reason || 'wallet_exhausted',
        messagePreview: workingMessage,
        metadata: {
          balance_usd: walletGate.balanceUsd ?? null,
          wallet_status: walletGate.status ?? null,
          explicit_handoff: explicitHumanHandoffRequest,
        },
      });

      if (explicitHumanHandoffRequest) {
        const started = !isEvaluation && sideEffectMode !== 'knowledge_test' && await startTakeoverForUser(userId, {
          village_id: resolvedVillageId,
          channel: agentChannel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
          admin_id: 'system-auto-handoff',
          admin_name: 'Petugas Desa',
          reason: 'user_requested_human_agent_wallet_exhausted',
          enrichment: {
            last_user_message: workingMessage,
            wallet_status: walletGate.status ?? null,
            balance_usd: walletGate.balanceUsd ?? null,
            village_id: resolvedVillageId ?? null,
          },
        });

        tracker.complete();
        notifyStage('done', 100);

        return finish({
          success: true,
          response: started
            ? 'Baik, karena saldo AI desa sedang habis, percakapan ini kami teruskan ke petugas agar dibantu langsung. Mohon tunggu sebentar ya.'
            : 'Saldo AI desa sedang habis. Silakan hubungi petugas desa agar dibantu langsung.',
          intent: 'TAKEOVER',
          metadata: {
            processingTimeMs: Date.now() - startTime,
            hasKnowledge: false,
            agentMode: 'pre_agent_guard',
            toolsUsed: [],
            traceId,
            handoff: {
              started: !!started,
              reason: 'user_requested_human_agent_wallet_exhausted',
            },
            walletStatus: walletGate.status,
            walletBalanceUsd: walletGate.balanceUsd,
            guardrail: {
              stage: 'pre_agent_balance',
              type: 'wallet_balance',
              action: 'handoff_allowed',
              reason: walletGate.reason || 'wallet_exhausted',
            },
          },
        });
      }

      tracker.complete();
      notifyStage('done', 100);

      return finish({
        success: false,
        response: 'Maaf, saldo AI desa sedang habis. Silakan hubungi admin desa untuk mengisi saldo agar layanan AI bisa digunakan kembali.',
        intent: 'WALLET_EXHAUSTED',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
          traceId,
          walletStatus: walletGate.status,
          walletBalanceUsd: walletGate.balanceUsd,
          guardrail: {
            stage: 'pre_agent_balance',
            type: 'wallet_balance',
            action: 'blocked',
            reason: walletGate.reason || 'wallet_exhausted',
          },
        },
        error: walletGate.reason,
      });
    }

    // Update status: reading message
    tracker.reading();
    notifyStage('reading', 20);
    
    // Step 0: Input length guard — reject absurdly long messages before any LLM work
    const MAX_INPUT_LENGTH = 4000; // ~1000 tokens, well above any realistic user message
    if (workingMessage.length > MAX_INPUT_LENGTH) {
      logger.warn('🚫 [UnifiedProcessor] Message too long, rejected', { traceId, userId, channel, length: workingMessage.length });
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId,
        channel,
        guardStage: 'unified_processor',
        guardType: 'input_length',
        action: 'blocked',
        reason: 'message_too_long',
        messagePreview: workingMessage,
        metadata: {
          length: workingMessage.length,
          maxLength: MAX_INPUT_LENGTH,
        },
      });
      return finish({
        success: true,
        response: 'Maaf, pesan Anda terlalu panjang. Mohon kirim pesan yang lebih singkat (maksimal beberapa paragraf).',
        intent: 'UNKNOWN',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
          traceId,
          guardrail: {
            stage: 'unified_processor',
            type: 'input_length',
            action: 'blocked',
            reason: 'message_too_long',
          },
        },
      });
    }

    // Step 1: Spam check
    if (isSpamMessage(workingMessage)) {
      logger.warn('🚫 [UnifiedProcessor] Spam detected', { userId, channel });
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId,
        channel,
        guardStage: 'unified_processor',
        guardType: 'spam_content',
        action: 'blocked',
        reason: 'content_spam_pattern',
        messagePreview: workingMessage,
      });
      return finish({
        success: false,
        response: '',
        intent: 'SPAM',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
          traceId,
          guardrail: {
            stage: 'unified_processor',
            type: 'spam_content',
            action: 'blocked',
            reason: 'content_spam_pattern',
          },
        },
        error: 'Spam message detected',
      });
    }

    // Cumulative timeout budget for micro-NLU classifiers (prevents worst-case stacking)
    const MICRO_NLU_BUDGET_MS = 8000;
    let microNluElapsedMs = 0;
    const hasMicroNluBudget = () => microNluElapsedMs < MICRO_NLU_BUDGET_MS;
    const withMicroNluBudget = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      if (!hasMicroNluBudget()) {
        logger.warn('[UnifiedProcessor] Micro-NLU budget exhausted, skipping classifier', {
          elapsed: microNluElapsedMs, budget: MICRO_NLU_BUDGET_MS,
        });
        return fallback;
      }
      const t0 = Date.now();
      try {
        const remaining = MICRO_NLU_BUDGET_MS - microNluElapsedMs;
        let timeout: NodeJS.Timeout | undefined;
        try {
          return await Promise.race([
            fn(),
            new Promise<T>((_, reject) => {
              timeout = setTimeout(() => reject(new Error('Micro-NLU budget timeout')), remaining);
            }),
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      } finally {
        microNluElapsedMs += Date.now() - t0;
      }
    };

    if ((channel === 'whatsapp' || channel === 'webchat') && mediaUrl && (input.mediaType === 'image' || input.mediaType === 'photo' || input.mediaType === 'audio' || input.mediaType === 'voice')) {
      const mediaAnalysis = await analyzeIncomingMedia({
        mediaUrl,
        mediaType: input.mediaType,
        message: workingMessage,
        villageId: resolvedVillageId,
        userId,
        channel,
      });
      if (mediaAnalysis?.status === 'ok') {
        workingMessage = `${workingMessage}\n\n[Analisis media AI]\n${mediaAnalysis.description}`.trim();
      } else if (mediaAnalysis?.response && workingMessage.trim().length < 8) {
        tracker.complete();
        notifyStage('done', 100);
        return finish({
          success: true,
          response: mediaAnalysis.response,
          intent: 'QUESTION',
          metadata: {
            processingTimeMs: Date.now() - startTime,
            hasKnowledge: false,
            traceId,
            agentMode: 'pre_agent_guard',
          },
        });
      }
    }

    if (channel === 'whatsapp' && (!resolvedHistory || resolvedHistory.length === 0)) {
      resolvedHistory = await fetchConversationHistoryFromChannel(userId, resolvedVillageId);
      // Append current user message to cache so subsequent calls see it
      appendToHistoryCache(userId, 'user', workingMessage);
      logger.info('📚 [UnifiedProcessor] Loaded WhatsApp history', {
        userId,
        historyCount: resolvedHistory?.length || 0,
      });
    }

    const protocolGuardResult = tryHandleProtocolGuards({
      userId,
      mediaType: input.mediaType,
      traceId,
      startTime,
    });
    if (protocolGuardResult) {
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: 'protocol_guard',
        guardType: 'unsupported_media',
        action: 'handled',
        reason: input.mediaType,
        messagePreview: workingMessage,
      });
      tracker.complete();
      return finish(protocolGuardResult);
    }

    const [
      preGuardServiceOffer,
      preGuardEmergencyOffer,
      preGuardServiceClarification,
      preGuardActiveServiceInfo,
      preGuardAddressConfirmation,
      preGuardAddressRequest,
      preGuardComplaintData,
      preGuardCancelConfirmation,
    ] = sideEffectMode === 'knowledge_test'
      ? [null, null, null, null, null, null, null, null]
      : await Promise.all([
          getPendingServiceFormOfferWithFallback(userId),
          getPendingEmergencyComplaintOfferWithFallback(userId),
          getPendingServiceClarificationWithFallback(userId),
          getActiveServiceInfoWithFallback(userId),
          getPendingAddressConfirmationWithFallback(userId),
          getPendingAddressRequestWithFallback(userId),
          getPendingComplaintDataWithFallback(userId),
          getPendingCancelConfirmationWithFallback(userId),
        ]);
    const preGuardStateSnapshot: PendingStateSnapshot = {
      serviceOffer: preGuardServiceOffer,
      emergencyOffer: preGuardEmergencyOffer,
      serviceClarification: preGuardServiceClarification,
      activeServiceInfo: preGuardActiveServiceInfo,
      addressConfirmation: preGuardAddressConfirmation,
      addressRequest: preGuardAddressRequest,
      complaintData: preGuardComplaintData,
      cancelConfirmation: preGuardCancelConfirmation,
    };

    // Hard greeting / thanks shortcut. Active states bypass this so the
    // agent can interpret a bare "ok" or "terima kasih" in context of a
    // pending flow (e.g., confirming a cancellation).
    if (sideEffectMode !== 'knowledge_test') {
      const greetingShortcut = tryHandleGreetingShortcut({
        message: workingMessage,
        userName: null,
        villageName: null,
        traceId,
        startTime,
        hasActiveState: hasPendingOrActiveState(preGuardStateSnapshot),
      });
      if (greetingShortcut) {
        await recordGuardrail({
          traceId,
          waUserId: userId,
          villageId: resolvedVillageId,
          channel,
          guardStage: 'pre_agent_shortcut',
          guardType: 'greeting_only',
          action: 'handled',
          reason: greetingShortcut.metadata.guardrail?.reason,
          messagePreview: workingMessage,
        });
        tracker.complete();
        notifyStage('done', 100);
        return finish(greetingShortcut);
      }
    }
    const routingDecision = decideFastIntent({
      message: workingMessage,
      hasPendingServiceOffer: !!preGuardServiceOffer,
      hasPendingEmergencyOffer: !!preGuardEmergencyOffer,
      hasPendingServiceClarification: !!preGuardServiceClarification,
      hasActiveServiceInfo: !!preGuardActiveServiceInfo,
      hasPendingComplaintState: !!(preGuardAddressConfirmation || preGuardAddressRequest || preGuardComplaintData),
    });
    const releasedRoutingStates = releaseStatesForRoutingDecision(userId, preGuardStateSnapshot, routingDecision);
    const deferredRoutingOutcome = buildDeferredRoutingOutcome(routingDecision, releasedRoutingStates);

    const pendingOfferResult = sideEffectMode === 'knowledge_test' || !shouldHandlePendingOffer(routingDecision, preGuardStateSnapshot)
      ? null
      : await tryHandlePendingOffers({
          userId,
          message: workingMessage,
          channel: agentChannel,
          villageId: resolvedVillageId,
          traceId,
          startTime,
          sideEffectMode,
          runWithMicroBudget: withMicroNluBudget,
        });
    if (pendingOfferResult) {
      routingOutcome = {
        outcome: 'handled_pre_agent',
        reason: pendingOfferResult.metadata.guardrail?.reason || pendingOfferResult.intent,
        ...(releasedRoutingStates.length > 0 ? { releasedStates: releasedRoutingStates } : {}),
        action: routingDecision.action,
        primaryIntent: routingDecision.primaryIntent,
      };
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: 'pre_agent_pending_offer',
        guardType: 'pending_offer',
        action: 'handled',
        reason: pendingOfferResult.intent,
        messagePreview: workingMessage,
      });
      tracker.complete();
      notifyStage('done', 100);
      return finish(pendingOfferResult);
    }

    const latePreAgentResult = sideEffectMode === 'knowledge_test'
      ? null
      : await tryHandleLatePreAgentState({
          userId,
          message: workingMessage,
          channel: agentChannel,
          villageId: resolvedVillageId,
          traceId,
          startTime,
          mediaUrl,
          runWithMicroBudget: withMicroNluBudget,
          tracker,
          notifyStage,
        });
    if (latePreAgentResult) {
      const guardrail = latePreAgentResult.metadata.guardrail;
      routingOutcome = {
        outcome: 'handled_pre_agent',
        reason: guardrail?.reason || latePreAgentResult.intent,
        ...(releasedRoutingStates.length > 0 ? { releasedStates: releasedRoutingStates } : {}),
        action: routingDecision.action,
        primaryIntent: routingDecision.primaryIntent,
      };
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: guardrail?.stage || 'pre_agent_state',
        guardType: guardrail?.type || 'pending_state',
        action: guardrail?.action || 'handled',
        reason: guardrail?.reason || latePreAgentResult.intent,
        messagePreview: workingMessage,
        metadata: {
          ...(guardrail?.details || {}),
          finalIntentSource: 'pre_agent_state_router',
          stateResumeResult: guardrail?.type === 'complaint_fsm_resume'
            ? 'resumed'
            : guardrail?.type === 'complaint_fsm_reprompt'
              ? 'reprompted'
              : 'handled',
        },
      });
      return finish(latePreAgentResult);
    }

    const pendingServiceClarificationResult = shouldHandlePendingServiceClarification(routingDecision, preGuardStateSnapshot)
      ? await tryHandlePendingServiceClarification({
          userId,
          message: workingMessage,
          villageId: resolvedVillageId,
          traceId,
          startTime,
          sideEffectMode,
        })
      : null;
    if (pendingServiceClarificationResult) {
      const guardrail = pendingServiceClarificationResult.metadata.guardrail;
      routingOutcome = {
        outcome: 'handled_pre_agent',
        reason: guardrail?.reason || pendingServiceClarificationResult.intent,
        ...(releasedRoutingStates.length > 0 ? { releasedStates: releasedRoutingStates } : {}),
        action: routingDecision.action,
        primaryIntent: routingDecision.primaryIntent,
      };
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: guardrail?.stage || 'pre_agent_service_clarification',
        guardType: guardrail?.type || 'service_clarification',
        action: guardrail?.action || 'handled',
        reason: guardrail?.reason || pendingServiceClarificationResult.intent,
        messagePreview: workingMessage,
        metadata: guardrail?.details,
      });
      tracker.complete();
      notifyStage('done', 100);
      return finish(pendingServiceClarificationResult);
    }

    const activeServiceFollowUpResult = shouldHandleActiveServiceFollowUp(routingDecision, preGuardStateSnapshot)
      ? await tryHandleActiveServiceFollowUp({
          userId,
          message: workingMessage,
          villageId: resolvedVillageId,
          traceId,
          startTime,
          sideEffectMode,
        })
      : null;
    if (activeServiceFollowUpResult) {
      const guardrail = activeServiceFollowUpResult.metadata.guardrail;
      routingOutcome = {
        outcome: 'handled_pre_agent',
        reason: guardrail?.reason || activeServiceFollowUpResult.intent,
        ...(releasedRoutingStates.length > 0 ? { releasedStates: releasedRoutingStates } : {}),
        action: routingDecision.action,
        primaryIntent: routingDecision.primaryIntent,
      };
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: guardrail?.stage || 'pre_agent_active_service',
        guardType: guardrail?.type || 'active_service_follow_up',
        action: guardrail?.action || 'handled',
        reason: guardrail?.reason || activeServiceFollowUpResult.intent,
        messagePreview: workingMessage,
        metadata: guardrail?.details,
      });
      tracker.complete();
      notifyStage('done', 100);
      return finish(activeServiceFollowUpResult);
    }

    const outOfScopeGuardResult = sideEffectMode === 'knowledge_test' || !shouldHardBlockOutOfScope(routingDecision)
      ? null
      : tryHandleOutOfScopeGuard({
          message: workingMessage,
          traceId,
          startTime,
        });
    if (outOfScopeGuardResult) {
      routingOutcome = {
        outcome: 'hard_blocked',
        reason: routingDecision.reasons[0] || outOfScopeGuardResult.intent,
        ...(releasedRoutingStates.length > 0 ? { releasedStates: releasedRoutingStates } : {}),
        action: routingDecision.action,
        primaryIntent: routingDecision.primaryIntent,
      };
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: 'pre_agent_scope',
        guardType: 'out_of_scope',
        action: 'handled',
        reason: outOfScopeGuardResult.intent,
        messagePreview: workingMessage,
      });
      return finish(outOfScopeGuardResult);
    }

    // Deterministic service listing — bypasses RAG/knowledge for "layanan apa aja"
    const serviceListingResult = sideEffectMode === 'knowledge_test' || !shouldHandleServiceListing(routingDecision)
      ? null
      : await tryHandleServiceListingShortcut({
          message: workingMessage,
          villageId: resolvedVillageId,
          traceId,
          startTime,
          sideEffectMode,
        });
    if (serviceListingResult) {
      const guardrail = serviceListingResult.metadata.guardrail;
      routingOutcome = {
        outcome: 'handled_pre_agent',
        reason: guardrail?.reason || serviceListingResult.intent,
        ...(releasedRoutingStates.length > 0 ? { releasedStates: releasedRoutingStates } : {}),
        action: routingDecision.action,
        primaryIntent: routingDecision.primaryIntent,
      };
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: guardrail?.stage || 'pre_agent_service_listing',
        guardType: guardrail?.type || 'service_listing_shortcut',
        action: guardrail?.action || 'handled',
        reason: guardrail?.reason || serviceListingResult.intent,
        messagePreview: workingMessage,
        metadata: guardrail?.details,
      });
      tracker.complete();
      notifyStage('done', 100);
      return finish(serviceListingResult);
    }

    // Step 2.5: AI Optimization - cheap context first, expensive context only after fast exits miss
    const pendingServiceOffer = sideEffectMode === 'knowledge_test'
      ? null
      : await getPendingServiceFormOfferWithFallback(userId);
    const activeServiceInfo = await getActiveServiceInfoWithFallback(userId);
    const postGuardStateSnapshot: PendingStateSnapshot = {
      ...preGuardStateSnapshot,
      serviceOffer: releasedRoutingStates.includes('pending_service_form_offer') ? null : pendingServiceOffer,
      serviceClarification: releasedRoutingStates.includes('pending_service_clarification') ? null : preGuardStateSnapshot.serviceClarification,
      activeServiceInfo: releasedRoutingStates.includes('active_service_info') ? null : activeServiceInfo,
      emergencyOffer: releasedRoutingStates.includes('pending_emergency_complaint_offer') ? null : preGuardStateSnapshot.emergencyOffer,
    };
    routingOutcome = deferredRoutingOutcome;
    const pendingStateSummary = buildPendingStateSummary(postGuardStateSnapshot) || buildPendingStateSummary(preGuardStateSnapshot);

    // Prefer structured active-service state over regex inference from history.
    // Structured state is set by tools (setActiveServiceInfo) so the slug is
    // authoritative. Regex over recent history is a fallback for cases where
    // the state was evicted / not yet written (e.g., knowledge_test mode).
    const lastDiscussedService = activeServiceInfo?.service_slug
      ? {
          serviceSlug: activeServiceInfo.service_slug,
          serviceName: activeServiceInfo.service_name,
        }
      : (resolvedHistory?.length ? deriveLastDiscussedServiceContext(resolvedHistory) : {});

    // Step 3: Sanitize and correct typos
    let sanitizedMessage = sanitizeUserInput(workingMessage);
    sanitizedMessage = normalizeText(sanitizedMessage);

    const knowledgeTestWorkflowBlock = sideEffectMode === 'knowledge_test'
      ? getKnowledgeTestWorkflowBlock(sanitizedMessage)
      : undefined;
    if (knowledgeTestWorkflowBlock) {
      tracker.complete();
      notifyStage('done', 100);

      return finish({
        success: true,
        response: knowledgeTestWorkflowBlock.response,
        intent: knowledgeTestWorkflowBlock.intent,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
          agentMode: 'pre_agent_guard',
          toolsUsed: [],
          allowedTools: [],
          traceId,
        },
      });
    }

    const deterministicKnowledgeFallback = getResidentKnowledgeFallback(sanitizedMessage);
    if (deterministicKnowledgeFallback && !deterministicKnowledgeFallback.serviceSlug) {
      tracker.complete();
      notifyStage('done', 100);

      return finish({
        success: true,
        response: deterministicKnowledgeFallback.response,
        intent: deterministicKnowledgeFallback.intent,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: deterministicKnowledgeFallback.intent === 'KNOWLEDGE_QUERY' || deterministicKnowledgeFallback.intent === 'DOCUMENT_SEARCH',
          agentMode: 'pre_agent_guard',
          toolsUsed: [],
          traceId,
        },
      });
    }

    // Check response cache for multiple cacheable intents
    const CACHEABLE_INTENTS = ['KNOWLEDGE_QUERY', 'SERVICE_INFO', 'VILLAGE_PROFILE', 'EMERGENCY_CONTACTS', 'CONTACT_DIRECTORY'];
    let cachedResponse: { response: string; guidanceText?: string; intent: string; toolsUsed?: string[] } | null = null;
    const skipContextualCache = hasPendingOrActiveState(postGuardStateSnapshot) || isShortContextualFollowUp(sanitizedMessage);
    if (!isEvaluation && sideEffectMode !== 'knowledge_test' && !skipContextualCache) {
      for (const cacheIntent of CACHEABLE_INTENTS) {
        const hit = getCachedResponse(sanitizedMessage, cacheIntent, resolvedVillageId);
        if (hit) {
          cachedResponse = {
            response: hit.response,
            guidanceText: hit.guidanceText,
            intent: cacheIntent,
            toolsUsed: Array.isArray(hit.toolsUsed) ? hit.toolsUsed : [],
          };
          break;
        }
      }
    }
    if (cachedResponse) {
      tracker.complete();
      notifyStage('done', 100);

      let cacheResult: ProcessMessageResult = {
        success: true,
        response: cachedResponse.response,
        guidanceText: cachedResponse.guidanceText,
        intent: cachedResponse.intent,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: cachedResponse.intent === 'KNOWLEDGE_QUERY',
          agentMode: 'response_cache',
          toolsUsed: cachedResponse.toolsUsed || [],
          traceId,
        },
      };

      const cachedVerification = verifyAnswer({
        userMessage: sanitizedMessage,
        result: cacheResult,
        toolsUsed: cachedResponse.toolsUsed || [],
        handledByGuard: false,
      });
      if (!cachedVerification.ok && cachedVerification.replacement) {
        cacheResult = {
          ...cachedVerification.replacement,
          metadata: {
            ...cachedVerification.replacement.metadata,
            traceId,
            toolsUsed: cachedResponse.toolsUsed || [],
            ...({
              answerPolicy: {
                kind: cachedVerification.kind,
                ok: false,
                rewritten: true,
                reason: cachedVerification.reason,
              },
            } as any),
          },
        };
      } else {
        cacheResult = {
          ...cacheResult,
          metadata: {
            ...cacheResult.metadata,
            ...({
              answerPolicy: {
                kind: cachedVerification.kind,
                ok: cachedVerification.ok,
                rewritten: cachedVerification.rewritten,
                reason: cachedVerification.reason,
              },
            } as any),
          },
        };
      }

      // Reconcile cached response against current DB in case admin updated
      // kontak / jam / layanan since the entry was cached. Low cost —
      // reconciler short-circuits when nothing structured is in the text.
      try {
        const reconciliation = await reconcileDbVsRag({
          villageId: resolvedVillageId,
          userMessage: sanitizedMessage,
          result: cacheResult,
          toolsUsed: cachedResponse.toolsUsed || [],
        });
        if (!reconciliation.ok && reconciliation.replacement) {
          // Log guardrail so RCA can see that a cached answer was rewritten
          // post-hoc by the reconciler (otherwise this rewrite was silent).
          await recordGuardrail({
            traceId,
            waUserId: userId,
            villageId: resolvedVillageId,
            channel,
            guardStage: 'db_rag_reconciler',
            guardType: reconciliation.mismatches[0]?.kind || 'value_mismatch',
            action: 'rewritten',
            reason: 'value_not_in_official_db:cache_hit',
            messagePreview: workingMessage,
            metadata: {
              origin: 'response_cache',
              mismatches: reconciliation.mismatches,
              toolsUsed: cachedResponse.toolsUsed || [],
            },
          });
          cacheResult = {
            ...reconciliation.replacement,
            metadata: { ...reconciliation.replacement.metadata, traceId },
          };
        }
      } catch (reconcilerError: any) {
        logger.warn('cache-path reconciler failed (non-blocking)', {
          traceId,
          error: reconcilerError.message,
        });
      }

      return finish(cacheResult);
    }

    const conversationContext = resolvedHistory?.length
      ? await buildAgentConversationContext(userId, resolvedHistory)
      : { summary: undefined, recentMessages: [] as Array<{ role: 'user' | 'assistant'; content: string }> };
    const enhancedContext = getEnhancedContext(userId);
    const mergedConversationSummary = [
      enhancedContext.conversationSummary
        ? `[STATE AKTIF]\n${enhancedContext.conversationSummary}`
        : undefined,
      conversationContext.summary
        ? `[RINGKASAN RIWAYAT]\n${conversationContext.summary}`
        : undefined,
    ].filter(Boolean).join('\n\n') || undefined;

    const [savedProfile, memorySummary, sentiment, villageProfile] = await Promise.all([
      getAutoFillSuggestionsWithFallback(userId),
      sideEffectMode === 'knowledge_test'
        ? Promise.resolve(undefined)
        : buildHybridMemorySummary({
            wa_user_id: userId,
            query: sanitizedMessage,
            village_id: resolvedVillageId,
            trace_id: traceId,
            channel: agentChannel,
            skip_observability: !!isEvaluation,
          }),
      analyzeSentimentWithLLM(sanitizedMessage, userId, {
        village_id: resolvedVillageId,
        wa_user_id: channel === 'whatsapp' ? userId : undefined,
        session_id: channel === 'webchat' ? userId : undefined,
        channel,
      }),
      resolvedVillageId ? getVillageProfileSummary(resolvedVillageId) : Promise.resolve(null),
    ]);
    syncCrossChannelContext(userId, agentChannel, sideEffectMode, !!isEvaluation, savedProfile);
    const sentimentContext = getSentimentContext(sentiment);
    let templateContext: { villageName?: string | null; villageShortName?: string | null } | undefined;
    villageTimezone = villageProfile?.timezone || null;
    if (villageProfile?.name) {
      templateContext = {
        villageName: villageProfile.name,
        villageShortName: villageProfile.short_name || null,
      };
    }

    // ── Agent Mode (always active) ──
    // Spam guard and pending-state guards stay outside the agent, but
    // deterministic question answering now goes through the same tool-calling agent.
    let agentResult = await processWithAgent({
      userId,
      message: sanitizedMessage,
      channel: channel as 'whatsapp' | 'webchat',
      isEvaluation,
      sideEffectMode,
      villageId: resolvedVillageId,
      conversationSummary: mergedConversationSummary,
      recentConversationHistory: conversationContext.recentMessages,
      activeServiceSlug: pendingServiceOffer?.service_slug || activeServiceInfo?.service_slug || lastDiscussedService.serviceSlug,
      activeServiceName: activeServiceInfo?.service_name || lastDiscussedService.serviceName,
      memorySummary: enrichMemoryWithPromises(
        userId,
        villageId,
        enrichMemoryWithCrossChannel(userId, memorySummary),
        sanitizedMessage,
      ),
      routingDecision,
      pendingStateSummary,
      villageName: templateContext?.villageName ?? undefined,
      villageTimezone,
      userName: savedProfile.nama_lengkap ?? null,
      sentimentContext,
      traceId,
      startTime,
      tracker,
      notifyStage,
    });

    agentResult.metadata.sentiment = sentiment.level;

    const handoff = await maybeTriggerHumanHandoff({
      userId,
      channel: agentChannel,
      villageId: resolvedVillageId,
      villageName: templateContext?.villageName ?? null,
      message: sanitizedMessage,
      result: agentResult,
      sentiment,
      conversationSummary: mergedConversationSummary,
      recentConversationHistory: conversationContext.recentMessages,
      memorySummary,
      isEvaluation,
      sideEffectMode,
    });

    if (handoff.started && handoff.response) {
      agentResult = {
        ...agentResult,
        response: handoff.response,
        guidanceText: undefined,
        intent: 'TAKEOVER',
        metadata: {
          ...agentResult.metadata,
          handoff: {
            started: true,
            reason: handoff.reason,
          },
        },
      };
    }

    if (agentResult.metadata.guardrail) {
      await recordGuardrail({
        traceId,
        waUserId: userId,
        villageId: resolvedVillageId,
        channel,
        guardStage: agentResult.metadata.guardrail.stage,
        guardType: agentResult.metadata.guardrail.type,
        action: agentResult.metadata.guardrail.action,
        reason: agentResult.metadata.guardrail.reason,
        messagePreview: workingMessage,
        metadata: {
          ...(agentResult.metadata.guardrail.details || {}),
          finalIntentSource: 'agent_orchestrator',
        },
      });
    }

    // ── Answer policy verifier ──
    // Ensures structured-fact responses (nomor kontak, daftar layanan) are
    // grounded in a tool result before they reach the user. If not, we
    // rewrite into an honest "not found / not sure" reply so we never
    // fabricate a phone number or a fake service list.
    if (sideEffectMode !== 'knowledge_test' && agentResult.intent !== 'TAKEOVER') {
      const verification = verifyAnswer({
        userMessage: sanitizedMessage,
        result: agentResult,
        toolsUsed: agentResult.metadata.toolsUsed || [],
        handledByGuard: false,
      });

      if (!verification.ok && verification.replacement) {
        await recordGuardrail({
          traceId,
          waUserId: userId,
          villageId: resolvedVillageId,
          channel,
          guardStage: 'answer_policy',
          guardType: verification.kind,
          action: 'rewritten',
          reason: verification.reason,
          messagePreview: workingMessage,
          metadata: {
            toolsUsed: agentResult.metadata.toolsUsed || [],
            allowedTools: agentResult.metadata.allowedTools || [],
          },
        });

        agentResult = {
          ...verification.replacement,
          metadata: {
            ...verification.replacement.metadata,
            traceId,
            ...({
              answerPolicy: {
                kind: verification.kind,
                ok: false,
                rewritten: true,
                reason: verification.reason,
              },
            } as any),
          },
        };
      } else if (verification.rewritten && !verification.replacement) {
        // Defensive: shouldn't happen, but tag for observability if it does.
        await recordGuardrail({
          traceId,
          waUserId: userId,
          villageId: resolvedVillageId,
          channel,
          guardStage: 'answer_policy',
          guardType: verification.kind,
          action: 'flagged',
          reason: verification.reason,
          messagePreview: workingMessage,
        });
        agentResult = {
          ...agentResult,
          metadata: {
            ...agentResult.metadata,
            ...({
              answerPolicy: {
                kind: verification.kind,
                ok: false,
                rewritten: true,
                reason: verification.reason,
              },
            } as any),
          },
        };
      } else {
        // Attach the kind so downstream analytics can segment by answer type.
        agentResult = {
          ...agentResult,
          metadata: {
            ...agentResult.metadata,
            ...({
              answerPolicy: {
                kind: verification.kind,
                ok: verification.ok,
                rewritten: verification.rewritten,
                reason: verification.reason,
              },
            } as any),
          },
        };
      }
    }

    // ── DB-vs-RAG reconciler ──
    // Second safety net. Cross-checks structured values (phone numbers,
    // operating hours) cited in the final response against the authoritative
    // DB directly. Catches cases where the agent used the right tool but
    // still surfaced a value from RAG/knowledge that disagrees with DB.
    if (sideEffectMode !== 'knowledge_test' && agentResult.intent !== 'TAKEOVER') {
      try {
        const reconciliation = await reconcileDbVsRag({
          villageId: resolvedVillageId,
          userMessage: sanitizedMessage,
          result: agentResult,
          toolsUsed: agentResult.metadata.toolsUsed || [],
        });

        if (!reconciliation.ok && reconciliation.replacement) {
          await recordGuardrail({
            traceId,
            waUserId: userId,
            villageId: resolvedVillageId,
            channel,
            guardStage: 'db_rag_reconciler',
            guardType: reconciliation.mismatches[0]?.kind || 'value_mismatch',
            action: 'rewritten',
            reason: 'value_not_in_official_db',
            messagePreview: workingMessage,
            metadata: {
              mismatches: reconciliation.mismatches,
              toolsUsed: agentResult.metadata.toolsUsed || [],
            },
          });

          agentResult = {
            ...reconciliation.replacement,
            metadata: {
              ...reconciliation.replacement.metadata,
              traceId,
            },
          };
        }
      } catch (reconcilerError: any) {
        logger.warn('db-rag reconciler failed (non-blocking)', {
          traceId,
          error: reconcilerError.message,
        });
      }
    }

    if (!isEvaluation && sideEffectMode !== 'knowledge_test' && agentResult.success && isCacheableAgentResult(agentResult)) {
      const cacheIntent = CACHEABLE_INTENTS.includes(agentResult.intent)
        ? agentResult.intent
        : 'KNOWLEDGE_QUERY';
      setCachedResponse(
        sanitizedMessage,
        agentResult.response,
        cacheIntent,
        agentResult.guidanceText,
        resolvedVillageId,
        agentResult.metadata.toolsUsed || [],
      );
    }

    return finish(agentResult);
    
  } catch (error: any) {
    const processingTimeMs = Date.now() - startTime;
    
    // Update status: error
    tracker.error(error.message);
    
    logger.error('❌ [UnifiedProcessor] Processing failed', {
      traceId,
      userId,
      channel,
      error: error.message,
      processingTimeMs,
    });
    
    // Use smart fallback based on context
    
    // Determine error type for better fallback
    let errorType: string | undefined;
    if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      errorType = 'TIMEOUT';
    } else if (error.message?.includes('rate limit') || error.message?.includes('429')) {
      errorType = 'RATE_LIMIT';
    } else if (error.message?.includes('ECONNREFUSED') || error.message?.includes('503')) {
      errorType = 'SERVICE_DOWN';
    }
    
    // Get smart fallback - tries to continue conversation flow if possible
    const fallbackResponse = errorType 
      ? getErrorFallback(errorType)
      : getSmartFallback(userId, undefined, workingMessage, villageTimezone);
    
    return finish({
      success: false,
      response: fallbackResponse,
      intent: 'ERROR',
      metadata: { processingTimeMs, hasKnowledge: false, traceId },
      error: error.message,
    });
  } finally {
    const analyticsResult = finalResult as ProcessMessageResult | null;
    if (!isEvaluation && sideEffectMode !== 'knowledge_test' && analyticsResult && analyticsResult.intent !== 'SPAM') {
      await aiAnalyticsService.recordInteractionEvent({
        waUserId: userId,
        villageId,
        channel,
        intent: deriveAnalyticsIntent(analyticsResult),
        success: analyticsResult.success,
        hasKnowledge: analyticsResult.metadata.hasKnowledge,
        isFallback: analyticsResult.intent === 'ERROR',
        agentMode: analyticsResult.metadata.agentMode,
        responseSource: deriveAnalyticsSource(analyticsResult),
        toolsUsed: analyticsResult.metadata.toolsUsed,
        model: analyticsResult.metadata.model,
        processingTimeMs: analyticsResult.metadata.processingTimeMs,
      });

      if (analyticsResult.metadata.agentMode === 'single_orchestrator') {
        await recordToolExecutionTraces({
          traceId: analyticsResult.metadata.traceId,
          billingGroupId,
          messageId: resolvedMessageId,
          waUserId: userId,
          sessionId: channel === 'webchat' ? userId : undefined,
          villageId,
          channel,
          toolTrace: analyticsResult.metadata.toolTrace as any,
        });

        const answerPolicy = (analyticsResult.metadata as any)?.answerPolicy;
        await recordToolPolicyEvent({
          traceId: analyticsResult.metadata.traceId,
          waUserId: userId,
          villageId,
          channel,
          query: workingMessage,
          heuristicTools: (analyticsResult.metadata.heuristicTools || []) as any,
          learnedTools: (analyticsResult.metadata.learnedTools || []) as any,
          allowedTools: (analyticsResult.metadata.allowedTools || []) as any,
          actualTools: analyticsResult.metadata.toolsUsed || [],
          success: analyticsResult.success,
          policyKey: analyticsResult.metadata.toolPolicy?.policyKey,
          policySource: analyticsResult.metadata.toolPolicy?.policySource,
          toolPolicyReason: encodeToolPolicyReasonWithRouting((analyticsResult.metadata as any)?.toolPolicyReason, analyticsResult),
          firstTurnToolChoice: analyticsResult.metadata.toolPolicy?.firstTurnToolChoice,
          firstTurnToolChoiceReason: (analyticsResult.metadata as any)?.firstTurnToolChoiceReason,
          finalIntentSource: 'agent',
          stateResumeResult: undefined,
          answerPolicyKind: answerPolicy?.kind,
          answerPolicyRewritten: answerPolicy?.rewritten,
        });
      } else if (analyticsResult.metadata.agentMode === 'pre_agent_guard') {
        // Persist a minimal policy event for guard paths too so RCA can always
        // see which layer produced the final answer.
        await recordToolPolicyEvent({
          traceId: analyticsResult.metadata.traceId,
          waUserId: userId,
          villageId,
          channel,
          query: workingMessage,
          heuristicTools: [],
          learnedTools: [],
          allowedTools: [],
          actualTools: [],
          success: analyticsResult.success,
          policyKey: undefined,
          policySource: analyticsResult.metadata.guardrail?.stage,
          toolPolicyReason: encodeToolPolicyReasonWithRouting('guard_short_circuit', analyticsResult),
          firstTurnToolChoice: undefined,
          firstTurnToolChoiceReason: undefined,
          finalIntentSource: 'guardrail',
          stateResumeResult: deriveStateResumeResult(analyticsResult),
          answerPolicyKind: undefined,
          answerPolicyRewritten: undefined,
        });
      } else if (analyticsResult.metadata.agentMode === 'response_cache') {
        await recordToolPolicyEvent({
          traceId: analyticsResult.metadata.traceId,
          waUserId: userId,
          villageId,
          channel,
          query: workingMessage,
          heuristicTools: [],
          learnedTools: [],
          allowedTools: [],
          actualTools: [],
          success: analyticsResult.success,
          policyKey: undefined,
          policySource: 'response_cache',
          toolPolicyReason: encodeToolPolicyReasonWithRouting('cached_response', analyticsResult),
          firstTurnToolChoice: undefined,
          firstTurnToolChoiceReason: undefined,
          finalIntentSource: 'cache',
          stateResumeResult: undefined,
          answerPolicyKind: undefined,
          answerPolicyRewritten: undefined,
        });
      }
    }
    try {
      await finishAiBillingTurn(billingTurn);
    } catch (billingError: any) {
      logger.error('AI message billing finalization failed', {
        traceId,
        billingGroupId,
        error: billingError?.message || String(billingError),
      });
    }
    decrementActiveProcessing();
  }
}

export const __test_only__ = {
  isExplicitHumanHandoffRequest,
  classifyHelpfulnessForStuck,
};

export default {
  processUnifiedMessage,
  handleComplaintCreation,
  handleComplaintUpdate,
  handleServiceInfo,
  handleServiceRequestCreation,
  handleStatusCheck,
  handleCancellationRequest,
  handleHistory,
  validateResponse,
};
