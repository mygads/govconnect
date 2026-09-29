/**
 * Shadow Runner — strangler-pattern comparison harness.
 *
 * In 'shadow' mode the v1 path serves the citizen; v2 runs in the background,
 * its outcome is compared against v1, and the diff is logged for the golden
 * set / eval loop. The citizen NEVER sees the v2 response.
 *
 * Fire-and-forget: never blocks, never throws into the caller.
 */

import { processMessageV2 } from './process-message-v2';
import type { ProcessMessageInput, ProcessMessageResult } from '../services/ump-types';
import { redactForLog } from '../gateway/pii-gateway';
import logger from '../utils/logger';

export interface ShadowComparison {
  traceId: string;
  v1Intent: string;
  v2Intent: string;
  intentMatch: boolean;
  v1Success: boolean;
  v2Success: boolean;
  v1Ms: number;
  v2Ms: number;
  v2Degraded: boolean;
  v2Tools: string[];
  responseLengthDelta: number;
}

function summarize(input: ProcessMessageInput): ProcessMessageInput {
  // Shadow runs must not pollute production: no side effects, no profile writes.
  return {
    ...input,
    isEvaluation: true,
    sideEffectMode: 'knowledge_test',
    onStageChange: undefined,
  };
}

export function runShadowComparison(
  input: ProcessMessageInput,
  v1Result: ProcessMessageResult,
): void {
  const v1Started = Date.now();
  // Defer to the next tick so the v1 send path is never delayed.
  setImmediate(() => {
    processMessageV2(summarize(input))
      .then((v2) => {
        const cmp: ShadowComparison = {
          traceId: String(v2.metadata.traceId ?? 'unknown'),
          v1Intent: v1Result.intent,
          v2Intent: v2.intent,
          intentMatch: v1Result.intent === v2.intent,
          v1Success: v1Result.success,
          v2Success: v2.success,
          v1Ms: v1Result.metadata.processingTimeMs,
          v2Ms: v2.metadata.processingTimeMs,
          v2Degraded: !v2.success,
          v2Tools: v2.metadata.toolsUsed ?? [],
          responseLengthDelta: v2.response.length - v1Result.response.length,
        };
        logger.info('[shadow] v1 vs v2 comparison', {
          ...cmp,
          v1ResponsePreview: redactForLog(v1Result.response.slice(0, 120)),
          v2ResponsePreview: redactForLog(v2.response.slice(0, 120)),
        });
      })
      .catch((err) => {
        logger.warn('[shadow] v2 shadow run failed', {
          error: redactForLog(String((err as Error)?.message ?? err)),
          v1Ms: Date.now() - v1Started,
        });
      });
  });
}
