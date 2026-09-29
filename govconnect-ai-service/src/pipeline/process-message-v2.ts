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
import { runStagedTurn, createPipelineContext, stripSystemMarkers } from './staged-agent';
import { transitionsFrom } from './stage-graph';
import { isTakeoverActive } from './takeover';
import { resolveServiceSlug } from './micro-assessor';
import { processImageMedia } from './media-pipeline';
import { isVoiceNote, handleVoiceNote } from './voice-pipeline';
import { enqueueComplaintToLapor } from './lapor-bridge';
import { resolveIdentityLevel, auditIdentityLevel } from './identity-ladder';
import { checkBudget } from './cost-guard';
import { isCostSaverMode, collapseTurnMessages } from './cost-saver';
import { ingressCheck } from './ingress-guard';
import { semanticCacheLookup, semanticCacheStore } from './semantic-cache';
import { applyMemoryPolicy } from './memory-policy';
import { buildFallback, persistFallbackTicket } from './fallback-policy';
import {
  confirmButtons, categoryList, validateInteractive, type InteractivePayload,
} from './wa-interactive';

/** Stage-native interactive attachments (degrade to plain text). */
function interactiveForTurn(turn: {
  stage: string; terminalState: string; response: string;
}): InteractivePayload | undefined {
  if (turn.terminalState !== 'SUCCEEDED' || !turn.response) return undefined;
  if (turn.stage === 'VERIFY') {
    const p = confirmButtons(turn.response);
    return validateInteractive(p) ? p : undefined;
  }
  if ((turn.stage === 'TRIAGE' || turn.stage === 'COLLECT') && /kategori/i.test(turn.response)) {
    const p = categoryList(turn.response);
    return validateInteractive(p) ? p : undefined;
  }
  return undefined;
}
import {
  extractSlotsDeterministic, mergeSlots, classifySlotIntent,
  nextMissingSlot, isCollectComplete, renderVerifySummary,
  INTENT_SLOT_KEY, COLLECT_ATTEMPTS_KEY, type SlotIntent, type Slots,
} from './slot-fsm';
import {
  resolveConfirmation, isPendingMutation, type PendingMutation,
  STALE_CONFIRMATION_COPY, CONFIRM_EDIT_COPY, CONFIRM_CANCEL_COPY,
} from './confirmation';
import {
  appendAudit, idempotencyCheck, idempotencyStore,
  loadTurnState, saveTurnState, clearTurnState,
} from './pipeline-store';
import type { ProcessMessageInput, ProcessMessageResult } from '../services/ump-types';
import { redactForLog } from '../gateway/pii-gateway';
import { extractTopicKey } from '../services/kb-suggester-core';
import logger from '../utils/logger';

/**
 * Idempotency key (P1-2): scoped per tenant+user+channel, then message
 * identity. Two different citizens sending identical text must NEVER share
 * a key (cross-user replay could leak another citizen's ticket data).
 * Same user + same text within 10 min → same response (desired dedup).
 */
export function buildIdempotencyKey(input: {
  villageId?: string; userId?: string; channel?: string;
  messageId?: string; message?: string;
}): string {
  const channel = input.channel === 'webchat' ? 'webchat' : 'whatsapp';
  const msgHash = crypto.createHash('sha256')
    .update(input.message ?? '').digest('hex').slice(0, 16);
  return `msg:${input.villageId ?? ''}:${input.userId ?? ''}:${channel}:${input.messageId ?? 'noid'}:${msgHash}`;
}

