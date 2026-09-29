/**
 * Durable memory policy — ADD / UPDATE / INVALIDATE decisions.
 *
 * Design (arsitektur-final §7):
 * - Memory writes are DECIDED by deterministic rules, not by the LLM.
 * - ADD: a new durable fact (complaint filed, profile confirmed).
 * - UPDATE: supersede a stale entry (invalidate old + add new, never edit).
 * - INVALIDATE: mark a memory superseded (cancellation, correction) —
 *   soft-delete via metadata flag so the audit trail survives.
 * - SKIP: ephemeral turns (status lookups, greetings, failed turns).
 * - PII rule: memory content is PII-scrubbed before write (NIK → token).
 */

import {
  memoryFindByKey, memoryInvalidateEntry, appendAudit,
} from './pipeline-store';
import { redactForLog } from '../gateway/pii-gateway';
import logger from '../utils/logger';

export type MemoryDecision = 'ADD' | 'UPDATE' | 'INVALIDATE' | 'SKIP';

export interface MemoryPolicyInput {
  tenantId: string;
  userId: string;
  channel: string;
  traceId: string;
  /** Terminal state of the turn. */
  terminalState: string;
  /** Tools that succeeded this turn. */
  toolsUsed: string[];
  /** Mutation results (ticket refs etc.). */
  mutationRefs: string[];
  /** Free-form summary of what happened (already PII-scrubbed by caller). */
  summary: string;
}

/**
 * Deterministic policy: what should happen to durable memory after this turn?
 */
export function decideMemoryAction(input: MemoryPolicyInput): {
  decision: MemoryDecision;
  memoryType?: 'complaint' | 'service_request' | 'cancellation' | 'profile';
  memoryKey?: string;
  reason: string;
} {
  if (input.terminalState !== 'SUCCEEDED') {
    return { decision: 'SKIP', reason: 'turn did not succeed' };
  }
  if (input.toolsUsed.includes('create_complaint') && input.mutationRefs.length > 0) {
    return {
      decision: 'ADD', memoryType: 'complaint',
      memoryKey: input.mutationRefs[0],
      reason: 'complaint filed',
    };
  }
  if (input.toolsUsed.includes('create_service_request') && input.mutationRefs.length > 0) {
    return {
      decision: 'ADD', memoryType: 'service_request',
      memoryKey: input.mutationRefs[0],
      reason: 'service request filed',
    };
  }
  if (input.toolsUsed.includes('cancel_request') && input.mutationRefs.length > 0) {
    return {
      decision: 'INVALIDATE', memoryKey: input.mutationRefs[0],
      reason: 'request cancelled by user',
    };
  }
  if (input.toolsUsed.includes('update_complaint') && input.mutationRefs.length > 0) {
    return {
      decision: 'UPDATE', memoryType: 'complaint',
      memoryKey: input.mutationRefs[0],
      reason: 'complaint updated',
    };
  }
  return { decision: 'SKIP', reason: 'ephemeral turn (no durable fact)' };
}

/**
 * Execute the memory decision. Best-effort; never throws.
 */
export async function applyMemoryPolicy(input: MemoryPolicyInput): Promise<void> {
  const d = decideMemoryAction(input);
  if (d.decision === 'SKIP') return;
  try {
    const { rememberMemoryEvent } = await import('../services/hybrid-memory.service');
    const safeContent = redactForLog(input.summary).slice(0, 1000);

    if (d.decision === 'INVALIDATE' && d.memoryKey) {
      const existing = await memoryFindByKey(input.userId, input.tenantId, d.memoryKey);
      if (existing) {
        await memoryInvalidateEntry(existing.id, input.tenantId, d.reason);
      }
      // Record the invalidation itself as an event for traceability.
      await rememberMemoryEvent({
        wa_user_id: input.userId,
        village_id: input.tenantId || undefined,
        memory_type: 'cancellation',
        memory_key: d.memoryKey,
        content: safeContent,
        importance: 0.7,
      }).catch(() => undefined);
    } else if ((d.decision === 'ADD' || d.decision === 'UPDATE') && d.memoryType) {
      if (d.decision === 'UPDATE' && d.memoryKey) {
        const existing = await memoryFindByKey(input.userId, input.tenantId, d.memoryKey);
        if (existing) {
          await memoryInvalidateEntry(existing.id, input.tenantId, 'superseded by update');
        }
      }
      await rememberMemoryEvent({
        wa_user_id: input.userId,
        village_id: input.tenantId || undefined,
        memory_type: d.memoryType,
        memory_key: d.memoryKey,
        content: safeContent,
        importance: 0.8,
      }).catch(() => undefined);
    }

    await appendAudit({
      tenantId: input.tenantId, traceId: input.traceId, userId: input.userId,
      channel: input.channel, stage: 'CLOSE', event: 'memory_policy_applied',
      payload: { decision: d.decision, memoryType: d.memoryType ?? null, reason: d.reason },
    });
  } catch (err) {
    logger.warn('[memory-policy] applyMemoryPolicy failed', {
      error: String((err as Error)?.message ?? err).slice(0, 150),
    });
  }
}
