/**
 * UMP Types — shared type definitions for the Unified Message Processor modules.
 *
 * Re-exports frequently used types from ump-formatters so handler modules
 * can import everything from one place.
 */

export type { ChannelType, HandlerResult } from './ump-formatters';
export { validateResponse, normalizeHandlerResult } from './ump-formatters';

export interface ProcessMessageInput {
  /** Unique user identifier (wa_user_id for WhatsApp, session_id for webchat) */
  userId: string;
  /** Optional tenant context (GovConnect village_id) */
  villageId?: string;
  /** The message text from user */
  message: string;
  /** Channel source */
  channel: import('./ump-formatters').ChannelType;
  /** Optional conversation history (for webchat that doesn't use Channel Service) */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Optional media URL (for complaints with photos) */
  mediaUrl?: string;
  /** Optional media type */
  mediaType?: string;
  /** Stable source message identifier for one-turn AI billing. */
  messageId?: string;
  /** Source message IDs combined into this reply, when batching is enabled. */
  batchedMessageIds?: string[];
  /** When true, skip side effects (profile writes, analytics, rate limits, cache writes).
   *  Used by golden-set evaluation to avoid polluting production data. */
  isEvaluation?: boolean;
  /** Runtime behavior mode. `knowledge_test` keeps the production RAG/agent path but blocks workflow tools. */
  sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
  /**
   * Optional callback fired when the processing stage changes.
   * Used by the WhatsApp orchestrator to send typing indicators at the right moment.
   * Stages: 'reading' → 'searching' → 'thinking' → 'preparing' → 'sending'
   */
  onStageChange?: (stage: string, progress: number) => void;
}

export interface ProcessMessageResult {
  success: boolean;
  /** Main response text */
  response: string;
  /** Optional guidance/follow-up text (sent as separate bubble in WhatsApp) */
  guidanceText?: string;
  /** Detected intent */
  intent: string;
  /** Extracted fields from NLU */
  fields?: Record<string, any>;
  /** Contacts to send as separate vCard messages (WhatsApp only) */
  contacts?: Array<{
    name: string;
    phone: string;
    organization?: string;
    title?: string;
  }>;
  /** Processing metadata */
  metadata: {
    processingTimeMs: number;
    model?: string;
    hasKnowledge: boolean;
    knowledgeConfidence?: string;
    sentiment?: string;
    language?: string;
    agentMode?: 'single_orchestrator' | 'deterministic_fact_router' | 'pre_agent_guard' | 'response_cache' | 'answer_policy_verifier';
    sideEffectMode?: 'production' | 'evaluation' | 'knowledge_test';
    toolsUsed?: string[];
    allowedTools?: string[];
    heuristicTools?: string[];
    learnedTools?: string[];
    toolPolicy?: {
      policyKey?: string;
      policySource?: string;
      confidence?: number;
      firstTurnToolChoice?: 'auto' | 'required';
    };
    handoff?: {
      started: boolean;
      reason?: string;
    };
    toolTrace?: Array<{
      tool: string;
      success: boolean;
      durationMs: number;
      trustLevel: 'trusted_fact' | 'trusted_record' | 'untrusted_retrieval' | 'action_result';
      sourceKind?: string;
      found?: boolean;
      confidenceLevel?: string;
    }>;
    grounding?: {
      trustedTools?: string[];
      sourceKinds?: string[];
      hasTrustedFact?: boolean;
      hasTrustedRecord?: boolean;
    };
    guardrail?: {
      stage: string;
      type: string;
      action: string;
      reason?: string;
      details?: Record<string, unknown>;
    };
    routing?: {
      action: string;
      confidence: string;
      primaryIntent: string;
      mixedSignals: boolean;
      stateAffinity?: string;
      reasons: string[];
      allowedToolHints?: string[];
    };
    /** Unique trace ID for correlating logs across NLU → RAG → LLM → response */
    traceId?: string;
    walletStatus?: string;
    walletBalanceUsd?: number;
    /** True when a wallet-exhausted message was held for later flush. */
    heldForBalance?: boolean;
  };
  /** Error message if failed */
  error?: string;
}
