/**
 * P1-9 — GLM empty/null LLM output must NOT trigger a full mutation-loop retry.
 *
 * Covers:
 *  1. The v1 agent orchestrator degrades gracefully (non-empty, honest copy)
 *     instead of returning '' — which used to be classified as a processing
 *     failure (AGENT_EMPTY_REPLY) and enqueued the whole message for a full
 *     re-processing retry.
 *  2. shouldEnqueueFullLoopRetry() refuses the full-loop retry whenever the
 *     failed turn already executed a mutation tool — so no mutation can run
 *     twice because of the retry (retry interval 10 min > gateway idempotency
 *     TTL 5 min; the per-turn dedup map is fresh on retry).
 *  3. The graceful copy itself is never classified as a processing failure
 *     (must not contain any GENERIC_TIMEOUT_PHRASES).
 *
 * The single light non-mutating LLM retry (same model+key, MAX_EMPTY_CONTENT_RETRIES=1)
 * is covered separately by src/services/__tests__/ai-gateway-empty-retry.test.ts
 * (initial attempt + exactly ONE retry → fetch called 2×, no loop).
 */
import { describe, it, expect } from 'vitest';

import {
  __test_only__ as agentOrchestratorTestOnly,
  EMPTY_LLM_FALLBACK_COPY,
} from '../agent-orchestrator';

const { buildAgentFallbackReply, buildMixedIntentLoopExhaustedReply } = agentOrchestratorTestOnly;
import { shouldEnqueueFullLoopRetry } from '../full-loop-retry-guard';
import { isProcessingFailure } from '../../unified-message-processor.service';
import type { ProcessMessageResult } from '../../ump-types';

function failedResult(toolsUsed: string[]): ProcessMessageResult {
  return {
    success: false,
    response: '',
    intent: 'AGENT_ERROR',
    metadata: {
      processingTimeMs: 1234,
      hasKnowledge: false,
      toolsUsed,
      traceId: 'trace-p1-9',
    } as ProcessMessageResult['metadata'],
    error: 'AGENT_EMPTY_REPLY',
  };
}

describe('P1-9 empty LLM output — graceful degradation, no full-loop retry', () => {
  it('buildAgentFallbackReply never returns empty (graceful copy instead)', () => {
    const reply = buildAgentFallbackReply('pesan acak tanpa grounding apapun', []);
    expect(reply).toBe(EMPTY_LLM_FALLBACK_COPY);
    expect(reply.trim().length).toBeGreaterThan(0);
  });

  it('buildMixedIntentLoopExhaustedReply never returns empty when nothing was answered', () => {
    const reply = buildMixedIntentLoopExhaustedReply(
      'biaya surat domisili dan nomor puskesmas berapa?',
      ['get_service_info'],
      ['get_service_info', 'get_important_contact'],
      '', // no partial reply — the old code returned ''
    );
    expect(reply).toBe(EMPTY_LLM_FALLBACK_COPY);
    expect(reply.trim().length).toBeGreaterThan(0);
  });

  it('the graceful copy is NOT classified as a processing failure (no retry triggered)', () => {
    const result: ProcessMessageResult = {
      success: true,
      response: EMPTY_LLM_FALLBACK_COPY,
      intent: 'AGENT',
      metadata: { processingTimeMs: 42, hasKnowledge: false },
    };
    expect(isProcessingFailure(result)).toBe(false);
  });

  it('refuses the full-loop retry when a mutation already executed (create_complaint)', () => {
    expect(
      shouldEnqueueFullLoopRetry(failedResult(['get_service_info', 'create_complaint']), 'off'),
    ).toBe(false);
  });

  it('refuses the full-loop retry for every v1 mutation tool', () => {
    for (const tool of [
      'create_complaint',
      'create_service_request',
      'update_complaint',
      'get_service_request_edit_link',
      'cancel_request',
    ]) {
      expect(shouldEnqueueFullLoopRetry(failedResult([tool]), 'off')).toBe(false);
    }
  });

  it('still allows the full-loop retry for genuine transient failures with no mutation', () => {
    // No mutation ran → the whole-loop retry is still the desired recovery path.
    expect(
      shouldEnqueueFullLoopRetry(failedResult(['search_knowledge']), 'off'),
    ).toBe(true);
  });

  it('never enqueues for v2 (never-silent guarantee lives in the pipeline)', () => {
    expect(
      shouldEnqueueFullLoopRetry(failedResult(['create_complaint']), 'on'),
    ).toBe(false);
    expect(
      shouldEnqueueFullLoopRetry(failedResult(['search_knowledge']), 'on'),
    ).toBe(false);
  });

  it('never enqueues when the result is not a processing failure', () => {
    const ok: ProcessMessageResult = {
      success: true,
      response: 'Ada yang bisa saya bantu?',
      intent: 'AGENT',
      metadata: { processingTimeMs: 10, hasKnowledge: false, toolsUsed: ['create_complaint'] },
    };
    expect(shouldEnqueueFullLoopRetry(ok, 'off')).toBe(false);
  });
});
