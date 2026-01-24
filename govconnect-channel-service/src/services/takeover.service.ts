import prisma from '../config/database';
import logger from '../utils/logger';

function resolveVillageId(villageId?: string): string {
  return villageId || process.env.DEFAULT_VILLAGE_ID || 'default';
}

export interface TakeoverSession {
  id: string;
  village_id: string;
  wa_user_id: string;
  admin_id: string;
  admin_name: string | null;
  started_at: Date;
  ended_at: Date | null;
  reason: string | null;
}

export interface ConversationSummary {
  id: string;
  village_id: string;
  wa_user_id: string;
  user_name: string | null;
  last_message: string | null;
  last_message_at: Date;
  unread_count: number;
  is_takeover: boolean;
  ai_status: string | null; // null | "processing" | "error"
  ai_error_message: string | null;
  pending_message_id: string | null;
}

/**
 * Check if a user is currently in takeover mode
 */
export async function isUserInTakeover(
  wa_user_id: string,
  village_id?: string
): Promise<boolean> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    const session = await prisma.takeoverSession.findFirst({
      where: {
        village_id: resolvedVillageId,
        wa_user_id,
        ended_at: null, // Active session
      },
    });
    return !!session;
  } catch (error: any) {
    logger.error('Failed to check takeover status', { error: error.message, wa_user_id });
    return false;
  }
}

/**
 * Get active takeover session for a user
 */
export async function getActiveTakeover(
  wa_user_id: string,
  village_id?: string
): Promise<TakeoverSession | null> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    const session = await prisma.takeoverSession.findFirst({
      where: {
        village_id: resolvedVillageId,
        wa_user_id,
        ended_at: null,
      },
    });
    return session;
  } catch (error: any) {
    logger.error('Failed to get takeover session', { error: error.message, wa_user_id });
    return null;
  }
}

/**
 * Start takeover for a user
 */
export async function startTakeover(
  wa_user_id: string,
  admin_id: string,
  admin_name?: string,
  reason?: string,
  village_id?: string
): Promise<TakeoverSession> {
  const resolvedVillageId = resolveVillageId(village_id);
  // End any existing takeover first
  await endTakeover(wa_user_id, resolvedVillageId);

  const session = await prisma.takeoverSession.create({
    data: {
      village_id: resolvedVillageId,
      wa_user_id,
      admin_id,
      admin_name,
      reason,
    },
  });

  // Update conversation to mark as takeover
  await prisma.conversation.upsert({
    where: {
      village_id_wa_user_id: {
        village_id: resolvedVillageId,
        wa_user_id,
      },
    },
    update: { is_takeover: true },
    create: {
      village_id: resolvedVillageId,
      wa_user_id,
      is_takeover: true,
    },
  });

  logger.info('Takeover started', { wa_user_id, admin_id, session_id: session.id });
  return session;
}

/**
 * End takeover for a user
 */
export async function endTakeover(wa_user_id: string, village_id?: string): Promise<boolean> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    const result = await prisma.takeoverSession.updateMany({
      where: {
        village_id: resolvedVillageId,
        wa_user_id,
        ended_at: null,
      },
      data: {
        ended_at: new Date(),
      },
    });

    if (result.count > 0) {
      // Update conversation to mark as not takeover
      await prisma.conversation.update({
        where: {
          village_id_wa_user_id: {
            village_id: resolvedVillageId,
            wa_user_id,
          },
        },
        data: { is_takeover: false },
      });

      logger.info('Takeover ended', { wa_user_id, sessions_ended: result.count });
      return true;
    }
    return false;
  } catch (error: any) {
    logger.error('Failed to end takeover', { error: error.message, wa_user_id });
    return false;
  }
}

/**
 * Get all active takeover sessions
 */
export async function getActiveTakeovers(): Promise<TakeoverSession[]> {
  return prisma.takeoverSession.findMany({
    where: {
      ended_at: null,
    },
    orderBy: {
      started_at: 'desc',
    },
  });
}

/**
 * Update or create conversation summary
 * @param incrementUnread - true to increment unread count (for incoming messages)
 *                         - false to keep current count (for outgoing messages)
 *                         - 'reset' to reset unread count to 0 (when AI/admin replies)
 */
export async function updateConversation(
  wa_user_id: string,
  last_message: string,
  user_name?: string,
  incrementUnread: boolean | 'reset' = true,
  village_id?: string
): Promise<void> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    const existingConv = await prisma.conversation.findUnique({
      where: {
        village_id_wa_user_id: {
          village_id: resolvedVillageId,
          wa_user_id,
        },
      },
    });

    // Determine new unread count
    let newUnreadCount: number;
    if (incrementUnread === 'reset') {
      // Reset to 0 when AI/admin replies - message has been processed
      newUnreadCount = 0;
    } else if (incrementUnread === true) {
      // Increment for incoming messages
      newUnreadCount = (existingConv?.unread_count || 0) + 1;
    } else {
      // Keep current count
      newUnreadCount = existingConv?.unread_count || 0;
    }

    await prisma.conversation.upsert({
      where: {
        village_id_wa_user_id: {
          village_id: resolvedVillageId,
          wa_user_id,
        },
      },
      update: {
        last_message: last_message.substring(0, 500),
        last_message_at: new Date(),
        unread_count: newUnreadCount,
        user_name: user_name || existingConv?.user_name,
      },
      create: {
        village_id: resolvedVillageId,
        wa_user_id,
        user_name,
        last_message: last_message.substring(0, 500),
        unread_count: incrementUnread === true ? 1 : 0,
      },
    });
  } catch (error: any) {
    logger.error('Failed to update conversation', { error: error.message, wa_user_id });
  }
}

