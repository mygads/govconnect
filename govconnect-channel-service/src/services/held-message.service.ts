import prisma from '../config/database';
import logger from '../utils/logger';

export interface HeldMessageInput {
  village_id: string;
  wa_user_id?: string | null;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier: string;
  message_id: string;
  message_text: string;
  has_media?: boolean;
  media_type?: string | null;
  media_url?: string | null;
  media_public_url?: string | null;
  media_caption?: string | null;
  media_mime_type?: string | null;
  media_file_name?: string | null;
  reason?: string;
}

export interface HeldMessageRow {
  id: string;
  village_id: string;
  wa_user_id: string | null;
  channel: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier: string;
  message_id: string;
  message_text: string;
  has_media: boolean;
  media_type: string | null;
  media_url: string | null;
  media_public_url: string | null;
  media_caption: string | null;
  media_mime_type: string | null;
  media_file_name: string | null;
  status: string;
  reason: string;
  created_at: Date;
  updated_at: Date;
}

function requireVillageId(villageId?: string): string {
  const normalized = typeof villageId === 'string' ? villageId.trim() : '';
  if (!normalized) {
    throw new Error('village_id is required for multi-tenancy isolation');
  }
  return normalized;
}

/**
 * Persist a message that arrived while the village AI wallet was exhausted.
 * Idempotent on message_id so duplicate webhook deliveries don't stack.
 */
export async function addHeldMessage(input: HeldMessageInput): Promise<HeldMessageRow> {
  const village_id = requireVillageId(input.village_id);
  const channel = input.channel || 'WHATSAPP';
  try {
    const row = await prisma.heldMessage.create({
      data: {
        village_id,
        wa_user_id: input.wa_user_id || null,
        channel,
        channel_identifier: input.channel_identifier,
        message_id: input.message_id,
        message_text: input.message_text,
        has_media: input.has_media ?? false,
        media_type: input.media_type || null,
        media_url: input.media_url || null,
        media_public_url: input.media_public_url || null,
        media_caption: input.media_caption || null,
        media_mime_type: input.media_mime_type || null,
        media_file_name: input.media_file_name || null,
        reason: input.reason || 'wallet_exhausted',
        status: 'held',
      } as any,
    });
    logger.info('🪙 Message held (wallet exhausted)', {
      village_id,
      channel,
      channel_identifier: input.channel_identifier,
      message_id: input.message_id,
    });
    return row as HeldMessageRow;
  } catch (error: any) {
    if (error.code === 'P2002') {
      const existing = await prisma.heldMessage.findUnique({ where: { message_id: input.message_id } });
      return existing as HeldMessageRow;
    }
    throw error;
  }
}

/**
 * Count held messages grouped per village (for dashboard badges).
 */
export async function countHeldMessagesByVillage(village_id: string): Promise<{ total: number; conversations: number }> {
  const resolved = requireVillageId(village_id);
  const rows = await prisma.heldMessage.findMany({
    where: { village_id: resolved, status: 'held' },
    select: { channel_identifier: true },
  });
  const conversations = new Set(rows.map(r => r.channel_identifier)).size;
  return { total: rows.length, conversations };
}

/**
 * List held messages for a village, oldest first. Optionally for one conversation.
 */
export async function listHeldMessages(
  village_id: string,
  channel_identifier?: string,
): Promise<HeldMessageRow[]> {
  const resolved = requireVillageId(village_id);
  const rows = await prisma.heldMessage.findMany({
    where: {
      village_id: resolved,
      status: 'held',
      ...(channel_identifier ? { channel_identifier } : {}),
    },
    orderBy: { created_at: 'asc' },
  });
  return rows as HeldMessageRow[];
}

/**
 * Delete held rows once they have been re-queued for AI processing.
 */
export async function deleteHeldMessages(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.heldMessage.deleteMany({ where: { id: { in: ids } } });
  return result.count;
}

/**
 * Delete a single held row by its WhatsApp/webchat message_id.
 */
export async function deleteHeldMessageByMessageId(message_id: string): Promise<number> {
  const result = await prisma.heldMessage.deleteMany({ where: { message_id } });
  return result.count;
}

/**
 * Distinct conversation identifiers that currently have held messages.
 */
export async function listHeldConversations(village_id: string): Promise<
  Array<{ channel: 'WHATSAPP' | 'WEBCHAT'; channel_identifier: string; wa_user_id: string | null; count: number; oldest_at: Date }>
> {
  const resolved = requireVillageId(village_id);
  const rows = await prisma.heldMessage.findMany({
    where: { village_id: resolved, status: 'held' },
    orderBy: { created_at: 'asc' },
  });
  const map = new Map<string, { channel: 'WHATSAPP' | 'WEBCHAT'; channel_identifier: string; wa_user_id: string | null; count: number; oldest_at: Date }>();
  for (const r of rows as HeldMessageRow[]) {
    const key = `${r.channel}:${r.channel_identifier}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, {
        channel: r.channel,
        channel_identifier: r.channel_identifier,
        wa_user_id: r.wa_user_id,
        count: 1,
        oldest_at: r.created_at,
      });
    }
  }
  return Array.from(map.values());
}
