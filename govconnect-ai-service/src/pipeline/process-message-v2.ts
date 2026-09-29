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
import { isTakeoverActive } from './takeover';
import { resolveServiceSlug } from './micro-assessor';
import {
  extractSlotsDeterministic, mergeSlots, classifySlotIntent,
  nextMissingSlot, isCollectComplete, renderVerifySummary,
  INTENT_SLOT_KEY, COLLECT_ATTEMPTS_KEY, type SlotIntent, type Slots,
} from './slot-fsm';
import {
  appendAudit, idempotencyCheck, idempotencyStore,
  loadTurnState, saveTurnState, clearTurnState,
} from './pipeline-store';
import type { ProcessMessageInput, ProcessMessageResult } from '../services/ump-types';
import { redactForLog } from '../gateway/pii-gateway';
import logger from '../utils/logger';

/** Idempotency key: same tenant+user+message within 10 min → same response. */
function idemKey(input: ProcessMessageInput): string {
  return `msg:${input.messageId ?? 'noid'}:${(input.message ?? '').length}:${(input.message ?? '').slice(0, 64)}`;
}

export async function processMessageV2(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  const started = Date.now();
  const traceId = crypto.randomUUID();
  const tenantId = input.villageId ?? '';
  const channel = input.channel === 'webchat' ? 'webchat' : 'whatsapp';
  const ctx = createPipelineContext({
    traceId,
    userId: input.userId,
    tenantId: input.villageId,
    channel,
    messageId: input.messageId,
    isEvaluation: input.isEvaluation,
    sideEffectMode: input.sideEffectMode,
  });

  const audit = (stage: string, event: string, payload?: Record<string, unknown>) => {
    void appendAudit({
      tenantId, traceId, userId: input.userId, channel,
      stage, event, payload,
    });
  };

  try {
    // 0a. Takeover: a human owns this conversation → stay quiet.
    const takeover = await isTakeoverActive(tenantId, input.userId, channel);
    if (takeover.active) {
      audit('INGRESS', 'takeover_active', { takenBy: takeover.takenBy ?? null });
      return {
        success: true,
        response: '',
        intent: 'takeover',
        metadata: {
          processingTimeMs: Date.now() - started,
          hasKnowledge: false,
          agentMode: 'single_orchestrator',
          traceId,
        },
      };
    }

    // 0b. Idempotency: duplicate delivery → replay stored response.
    const key = idemKey(input);
    const seen = await idempotencyCheck(tenantId, key);
    if (seen.hit) {
      audit('INGRESS', 'idempotent_replay', {});
      const r = seen.response as ProcessMessageResult;
      return { ...r, metadata: { ...(r.metadata ?? {}), traceId } };
    }

    // 0c. Restore multi-turn state (stage + slots survive across turns).
    const prior = await loadTurnState(tenantId, input.userId, channel);
    if (prior) {
      ctx.slots = { ...(prior.slots as Record<string, unknown>) };
      ctx.assessorConfidences = [...(prior.assessorConfidences ?? [])];
      audit('INGRESS', 'turn_state_restored', { stage: prior.stage });
    }

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

    // 2b. Deterministic COLLECT: classify intent, extract + merge slots.
    // The FSM owns slot state; the LLM only proposes values conversationally.
    if (decision.stage === 'COLLECT') {
      const priorIntent = ctx.slots[INTENT_SLOT_KEY] as SlotIntent | undefined;
      const intent = priorIntent ?? classifySlotIntent(input.message) ?? 'complaint';
      ctx.slots[INTENT_SLOT_KEY] = intent;
      const attempts = Number(ctx.slots[COLLECT_ATTEMPTS_KEY] ?? 0) + 1;
      ctx.slots[COLLECT_ATTEMPTS_KEY] = attempts;

      const extracted = extractSlotsDeterministic(input.message, intent);
      const { slots, errors } = mergeSlots(intent, ctx.slots as unknown as Slots, extracted);
      ctx.slots = { ...slots, [INTENT_SLOT_KEY]: intent, [COLLECT_ATTEMPTS_KEY]: attempts };
      if (errors.length > 0) {
        audit('COLLECT', 'slot_validation_errors', { errors });
      }

      // service_request: resolve the villager's phrasing to an official
      // service_slug via micro-LLM (deterministic slot, LLM-assisted match).
      if (intent === 'service_request' && !ctx.slots.service_slug) {
        const slug = await resolveServiceSlug(input.message, tenantId, input.userId);
        if (slug) {
          ctx.slots.service_slug = slug;
          audit('COLLECT', 'service_slug_resolved', { slug });
        }
      }

      // 2x failed collection → deterministic handoff (SOP rule).
      if (attempts > 2 && !isCollectComplete(intent, ctx.slots as unknown as Slots)) {
        audit('COLLECT', 'handoff_after_repeated_failure', { attempts });
        decision = {
          stage: 'HANDOFF', source: 'deterministic', confidence: 0.95,
          reasons: ['collect_failed_twice'],
        };
      } else if (isCollectComplete(intent, ctx.slots as unknown as Slots)) {
        // All required slots present → VERIFY with deterministic summary.
        audit('COLLECT', 'collect_complete', { intent });
        decision = {
          stage: 'VERIFY', source: 'deterministic', confidence: 1,
          reasons: ['all_required_slots_filled'],
        };
      } else {
        const missing = nextMissingSlot(intent, ctx.slots as unknown as Slots);
        audit('COLLECT', 'slot_missing', { slot: missing?.name ?? null, attempts });
      }
    }

    // 3. Staged agent turn (bounded, never-silent inside).
    // For incomplete COLLECT, give the agent loop the deterministic slot status
    // so its question matches the FSM (the FSM remains authoritative).
    const turnFacts: string[] = [];
    if (decision.stage === 'COLLECT') {
      const intent = ctx.slots[INTENT_SLOT_KEY] as SlotIntent | undefined;
      if (intent) {
        const missing = nextMissingSlot(intent, ctx.slots as unknown as Slots);
        const filled = Object.entries(ctx.slots as unknown as Slots)
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, v]) => `${k}=${v}`).join(', ') || '(belum ada)';
        turnFacts.push(
          `[Slot status] terisi: ${filled}; ` +
          (missing ? `yang masih kurang: ${missing.label} — tanyakan: ${missing.prompt}` : 'semua slot wajib terisi'),
        );
      }
    }
    const turn = await runStagedTurn({
      message: input.message,
      decision,
      ctx,
      villageName: 'Desa', // TODO: resolve from tenant service (DB-first)
      summary: undefined,
      language: 'id',
      facts: turnFacts,
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

    const result: ProcessMessageResult = {
      success: turn.terminalState === 'SUCCEEDED',
      response: turn.response,
      guidanceText: turn.guidanceText,
      intent: turn.intent,
      fields: turn.fields,
      metadata,
      ...(turn.degraded ? { error: turn.degradationReason ?? 'degraded' } : {}),
    };

    // 4. Persist: idempotency + multi-turn state (best-effort, never blocks).
    void idempotencyStore(tenantId, key, result, 10 * 60 * 1000).catch(() => undefined);
    if (turn.terminalState === 'SUCCEEDED' && turn.stage !== 'CLOSE') {
      void saveTurnState(tenantId, input.userId, {
        stage: turn.stage,
        slots: ctx.slots,
        assessorConfidences: ctx.assessorConfidences,
      }, channel).catch(() => undefined);
    } else if (turn.stage === 'CLOSE') {
      void clearTurnState(tenantId, input.userId, channel).catch(() => undefined);
    }
    audit(turn.stage, 'turn_completed', {
      terminalState: turn.terminalState,
      degraded: turn.degraded,
      toolsUsed: turn.toolsUsed,
    });

    return result;
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