/**
 * Mark conversation as read (reset unread count)
 */
export async function markConversationAsRead(wa_user_id: string): Promise<void> {
  try {
    const village_id = resolveVillageId(undefined);
    await prisma.conversation.update({
      where: {
        village_id_wa_user_id: {
          village_id,
          wa_user_id,
        },
      },
      data: { unread_count: 0 },
    });
  } catch (error: any) {
    // Conversation might not exist
    logger.debug('Could not mark conversation as read', { wa_user_id });
  }
}

/**
 * Get all conversations for live chat list
 */
export async function getConversations(
  filter: 'all' | 'takeover' | 'bot' = 'all',
  limit: number = 50
): Promise<ConversationSummary[]> {
  const where = filter === 'all' 
    ? {} 
    : filter === 'takeover' 
      ? { is_takeover: true }
      : { is_takeover: false };

  return prisma.conversation.findMany({
    where,
    orderBy: {
      last_message_at: 'desc',
    },
    take: limit,
  });
}

/**
 * Get conversation by wa_user_id
 */
export async function getConversation(wa_user_id: string): Promise<ConversationSummary | null> {
  const village_id = resolveVillageId(undefined);
  return prisma.conversation.findUnique({
    where: {
      village_id_wa_user_id: {
        village_id,
        wa_user_id,
      },
    },
  });
}

/**
 * Delete conversation and all related data for a user
 */
export async function deleteConversationHistory(wa_user_id: string): Promise<void> {
  try {
    const village_id = resolveVillageId(undefined);
    // Delete all messages for this user
    await prisma.message.deleteMany({
      where: { village_id, wa_user_id },
    });

    // Delete all takeover sessions for this user using raw query
    await prisma.$executeRaw`DELETE FROM takeover_sessions WHERE village_id = ${village_id} AND wa_user_id = ${wa_user_id}`;

    // Delete the conversation record using raw query
    await prisma.$executeRaw`DELETE FROM conversations WHERE village_id = ${village_id} AND wa_user_id = ${wa_user_id}`;

    logger.info('Deleted conversation history', { wa_user_id });
  } catch (error: any) {
    logger.error('Failed to delete conversation history', { error: error.message, wa_user_id });
    throw error;
  }
}

/**
 * Set AI processing status to "processing"
 */
export async function setAIProcessing(
  wa_user_id: string,
  message_id: string,
  village_id?: string
): Promise<void> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    await prisma.conversation.upsert({
      where: {
        village_id_wa_user_id: {
          village_id: resolvedVillageId,
          wa_user_id,
        },
      },
      update: {
        ai_status: 'processing',
        pending_message_id: message_id,
        ai_error_message: null,
      },
      create: {
        village_id: resolvedVillageId,
        wa_user_id,
        ai_status: 'processing',
        pending_message_id: message_id,
      },
    });
    logger.info('AI processing started', { wa_user_id, message_id });
  } catch (error: any) {
    logger.error('Failed to set AI processing status', { error: error.message, wa_user_id });
  }
}

/**
 * Clear AI processing status (success)
 */
export async function clearAIStatus(wa_user_id: string, village_id?: string): Promise<void> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    await prisma.conversation.update({
      where: {
        village_id_wa_user_id: {
          village_id: resolvedVillageId,
          wa_user_id,
        },
      },
      data: {
        ai_status: null,
        ai_error_message: null,
        pending_message_id: null,
      },
    });
    logger.info('AI status cleared', { wa_user_id });
  } catch (error: any) {
    logger.debug('Could not clear AI status', { wa_user_id });
  }
}

/**
 * Set AI error status (failed)
 */
export async function setAIError(
  wa_user_id: string,
  error_message: string,
  message_id?: string,
  village_id?: string
): Promise<void> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    await prisma.conversation.update({
      where: {
        village_id_wa_user_id: {
          village_id: resolvedVillageId,
          wa_user_id,
        },
      },
      data: {
        ai_status: 'error',
        ai_error_message: error_message.substring(0, 500),
        pending_message_id: message_id || undefined,
      },
    });
    logger.info('AI error status set', { wa_user_id, error_message });
  } catch (error: any) {
    logger.error('Failed to set AI error status', { error: error.message, wa_user_id });
  }
}

/**
 * Get pending message for retry
 */
export async function getPendingMessage(wa_user_id: string): Promise<{ message_id: string; message_text: string } | null> {
  try {
    const village_id = resolveVillageId(undefined);
    const conversation = await prisma.conversation.findUnique({
      where: {
        village_id_wa_user_id: {
          village_id,
          wa_user_id,
        },
      },
    });

    if (!conversation?.pending_message_id) {
      return null;
    }

    const message = await prisma.message.findFirst({
      where: {
        village_id,
        wa_user_id,
        message_id: conversation.pending_message_id,
      },
    });

    if (!message) {
      return null;
    }

    return {
      message_id: message.message_id,
      message_text: message.message_text,
    };
  } catch (error: any) {
    logger.error('Failed to get pending message', { error: error.message, wa_user_id });
    return null;
  }
}
