/**
 * process-message-v2 — the new pipeline entry point.
 *
 * Flow (arsitektur-final §2):
 *   ingress (rate limit lives in ai-orchestrator today)
 *   → stage-router (deterministic)
 *   → stage-assessor (fuzzy transitions only)
 *   → staged-agent (bounded single-agent loop / deterministic fast lanes)
 *   → verify + never-silent fallback
 *
 * Returns a ProcessMessageResult-compatible shape so the orchestrator can
 * adopt it without rewriting the send path.
 */

import crypto from 'crypto';
import { routeMessage } from './stage-router';
import { assessStage, shouldSuggestHandoff } from './stage-assessor';
import { runStagedTurn, createPipelineContext } from './staged-agent';
import { transitionsFrom } from './stage-graph';
import type { ProcessMessageInput, ProcessMessageResult } from '../services/ump-types';
import { redactForLog } from '../gateway/pii-gateway';
import logger from '../utils/logger';

export async function processMessageV2(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  const started = Date.now();
  const traceId = crypto.randomUUID();
  const ctx = createPipelineContext({
    traceId,
    userId: input.userId,
    tenantId: input.villageId,
    channel: input.channel === 'webchat' ? 'webchat' : 'whatsapp',
    messageId: input.messageId,
    isEvaluation: input.isEvaluation,
    sideEffectMode: input.sideEffectMode,
  });

  try {
    // 1. Deterministic routing.
    let decision = routeMessage({ message: input.message });

    // 2. Fuzzy transition → assessor (micro-LLM or deterministic fallback).
    if (decision.hints?.needsAssessor) {
      const hasFuzzy = transitionsFrom(decision.stage).some((t) => t.kind === 'fuzzy');
      if (hasFuzzy) {
        const assessed = await assessStage({ message: input.message, fromStage: decision.stage });
        ctx.assessorConfidences.push(assessed.confidence);
        if (shouldSuggestHandoff(ctx.assessorConfidences)) {
          decision = {
            stage: 'HANDOFF', source: 'deterministic', confidence: 0.9,
            reasons: ['two_low_confidence_assessments'],
          };
        } else {
          decision = assessed;
        }
      }
    }

    if (input.onStageChange) {
      try { input.onStageChange(decision.stage.toLowerCase(), 0.5); } catch { /* best effort */ }
    }

    // 3. Staged agent turn (bounded, never-silent inside).
    const turn = await runStagedTurn({
      message: input.message,
      decision,
      ctx,
      villageName: 'Desa', // TODO: resolve from tenant service (DB-first)
      summary: undefined,
      language: 'id',
    });

    const metadata: ProcessMessageResult['metadata'] = {
      processingTimeMs: Date.now() - started,
      model: 'staged-agent-v2',
      hasKnowledge: turn.toolsUsed.some((t) => t.startsWith('search_') || t.startsWith('get_')),
      agentMode: 'single_orchestrator',
      sideEffectMode: input.sideEffectMode,
      toolsUsed: turn.toolsUsed,
      toolTrace: turn.toolTrace.map((t) => ({
        tool: t.tool,
        success: t.success,
        durationMs: t.durationMs,
        trustLevel: 'action_result' as const,
      })),
      traceId,
      routing: {
        action: decision.stage,
        confidence: String(decision.confidence),
        primaryIntent: turn.intent,
        mixedSignals: false,
        reasons: decision.reasons,
      },
    };

    return {
      success: turn.terminalState === 'SUCCEEDED',
      response: turn.response,
      guidanceText: turn.guidanceText,
      intent: turn.intent,
      fields: turn.fields,
      metadata,
      ...(turn.degraded ? { error: turn.degradationReason ?? 'degraded' } : {}),
    };
  } catch (err) {
    // Absolute last resort: this should be unreachable (runStagedTurn never
    // throws past its own failover), but defense in depth.
    logger.error('[processMessageV2] unexpected exception', {
      traceId, error: redactForLog(String((err as Error)?.message ?? err)),
    });
    return {
      success: false,
      response:
        'Mohon maaf, sistem kami sedang mengalami gangguan. Silakan coba lagi beberapa saat, atau hubungi kantor desa langsung.',
      intent: 'error',
      metadata: {
        processingTimeMs: Date.now() - started,
        hasKnowledge: false,
        agentMode: 'single_orchestrator',
        traceId,
      },
      error: 'v2_unexpected_exception',
    };
  }
}
