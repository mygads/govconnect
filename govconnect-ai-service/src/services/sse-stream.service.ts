/**
 * SSE Stream Service — streaming response as a PRESENTATION LAYER.
 *
 * The agent pipeline stays fully synchronous (unchanged). This module wraps a
 * single synchronous turn and replays it over Server-Sent Events:
 *
 *   1. `status` / `stage` events  — progress while the pipeline runs
 *      ("Mencari informasi…"), fed by the pipeline's existing `onStageChange`
 *      callback (stages: reading → searching → thinking → preparing → sending).
 *   2. `chunk` events             — the final answer replayed in small
 *      word-chunks so the webchat UI can render progressively.
 *   3. `done` event               — the complete answer + metadata.
 *
 * Guards (architecture compliance):
 * - P0-3 (outbound sanitizer): the full reply is sanitized with
 *   `sanitizeOutboundText` BEFORE chunking, and every streamed chunk passes
 *   the sanitizer again. Raw JSON can never reach a chunk.
 * - P1-5 (abort): an AbortSignal (wired to the HTTP request `close` event by
 *   the route) is checked before every emit and before the summary is
 *   returned. When aborted, no further chunks are emitted and the caller must
 *   skip all persistence (no write after abort).
 *
 * Scope: webchat only. WhatsApp (channel-service) sends discrete messages and
 * does not support streaming — this endpoint is not wired to any WA path.
 */

import { sanitizeOutboundText, looksLikeRawJson } from '../pipeline/outbound-sanitizer';
import { isAborted } from '../pipeline/abort-guard';
import { isProcessingFailure, hasDeliverableFallback } from './unified-message-processor.service';
import type { ProcessMessageResult } from './ump-types';
import logger from '../utils/logger';

/** Input accepted by the (synchronous) webchat turn processor. */
export interface StreamProcessorInput {
  userId: string;
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  village_id?: string;
  messageId?: string;
  batchedMessageIds?: string[];
  /** Wired to the pipeline's stage callback so progress can be streamed. */
  onStageChange?: (stage: string, progress: number) => void;
}

export type StreamProcessor = (input: StreamProcessorInput) => Promise<ProcessMessageResult>;

/** Emit one SSE event. The route supplies the res.write-backed implementation. */
export type StreamEmit = (event: string, data: unknown) => void;

export interface StreamAgentTurnOptions {
  input: StreamProcessorInput;
  processor: StreamProcessor;
  emit: StreamEmit;
  /** Aborted when the HTTP client disconnects (P1-5). */
  signal?: AbortSignal | null;
  /** Delay between answer chunks so the UI renders progressively. 0 in tests. */
  chunkDelayMs?: number;
  /** Upper bound for the synchronous pipeline turn (mirrors webchat sync path). */
  timeoutMs?: number;
}

export type StreamTurnOutcome = 'done' | 'degraded' | 'held' | 'error' | 'aborted';

export interface StreamTurnSummary {
  outcome: StreamTurnOutcome;
  result?: ProcessMessageResult;
  /** Full sanitized answer text (identical to what the chunks reconstruct). */
  fullText?: string;
  guidanceText?: string;
  /** True when the full-text sanitizer replaced the reply (raw JSON / empty). */
  sanitizerSubstituted?: boolean;
}

/** Default chunk size for progressive rendering. */
export const STREAM_CHUNK_CHARS = 60;

/** Default per-turn timeout, mirroring the synchronous webchat endpoint. */
export const STREAM_TURN_TIMEOUT_MS = 90_000;

/** Default delay between chunks so the client sees progressive rendering. */
export const STREAM_CHUNK_DELAY_MS = 25;

/** Indonesian progress copy per pipeline stage. */
export const STREAM_STAGE_LABELS: Record<string, string> = {
  reading: 'Membaca pesan Anda…',
  searching: 'Mencari informasi…',
  thinking: 'Menyusun jawaban…',
  preparing: 'Menyiapkan balasan…',
  sending: 'Mengirim…',
  // v2 FSM stages (lowercased decision.stage)
  collect: 'Mengumpulkan informasi…',
  verify: 'Memverifikasi…',
  execute: 'Memproses…',
};

