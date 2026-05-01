import prisma from '../config/database';
import logger from '../utils/logger';

export type WaActivitySeverity = 'info' | 'warning' | 'error';

export interface WaActivityInput {
  villageId: string;
  sessionId?: string | null;
  waUserId?: string | null;
  channelIdentifier?: string | null;
  type: string;
  severity?: WaActivitySeverity;
  status?: string | null;
  message: string;
  providerEvent?: string | null;
  providerMessageId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WaActivityFilters {
  villageId: string;
  type?: string;
  severity?: WaActivitySeverity;
  limit?: number;
}

export async function logWaActivity(input: WaActivityInput) {
  try {
    return await prisma.waActivityLog.create({
      data: {
        village_id: input.villageId,
        session_id: input.sessionId || null,
        wa_user_id: input.waUserId || null,
        channel_identifier: input.channelIdentifier || input.waUserId || null,
        type: input.type,
        severity: input.severity || 'info',
        status: input.status || null,
        message: input.message,
        provider_event: input.providerEvent || null,
        provider_message_id: input.providerMessageId || null,
        metadata: input.metadata === undefined ? undefined : input.metadata as any,
      },
    });
  } catch (error: any) {
    logger.warn('Failed to write WA activity log', {
      village_id: input.villageId,
      type: input.type,
      error: error.message,
    });
    return null;
  }
}

export async function listWaActivities(filters: WaActivityFilters) {
  const limit = Math.max(1, Math.min(filters.limit || 20, 100));
  return prisma.waActivityLog.findMany({
    where: {
      village_id: filters.villageId,
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
    },
    orderBy: { created_at: 'desc' },
    take: limit,
  });
}
