import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';

export type ObservabilityExportKind =
  | 'all'
  | 'interactions'
  | 'retrieval'
  | 'memory'
  | 'guardrails'
  | 'tool_policy_events'
  | 'tool_policies'
  | 'generation_logs'
  | 'token_usage'
  | 'message_billings'
  | 'wallet_ledger';

export async function exportObservabilityData(
  kind: ObservabilityExportKind,
  filters?: {
    villageId?: string;
    channel?: string;
    limit?: number;
  },
): Promise<Record<string, unknown>> {
  const limit = Math.max(1, Math.min(filters?.limit || 500, 5000));
  const payload: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    filters: filters || {},
  };

  if (kind === 'all' || kind === 'interactions') {
    payload.interactions = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM ai."ai_interaction_events"
      WHERE 1 = 1
      ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
      ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  }

  if (kind === 'all' || kind === 'retrieval') {
    payload.retrieval = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM ai."ai_retrieval_traces"
      WHERE 1 = 1
      ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
      ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  }

  if (kind === 'all' || kind === 'memory') {
    payload.memory = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM ai."ai_memory_traces"
      WHERE 1 = 1
      ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
      ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  }

  if (kind === 'all' || kind === 'guardrails') {
    payload.guardrails = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM ai."ai_guardrail_events"
      WHERE 1 = 1
      ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
      ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  }

  if (kind === 'all' || kind === 'tool_policy_events') {
    payload.tool_policy_events = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM ai."ai_tool_policy_events"
      WHERE 1 = 1
      ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
      ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  }


  if (kind === 'all' || kind === 'generation_logs') {
    payload.generation_logs = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM ai."ai_generation_logs"
      WHERE 1 = 1
      ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
      ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  }

  if (kind === 'all' || kind === 'token_usage') {
    payload.token_usage = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM ai."ai_token_usage"
      WHERE 1 = 1
      ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
      ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  }

  if (kind === 'all' || kind === 'message_billings') {
    payload.message_billings = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM ai."ai_message_billings"
      WHERE 1 = 1
      ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
      ${filters?.channel ? Prisma.sql`AND channel = ${filters.channel}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  }

  if (kind === 'all' || kind === 'wallet_ledger') {
    payload.wallet_ledger = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM ai."ai_wallet_ledger_entries"
      WHERE 1 = 1
      ${filters?.villageId ? Prisma.sql`AND village_id = ${filters.villageId}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  }

  if (kind === 'all' || kind === 'tool_policies') {
    payload.tool_policies = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT *
      FROM ai."ai_tool_allowlist_policies"
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `);
  }

  return payload;
}

export function toNdjson(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([key]) => key !== 'exported_at' && key !== 'filters')
    .flatMap(([kind, value]) => {
      if (!Array.isArray(value)) {
        return [];
      }
      return value.map((row) => JSON.stringify({ kind, row }));
    })
    .join('\n');
}