export function stageLabelFor(stage: string): string {
  const label = STREAM_STAGE_LABELS[(stage || '').toLowerCase()];
  return label ?? 'Memproses…';
}

/**
 * Split text into word-aware chunks. Chunk boundaries fall on whitespace, so
 * `chunks.join('')` reconstructs the input byte-for-byte.
 */
export function chunkTextForStream(text: string, maxChars: number = STREAM_CHUNK_CHARS): string[] {
  const t = text ?? '';
  if (!t) return [];
  const parts = t.split(/(\s+)/); // keep whitespace tokens
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    if (current.length > 0 && current.length + part.length > maxChars) {
      chunks.push(current);
      current = '';
    }
    current += part;
  }
  if (current) chunks.push(current);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface EmittedAnswer {
  /** Sanitized full text the chunks reconstruct. */
  fullText: string;
  /** Chunks emitted (may be fewer than total when aborted mid-stream). */
  emitted: number;
  /** True when the full-text sanitizer replaced the reply. */
  sanitizerSubstituted: boolean;
  /** Number of individual chunks that failed the per-chunk sanitize (alarm). */
  chunkSubstitutions: number;
}

/**
 * Sanitize (P0-3) then stream one answer text as `chunk` events.
 * Returns the sanitized full text so the caller can persist / report it.
 */
async function emitAnswerChunks(
  safeEmit: (event: string, data: unknown) => boolean,
  signal: AbortSignal | null | undefined,
  text: string,
  chunkDelayMs: number,
  kind: 'answer' | 'guidance' | 'fallback',
): Promise<EmittedAnswer> {
  // P0-3: full-text guard first — catches raw-JSON replies before chunking.
  const sanitized = sanitizeOutboundText(text);
  const chunks = chunkTextForStream(sanitized.text);
  let emitted = 0;
  let chunkSubstitutions = 0;

  for (let i = 0; i < chunks.length; i++) {
    if (isAborted(signal)) break;
    // P0-3: every streamed chunk must also pass the outbound sanitizer.
    // A chunk is a slice of already-sanitized natural text, so this is an
    // identity pass; a substitution here is an alarm, not a silent change.
    const perChunk = sanitizeOutboundText(chunks[i]);
    if (perChunk.substituted || looksLikeRawJson(perChunk.text)) {
      chunkSubstitutions++;
      logger.warn('[sse-stream] chunk failed per-chunk sanitize — emitting substitute', {
        index: i,
        preview: chunks[i].slice(0, 80),
      });
    }
    const ok = safeEmit('chunk', {
      index: i,
      total: chunks.length,
      kind,
      text: perChunk.text,
      at: Date.now(),
    });
    if (!ok) break;
    emitted++;
    if (chunkDelayMs > 0 && i < chunks.length - 1) {
      await sleep(chunkDelayMs);
    }
  }

  return {
    fullText: sanitized.text,
    emitted,
    sanitizerSubstituted: sanitized.substituted,
    chunkSubstitutions,
  };
}

/**
 * Run one synchronous agent turn and replay it as SSE events.
 * Never throws for pipeline outcomes; only throws on programmer error.
 * When `signal` is aborted, stops emitting and returns `{ outcome: 'aborted' }`
 * — the caller must then skip all persistence (P1-5: no write after abort).
 */
