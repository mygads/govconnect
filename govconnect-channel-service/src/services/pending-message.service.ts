import prisma from '../config/database';
import logger from '../utils/logger';

export interface PendingMessageData {
  village_id?: string;
  wa_user_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier: string;
  message_id: string;
  message_text: string;
}

export interface PendingMessage {
  id: string;
  village_id: string;
  wa_user_id?: string | null;
  channel: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier: string;
  message_id: string;
  message_text: string;
  status: string;
  retry_count: number;
  error_msg: string | null;
  created_at: Date;
  updated_at: Date;
}

function resolveVillageId(villageId?: string): string {
  return villageId || process.env.DEFAULT_VILLAGE_ID || 'default';
}

/**
 * Add message to pending queue
 */
export async function addPendingMessage(data: PendingMessageData): Promise<PendingMessage> {
  try {
    const villageId = resolveVillageId(data.village_id);
    const channel = data.channel || 'WHATSAPP';
    const pending = await prisma.pendingMessage.create({
      data: {
        village_id: villageId,
        wa_user_id: data.wa_user_id || null,
        channel,
        channel_identifier: data.channel_identifier,
        message_id: data.message_id,
        message_text: data.message_text,
        status: 'pending',
      },
    });
    
    logger.info('📥 Message added to pending queue', {
      channel,
      channel_identifier: data.channel_identifier,
      message_id: data.message_id,
    });
    
    return pending;
  } catch (error: any) {
    // Handle duplicate
    if (error.code === 'P2002') {
      logger.warn('Duplicate pending message', { message_id: data.message_id });
      const existing = await prisma.pendingMessage.findUnique({
        where: { message_id: data.message_id },
      });
      return existing!;
    }
    throw error;
  }
}

/**
 * Get all pending messages for a user (for batching)
 */
export async function getPendingMessagesForUser(
  channel_identifier: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<PendingMessage[]> {
  return prisma.pendingMessage.findMany({
    where: {
      village_id: resolveVillageId(village_id),
      channel,
      channel_identifier,
      status: 'pending',
    },
    orderBy: {
      created_at: 'asc', // Oldest first
    },
  });
}

/**
 * Get oldest pending message across all users
 */
export async function getNextPendingMessage(): Promise<PendingMessage | null> {
  return prisma.pendingMessage.findFirst({
    where: {
      status: 'pending',
    },
    orderBy: {
      created_at: 'asc',
    },
  });
}

/**
 * Mark messages as processing
 */
export async function markMessagesAsProcessing(messageIds: string[]): Promise<void> {
  await prisma.pendingMessage.updateMany({
    where: {
      message_id: { in: messageIds },
    },
    data: {
      status: 'processing',
      updated_at: new Date(),
    },
  });
}

/**
 * Mark messages as completed (delete from pending queue)
 */
export async function markMessagesAsCompleted(messageIds: string[]): Promise<void> {
  // Delete completed messages from pending queue to keep it clean
  const result = await prisma.pendingMessage.deleteMany({
    where: {
      message_id: { in: messageIds },
    },
  });
  
  logger.info('✅ Messages completed and removed from pending queue', { 
    count: result.count,
    messageIds,
  });
}

/**
 * Mark message as failed (for retry)
 */
export async function markMessageAsFailed(
  message_id: string, 
  error_msg: string
): Promise<void> {
  const existing = await prisma.pendingMessage.findUnique({
    where: { message_id },
  });
  
  if (!existing) return;
  
  const newRetryCount = existing.retry_count + 1;
  const maxRetries = 5;
  
  if (newRetryCount >= maxRetries) {
    // Max retries reached - mark as permanently failed
    await prisma.pendingMessage.update({
      where: { message_id },
      data: {
        status: 'failed',
        retry_count: newRetryCount,
        error_msg,
        updated_at: new Date(),
      },
    });
    
    logger.error('❌ Message failed after max retries', {
      message_id,
      retry_count: newRetryCount,
      error_msg,
    });
  } else {
    // Return to pending for retry
    await prisma.pendingMessage.update({
      where: { message_id },
      data: {
        status: 'pending',
        retry_count: newRetryCount,
        error_msg,
        updated_at: new Date(),
      },
    });
    
    logger.warn('⚠️ Message failed, will retry', {
      message_id,
      retry_count: newRetryCount,
      error_msg,
    });
  }
}

/**
 * Get pending messages count per user (for monitoring)
 */
export async function getPendingMessagesStats(): Promise<{
  total: number;
  byUser: { wa_user_id: string; count: number }[];
}> {
  const total = await prisma.pendingMessage.count({
    where: { status: 'pending' },
  });
  
  const byUser = await prisma.$queryRaw<{ wa_user_id: string; count: bigint }[]>`
    SELECT wa_user_id, COUNT(*) as count 
    FROM pending_messages 
    WHERE status = 'pending' 
    GROUP BY wa_user_id 
    ORDER BY count DESC 
    LIMIT 20
  `;
  
  return {
    total,
    byUser: byUser.map((r: { wa_user_id: string; count: bigint }) => ({
      wa_user_id: r.wa_user_id,
      count: Number(r.count),
    })),
  };
}

/**
 * Cleanup old completed/failed messages (older than 24 hours)
 */
export async function cleanupOldMessages(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const result = await prisma.pendingMessage.deleteMany({
    where: {
      status: { in: ['completed', 'failed'] },
      updated_at: { lt: cutoff },
    },
  });
  
  if (result.count > 0) {
    logger.info('🧹 Cleaned up old pending messages', { count: result.count });
  }
  
  return result.count;
}
