import prisma from '../lib/prisma';
import logger from '../utils/logger';

export type RuntimeGroundingMismatchKind =
  | 'phone_not_in_db'
  | 'operating_hour_mismatch'
  | 'office_address_mismatch'
  | 'service_cost_mismatch'
  | 'service_duration_mismatch'
  | 'service_mode_mismatch'
  | 'service_availability_mismatch'
  | 'service_requirement_mismatch';

export type RuntimeGroundingMismatchStatus = 'open' | 'resolved' | 'ignored';

export interface RuntimeGroundingMismatchRecord {
  villageId?: string | null;
  traceId?: string | null;
  userQuery?: string | null;
  responseExcerpt?: string | null;
  toolsUsed?: string[];
  mismatchKind: RuntimeGroundingMismatchKind;
  offendingValue?: string | null;
  authoritativeValue?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export interface RuntimeGroundingMismatchListFilters {
  villageId?: string;
  kind?: RuntimeGroundingMismatchKind;
  status?: RuntimeGroundingMismatchStatus;
  entityType?: string;
  traceId?: string;
  limit?: number;
  offset?: number;
}

const MAX_TEXT_LENGTH = 1500;

function truncate(raw: string | null | undefined, max = MAX_TEXT_LENGTH): string | null {
  if (!raw) return null;
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

export async function recordRuntimeGroundingMismatches(items: RuntimeGroundingMismatchRecord[]): Promise<number> {
  if (items.length === 0) return 0;

  try {
    const result = await (prisma as any).ai_runtime_grounding_mismatches.createMany({
      data: items.map((item) => ({
        village_id: item.villageId ?? null,
        trace_id: item.traceId ?? null,
        user_query: truncate(item.userQuery),
        response_excerpt: truncate(item.responseExcerpt),
        tools_used_json: item.toolsUsed ?? [],
        mismatch_kind: item.mismatchKind,
        offending_value: truncate(item.offendingValue),
        authoritative_value: truncate(item.authoritativeValue),
        entity_type: item.entityType ?? null,
        entity_id: item.entityId ?? null,
        status: 'open',
      })),
    });

    return result.count ?? items.length;
  } catch (error: any) {
    logger.warn('Failed to persist runtime grounding mismatches', {
      error: error.message,
      count: items.length,
      traceId: items[0]?.traceId,
    });
    return 0;
  }
}

export async function listRuntimeGroundingMismatches(filters: RuntimeGroundingMismatchListFilters) {
  const where: Record<string, unknown> = {};
  if (filters.villageId) where.village_id = filters.villageId;
  if (filters.kind) where.mismatch_kind = filters.kind;
  if (filters.status) where.status = filters.status;
  if (filters.entityType) where.entity_type = filters.entityType;
  if (filters.traceId) where.trace_id = filters.traceId;

  const [items, total] = await Promise.all([
    (prisma as any).ai_runtime_grounding_mismatches.findMany({
      where,
      orderBy: { detected_at: 'desc' },
      take: Math.min(filters.limit ?? 50, 200),
      skip: filters.offset ?? 0,
    }),
    (prisma as any).ai_runtime_grounding_mismatches.count({ where }),
  ]);

  return { items, total };
}

export async function summarizeRuntimeGroundingMismatches(villageId?: string) {
  const rows = await (prisma as any).ai_runtime_grounding_mismatches.groupBy({
    by: ['mismatch_kind', 'status', 'entity_type'],
    where: villageId ? { village_id: villageId } : undefined,
    _count: { _all: true },
  });

  const summary = {
    total: rows.reduce((acc: number, row: any) => acc + row._count._all, 0),
    byKind: {} as Record<string, number>,
    byStatus: {} as Record<string, number>,
    byEntityType: {} as Record<string, number>,
  };

  for (const row of rows as any[]) {
    summary.byKind[row.mismatch_kind] = (summary.byKind[row.mismatch_kind] || 0) + row._count._all;
    summary.byStatus[row.status] = (summary.byStatus[row.status] || 0) + row._count._all;
    summary.byEntityType[row.entity_type || 'unknown'] = (summary.byEntityType[row.entity_type || 'unknown'] || 0) + row._count._all;
  }

  return summary;
}

export async function updateRuntimeGroundingMismatchStatus(
  id: string,
  patch: { status: RuntimeGroundingMismatchStatus; resolvedBy?: string; resolutionNote?: string },
  villageId?: string,
) {
  const existing = await (prisma as any).ai_runtime_grounding_mismatches.findUnique({
    where: { id },
    select: { id: true, village_id: true },
  });

  if (!existing) {
    const error = new Error('Runtime mismatch not found') as Error & { code?: string };
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (villageId && existing.village_id !== villageId) {
    const error = new Error('Forbidden') as Error & { code?: string };
    error.code = 'FORBIDDEN';
    throw error;
  }

  return (prisma as any).ai_runtime_grounding_mismatches.update({
    where: { id },
    data: {
      status: patch.status,
      resolved_at: patch.status === 'open' ? null : new Date(),
      resolved_by: patch.resolvedBy ?? null,
      resolution_note: patch.resolutionNote ?? null,
    },
  });
}