/** Idempotency key: same tenant+user+channel+message within 10 min → same response. */
function idemKey(input: ProcessMessageInput): string {
  return buildIdempotencyKey(input);
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

  // P1-1: shadow/evaluation guard. Non-production modes (shadow runner,
  // eval harness) MUST NOT write production state: turn state, idempotency
  // store, memory policy, fallback tickets, LAPOR outbox, semantic cache.
  // Writes are gated on `sideEffectsAllowed`; audit events always carry
  // `isEvaluation` so shadow and production are distinguishable in the trail.
  const sideEffectsAllowed = (input.sideEffectMode ?? 'production') === 'production';
  const isEvaluation = input.isEvaluation ?? !sideEffectsAllowed;

  const audit = (stage: string, event: string, payload?: Record<string, unknown>) => {
    void appendAudit({
      tenantId, traceId, userId: input.userId, channel,
      stage, event, payload: { isEvaluation, ...(payload ?? {}) },
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

    // P1-8: strip literal system-authority markers ("[SISTEM]",
    // "[ATURAN SUMBER]") from user input before anything else sees it —
    // routing, slots, idempotency key, classifier, and the prompt. Our own
    // system notes use those markers with role:'system'; a user typing the
    // same literal must not borrow that authority.
    input.message = stripSystemMarkers(input.message);

    // 0b. Idempotency: duplicate delivery → replay stored response.
    // Skipped in shadow/evaluation (P1-1): shadow must compute fresh, and
    // must not read production idempotency results as its own.
    const key = idemKey(input);
    if (sideEffectsAllowed) {
      const seen = await idempotencyCheck(tenantId, key);
      if (seen.hit) {
        audit('INGRESS', 'idempotent_replay', {});
        const r = seen.response as ProcessMessageResult;
        return { ...r, metadata: { ...(r.metadata ?? {}), traceId } };
      }
    }

    // 0c. Restore multi-turn state (stage + slots survive across turns).
    const prior = await loadTurnState(tenantId, input.userId, channel);
    if (prior) {
      ctx.slots = { ...(prior.slots as Record<string, unknown>) };
      ctx.assessorConfidences = [...(prior.assessorConfidences ?? [])];
      audit('INGRESS', 'turn_state_restored', { stage: prior.stage });
    }

    // 0c. Ingress guard: rate limit + anomaly quarantine (never-silent).
    const ingress = await ingressCheck({
      tenantId, userId: input.userId, channel, traceId, message: input.message,
    });
    if (ingress.action !== 'allow') {
      return {
        success: false,
        response: ingress.userReply ?? 'Pesan diterima.',
        intent: ingress.action === 'rate_limited' ? 'rate_limited' : 'quarantined',
        metadata: {
          processingTimeMs: Date.now() - started,
          hasKnowledge: false,
          agentMode: 'single_orchestrator',
          traceId,
        },
      };
    }

    // 0c2. Deterministic confirmation handling (P0-1: G2/G3 chain).
    // button.id is authoritative; typed text ("Ya") never executes a
    // mutation — it re-enters VERIFY so the citizen sees the buttons again.
    // The router is bypassed here because VERIFY is a conversational state,
    // not a fresh-routing decision.
    const pendingForConfirm: PendingMutation | null = isPendingMutation(prior?.slots?.pendingTool)
      ? (prior!.slots!.pendingTool as PendingMutation)
      : null;
    const confirmation = resolveConfirmation({
      buttonId: input.buttonId ?? null,
      confirmed: input.confirmed,
      message: input.message,
      pending: pendingForConfirm,
    });
    const confirmationMeta = {
      processingTimeMs: Date.now() - started,
      hasKnowledge: false,
      agentMode: 'single_orchestrator' as const,
      traceId,
    };
    if (confirmation.kind === 'stale') {
      // Stale/replayed confirm click: reject deterministically, never route
      // fresh (a fresh route would misread the button title as a new intent).
      audit('VERIFY', 'stale_confirmation_rejected', { buttonId: input.buttonId ?? null });
      return {
        success: true,
        response: STALE_CONFIRMATION_COPY,
        intent: 'stale_confirmation',
        metadata: { ...confirmationMeta },
      };
    }
    if (confirmation.kind === 'edit') {
      // Citizen wants to fix the data: drop the pending mutation, keep the
      // slots, ask which part to correct (mirrors the VERIFY correction copy).
      delete ctx.slots.pendingTool;
      audit('VERIFY', 'confirmation_edit_requested', {});
      if (sideEffectsAllowed) {
        void saveTurnState(tenantId, input.userId, {
          stage: 'COLLECT',
          slots: ctx.slots,
          assessorConfidences: ctx.assessorConfidences,
        }, channel).catch(() => undefined);
      }
      return {
        success: true,
        response: CONFIRM_EDIT_COPY,
        guidanceText: 'Menunggu koreksi warga.',
        intent: 'correction',
        metadata: { ...confirmationMeta },
      };
    }
    if (confirmation.kind === 'cancel') {
      audit('VERIFY', 'confirmation_cancelled', { buttonId: input.buttonId ?? null });
      if (sideEffectsAllowed) {
        void clearTurnState(tenantId, input.userId, channel).catch(() => undefined);
      }
      return {
        success: true,
        response: CONFIRM_CANCEL_COPY,
        intent: 'cancelled',
        metadata: { ...confirmationMeta },
      };
    }

    // 0d. Identity ladder (deterministic, never LLM): L0/L1/L2.
    ctx.identityLevel = await resolveIdentityLevel({
      tenantId, userId: input.userId, channel,
    });
    await auditIdentityLevel({
      tenantId, userId: input.userId, channel, traceId, level: ctx.identityLevel,
    });

    // 0e. Budget guard: no LLM spend when the tenant's daily budget is out.
    const budget = await checkBudget(tenantId);
    if (!budget.allowed) {
      audit('INGRESS', 'budget_exceeded', { spentUsd: budget.spentUsd });
      const fbInput = {
        stage: 'TRIAGE' as const, terminalState: 'BUDGET_EXHAUSTED' as const,
        userId: input.userId, traceId, tenantId, channel,
      };
      const fb = buildFallback(fbInput);
      if (sideEffectsAllowed) {
        persistFallbackTicket(fbInput, fb.ticketRef);
      }
      return {
        success: false,
        response: fb.response,
        intent: 'budget_exhausted',
        metadata: {
          processingTimeMs: Date.now() - started,
          hasKnowledge: false,
          agentMode: 'single_orchestrator',
          traceId,
        },
        error: 'daily_budget_exceeded',
      };
    }

    // 0f. Voice note: transcribe → text pipeline BEFORE routing (P1-6).
    // Previously transcription happened after routeMessage() and the COLLECT
    // slot-FSM ran, so stage decision + intent + slots were computed from an
    // empty/placeholder message and the transcript never entered the slots.
    // Now the transcript replaces input.message before routing, slot
    // extraction, and the agent loop all see it. Deterministic never-silent
    // reply when Whisper is not configured.
    if (isVoiceNote(input.mediaType) && input.mediaUrl) {
      const voice = await handleVoiceNote({
        tenantId, userId: input.userId, channel, traceId, audioUrl: input.mediaUrl,
      });
      if (voice.reply) {
        return {
          success: false,
          response: voice.reply,
          intent: 'voice_note_unsupported',
          metadata: {
            processingTimeMs: Date.now() - started,
            hasKnowledge: false,
            agentMode: 'single_orchestrator',
            traceId,
          },
        };
      }
      if (voice.transcript) {
        input.message = `[transkrip voice note] ${voice.transcript}`;
      }
    }

    // 1. Deterministic routing.
    let decision = routeMessage({ message: input.message });
    if (confirmation.kind === 'execute') {
      // Bound confirm_send → skip fresh routing, go straight to EXECUTE.
      audit('VERIFY', 'confirmation_bound', { tool: pendingForConfirm?.tool ?? null });
      decision = {
        stage: 'EXECUTE',
        source: 'deterministic',
        confidence: 1,
        reasons: ['confirmed_button_bound_to_pending_mutation'],
      };
    } else if (confirmation.kind === 'reverify') {
      // Affirmative text → re-enter VERIFY to re-show summary + buttons.
      audit('VERIFY', 'affirmative_text_reconfirm', {});
      decision = {
        stage: 'VERIFY',
        source: 'deterministic',
        confidence: 1,
        reasons: ['affirmative_text_reconfirm'],
      };
    }

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
    // 2d. Media intake (image): privacy-first — hash, EXIF strip, redaction
    // check. Raw pixels never reach the LLM; only the signal fact does.
    if (input.mediaUrl && /image|photo|jpeg|jpg|png/i.test(input.mediaType ?? '')) {
      try {
        const media = await processImageMedia({
          tenantId, userId: input.userId, channel, traceId,
          mediaUrl: input.mediaUrl, mediaType: input.mediaType, messageId: input.messageId,
        });
        if (media.promptFact) turnFacts.push(media.promptFact);
        audit('INGRESS', 'media_signal', {
          hasImage: media.hasImage, duplicate: media.duplicate,
          redaction: media.redaction, exifStripped: media.exifStripped,
        });
      } catch (err) {
        logger.debug('[processMessageV2] media intake failed', {
          error: String((err as Error)?.message ?? err).slice(0, 120),
        });
      }
    }
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
    // 2b. Semantic cache: informational answers only, lookup before the agent.
    if (decision.stage === 'INFORMATION') {
      const cached = await semanticCacheLookup(tenantId, input.message);
      if (cached) {
        audit('INFORMATION', 'semantic_cache_hit', {});
        return {
          success: true,
          response: cached,
          intent: 'information_cached',
          metadata: {
            processingTimeMs: Date.now() - started,
            hasKnowledge: true,
            agentMode: 'single_orchestrator',
            traceId,
          },
        };
      }
    }

    const turn = await runStagedTurn({
      message: input.message,
      decision,
      ctx,
      villageName: 'Desa', // TODO: resolve from tenant service (DB-first)
      confirmed: input.confirmed,
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

    // W14: cost saver — enforce exactly 1 message per turn. Merge guidance
    // into the reply BEFORE building the interactive payload, so buttons/list
    // bodies carry the merged text and WA length limits are still validated.
    // Content is never dropped silently, only merged (audited below).
    let responseText = turn.response;
    let guidanceText = turn.guidanceText;
    if (isCostSaverMode() && (guidanceText ?? '').trim()) {
      const collapsed = collapseTurnMessages(responseText, guidanceText);
      responseText = collapsed.text;
      guidanceText = undefined;
      audit('SEND', 'cost_saver_collapsed', { mergedGuidance: collapsed.mergedGuidance });
    }

    const interactive = interactiveForTurn({ ...turn, response: responseText });

    const result: ProcessMessageResult = {
      success: turn.terminalState === 'SUCCEEDED',
      response: responseText,
      guidanceText,
      intent: turn.intent,
      fields: { ...turn.fields, ...(interactive ? { interactive } : {}) },
      metadata,
      ...(turn.degraded ? { error: turn.degradationReason ?? 'degraded' } : {}),
    };

    // 4. Persist: idempotency + multi-turn state (best-effort, never blocks).
    // P1-1: skipped entirely in shadow/evaluation — no production writes.
    if (sideEffectsAllowed) {
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
    }

    // 5. Semantic cache store (informational, non-personal answers only).
    // P1-1: shadow must not pollute the production cache.
    if (sideEffectsAllowed && turn.terminalState === 'SUCCEEDED') {
      void semanticCacheStore(tenantId, input.message, turn.response, decision.stage)
        .catch(() => undefined);
    }

    const mutationRefs = Array.from(
      turn.response.matchAll(/\b(?:LAP|TMP|SRV|REQ)-\d{4}\d{2}\d{2}-\d{2,6}\b/g),
    ).map((m) => m[0]);

    // 6. Durable memory policy (ADD/UPDATE/INVALIDATE/SKIP, never throws).
    // P1-1: shadow must not mutate real user memory.
    if (sideEffectsAllowed) {
      void applyMemoryPolicy({
        tenantId, userId: input.userId, channel, traceId,
        terminalState: turn.terminalState,
        toolsUsed: turn.toolsUsed,
        mutationRefs,
        summary: `[${turn.intent}] ${redactForLog(turn.response).slice(0, 400)}`,
      }).catch(() => undefined);
    }

    // 7. LAPOR! outbox: forward filed complaints (config-gated sender).
    // P1-1: shadow must not enqueue real outbox items.
    if (sideEffectsAllowed && turn.toolsUsed.includes('create_complaint') && mutationRefs.length > 0) {
      const s = ctx.slots as unknown as Record<string, unknown>;
      void enqueueComplaintToLapor({
        villageId: tenantId,
        complaintRef: mutationRefs[0],
        category: typeof s.category === 'string' ? s.category : undefined,
        description: typeof s.description === 'string' ? s.description : turn.response.slice(0, 500),
        location: typeof s.location === 'string' ? s.location : undefined,
        reporterContact: input.userId,
        hasImage: Boolean(input.mediaUrl),
      }).catch(() => undefined);
    }
    audit(turn.stage, 'turn_completed', {
      terminalState: turn.terminalState,
      degraded: turn.degraded,
      toolsUsed: turn.toolsUsed,
      // R5: deterministic topic key (from PII-redacted text) so the KB
      // suggester can cluster "10× tanya X" without reading raw messages.
      topic: extractTopicKey(redactForLog(input.message)),
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