export async function streamAgentTurn(options: StreamAgentTurnOptions): Promise<StreamTurnSummary> {
  const {
    input,
    processor,
    emit,
    signal = null,
    chunkDelayMs = STREAM_CHUNK_DELAY_MS,
    timeoutMs = STREAM_TURN_TIMEOUT_MS,
  } = options;

  const safeEmit = (event: string, data: unknown): boolean => {
    if (isAborted(signal)) return false;
    try {
      emit(event, data);
      return true;
    } catch (err: any) {
      logger.warn('[sse-stream] emit failed', { event, error: err?.message });
      return false;
    }
  };

  if (isAborted(signal)) return { outcome: 'aborted' };

  safeEmit('status', {
    stage: 'start',
    message: 'Menerima pesan…',
    progress: 5,
    at: Date.now(),
  });

  const onStageChange = (stage: string, progress: number) => {
    safeEmit('stage', {
      stage,
      message: stageLabelFor(stage),
      progress,
      at: Date.now(),
    });
  };

  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('STREAM_TURN_TIMEOUT')), Math.max(1, timeoutMs));
  });

  let result: ProcessMessageResult;
  try {
    result = await Promise.race([processor({ ...input, onStageChange }), timeoutPromise]);
  } catch (err: any) {
    if (isAborted(signal)) return { outcome: 'aborted' };
    logger.warn('[sse-stream] turn failed', {
      userId: input.userId,
      error: err?.message,
      timeout: err?.message === 'STREAM_TURN_TIMEOUT',
    });
    safeEmit('error', {
      code: err?.message === 'STREAM_TURN_TIMEOUT' ? 'PROCESSING_TIMEOUT' : 'PROCESSING_ERROR',
      message: 'Maaf, terjadi kendala saat memproses pesan Anda. Silakan coba lagi.',
      at: Date.now(),
    });
    return { outcome: 'error' };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (isAborted(signal)) return { outcome: 'aborted' };

  // Wallet exhausted: the message is held server-side for later flush.
  if (result.intent === 'AI_BALANCE_HELD') {
    safeEmit('held', {
      message: 'Pesan Anda ditahan sementara menunggu pengisian saldo AI.',
      at: Date.now(),
    });
    return { outcome: 'held', result };
  }

  // BUG-008 never-silent: stream the static fallback instead of going silent.
  if (isProcessingFailure(result)) {
    if (hasDeliverableFallback(result)) {
      logger.warn('[sse-stream] degraded — streaming static fallback', {
        userId: input.userId,
        error: result.error,
        intent: result.intent,
      });
      const streamed = await emitAnswerChunks(safeEmit, signal, result.response, chunkDelayMs, 'fallback');
      if (isAborted(signal)) return { outcome: 'aborted', result };
      safeEmit('done', {
        fullText: streamed.fullText,
        guidanceText: '',
        intent: result.intent,
        degraded: true,
        sanitizerSubstituted: streamed.sanitizerSubstituted,
        at: Date.now(),
      });
      return {
        outcome: 'degraded',
        result,
        fullText: streamed.fullText,
        sanitizerSubstituted: streamed.sanitizerSubstituted,
      };
    }
    logger.warn('[sse-stream] turn failed with no deliverable fallback', {
      userId: input.userId,
      error: result.error,
      intent: result.intent,
    });
    safeEmit('error', {
      code: 'PROCESSING_FAILED',
      message: 'Maaf, terjadi kendala saat memproses pesan Anda. Silakan coba lagi.',
      at: Date.now(),
    });
    return { outcome: 'error', result };
  }

  const answer = await emitAnswerChunks(safeEmit, signal, result.response, chunkDelayMs, 'answer');
  if (isAborted(signal)) return { outcome: 'aborted', result };

  let guidanceText = '';
  const guidanceRaw = result.guidanceText?.trim() ? result.guidanceText : '';
  if (guidanceRaw) {
    const guidance = await emitAnswerChunks(safeEmit, signal, guidanceRaw, chunkDelayMs, 'guidance');
    guidanceText = guidance.fullText;
    if (isAborted(signal)) return { outcome: 'aborted', result, fullText: answer.fullText };
  }

  if (answer.chunkSubstitutions > 0) {
    logger.error('[sse-stream] per-chunk sanitize substitutions detected', {
      userId: input.userId,
      count: answer.chunkSubstitutions,
    });
  }

  const donePayload = {
    fullText: answer.fullText,
    guidanceText,
    intent: result.intent,
    degraded: false,
    sanitizerSubstituted: answer.sanitizerSubstituted,
    metadata: {
      processingTimeMs: result.metadata?.processingTimeMs,
      model: result.metadata?.model,
      hasKnowledge: result.metadata?.hasKnowledge,
      knowledgeConfidence: result.metadata?.knowledgeConfidence,
      sentiment: result.metadata?.sentiment,
    },
    at: Date.now(),
  };
  safeEmit('done', donePayload);

  return {
    outcome: 'done',
    result,
    fullText: answer.fullText,
    guidanceText,
    sanitizerSubstituted: answer.sanitizerSubstituted,
  };
}
