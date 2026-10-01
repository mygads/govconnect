/**
 * P1-9 — guard for the AI full-loop retry queue.
 *
 * The retry worker (rabbitmq.service `startAIRetryWorker`) re-runs the ENTIRE
 * agent tool loop ~10 minutes later. That is unsafe when the failed turn
 * already executed a mutation: the retry interval (10 min) exceeds the
 * gateway idempotency TTL (5 min) and the per-turn dedup map is fresh on
 * retry, so the mutation would execute TWICE (e.g. a duplicate ticket).
 *
 * This module is deliberately dependency-light (no service singletons) so
 * the decision stays unit-testable.
 */
import { isProcessingFailure } from '../unified-message-processor.service';
import { isMutationTool } from './agent-orchestrator';
import type { AgentToolName } from './tool-definitions';
import type { ProcessMessageResult } from '../ump-types';
import type { PipelineMode } from '../../pipeline/feature-flags';

/**
 * May the FULL mutation-loop retry (AI retry queue, which re-runs the whole
 * agent tool loop) be enqueued for this failed turn?
 *
 * Returns FALSE when:
 * - the result is not a processing failure, or
 * - pipeline v2 ('on') — its staged-agent pipeline carries the never-silent
 *   guarantee and is exempt from the silent+retry path, or
 * - the failed turn already executed a mutation tool → the full-loop retry
 *   could double-execute it. The caller must deliver the graceful fallback
 *   copy instead (never-silent).
 */
export function shouldEnqueueFullLoopRetry(
  result: ProcessMessageResult,
  pipelineMode: PipelineMode,
): boolean {
  if (!isProcessingFailure(result) || pipelineMode === 'on') return false;
  const toolsUsed = (result.metadata?.toolsUsed ?? []) as string[];
  return !toolsUsed.some((t) => isMutationTool(t as AgentToolName));
}
