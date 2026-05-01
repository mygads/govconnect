import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { scrubSecrets } from '../utils/crypto';

const PREVIEW_LIMIT = 4000;

export interface GenerationLogRecord {
  token_usage_id?: string | null;
  village_id?: string | null;
  wa_user_id?: string | null;
  session_id?: string | null;
  channel?: string | null;
  message_id?: string | null;
  trace_id?: string | null;
  billing_group_id?: string | null;
  lane_type?: string | null;
  layer_type?: string | null;
  call_type?: string | null;
  provider_id?: string | null;
  model_config_id?: string | null;
  provider?: string | null;
  model: string;
  gateway_source?: string | null;
  response_id?: string | null;
  finish_reason?: string | null;
  streaming?: boolean;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  actual_cost_usd?: number;
  adjusted_cost_usd?: number;
  duration_ms?: number | null;
  status?: string;
  error_message?: string | null;
  request_json?: unknown;
  response_json?: unknown;
  prompt_preview?: string | null;
  completion_preview?: string | null;
}

function scrubJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(scrubSecrets(JSON.stringify(value))) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

function preview(value?: string | null): string | null {
  if (!value) return null;
  return scrubSecrets(value).slice(0, PREVIEW_LIMIT);
}

export async function recordGenerationLog(record: GenerationLogRecord): Promise<void> {
  try {
    await (prisma as any).ai_generation_logs.create({
      data: {
        token_usage_id: record.token_usage_id ?? null,
        village_id: record.village_id ?? null,
        wa_user_id: record.wa_user_id ?? null,
        session_id: record.session_id ?? null,
        channel: record.channel ?? null,
        message_id: record.message_id ?? null,
        trace_id: record.trace_id ?? null,
        billing_group_id: record.billing_group_id ?? null,
        lane_type: record.lane_type ?? null,
        layer_type: record.layer_type ?? null,
        call_type: record.call_type ?? null,
        provider_id: record.provider_id ?? null,
        model_config_id: record.model_config_id ?? null,
        provider: record.provider ?? null,
        model: record.model,
        gateway_source: record.gateway_source ?? null,
        response_id: record.response_id ?? null,
        finish_reason: record.finish_reason ?? null,
        streaming: record.streaming ?? false,
        input_tokens: record.input_tokens ?? 0,
        output_tokens: record.output_tokens ?? 0,
        total_tokens: record.total_tokens ?? 0,
        actual_cost_usd: record.actual_cost_usd ?? 0,
        adjusted_cost_usd: record.adjusted_cost_usd ?? 0,
        duration_ms: record.duration_ms ?? null,
        status: record.status ?? 'success',
        error_message: preview(record.error_message),
        request_json: scrubJson(record.request_json),
        response_json: scrubJson(record.response_json),
        prompt_preview: preview(record.prompt_preview),
        completion_preview: preview(record.completion_preview),
      },
    });
  } catch (error: any) {
    logger.warn('Failed to record AI generation log', { error: error?.message || String(error) });
  }
}
