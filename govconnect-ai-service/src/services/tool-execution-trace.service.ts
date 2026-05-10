import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import type { ToolExecutionTrace } from './agent/tool-executor';

export async function recordToolExecutionTraces(input: {
  traceId?: string;
  billingGroupId?: string;
  messageId?: string;
  waUserId?: string;
  sessionId?: string;
  villageId?: string;
  channel?: string;
  toolTrace?: ToolExecutionTrace[];
}): Promise<void> {
  const traces = Array.isArray(input.toolTrace) ? input.toolTrace : [];
  if (!traces.length) return;

  try {
    for (const [index, trace] of traces.entries()) {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO ai."ai_tool_execution_traces" (
          id,
          trace_id,
          billing_group_id,
          message_id,
          wa_user_id,
          session_id,
          village_id,
          channel,
          tool_name,
          sequence,
          success,
          duration_ms,
          trust_level,
          source_kind,
          metadata_json
        ) VALUES (
          ${randomUUID()},
          ${input.traceId ?? null},
          ${input.billingGroupId ?? null},
          ${input.messageId ?? null},
          ${input.waUserId ?? null},
          ${input.sessionId ?? null},
          ${input.villageId ?? null},
          ${input.channel ?? null},
          ${trace.tool},
          ${index + 1},
          ${trace.success},
          ${trace.durationMs ?? null},
          ${trace.trustLevel ?? null},
          ${trace.sourceKind ?? null},
          ${JSON.stringify({
            trustLevel: trace.trustLevel,
            sourceKind: trace.sourceKind,
            ...(trace.redactedPayload ? { payload: trace.redactedPayload } : {}),
            ...(trace.outcome ? { outcome: trace.outcome } : {}),
          })}::jsonb
        )
      `);
    }
  } catch (error: any) {
    logger.warn('Failed to record tool execution traces', {
      traceId: input.traceId,
      billingGroupId: input.billingGroupId,
      error: error?.message || String(error),
    });
  }
}
