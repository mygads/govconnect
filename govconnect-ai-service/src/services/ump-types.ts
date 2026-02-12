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
  /** When true, skip side effects (profile writes, analytics, rate limits, cache writes).
   *  Used by golden-set evaluation to avoid polluting production data. */
  isEvaluation?: boolean;
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
    /** Unique trace ID for correlating logs across NLU → RAG → LLM → response */
    traceId?: string;
  };
  /** Error message if failed */
  error?: string;
}
