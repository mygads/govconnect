import prisma from '../config/database';
import logger from '../utils/logger';

function resolveVillageId(villageId?: string): string {
  return villageId || 'unknown';
}

export interface TakeoverSession {
  id: string;
  village_id: string;
  wa_user_id?: string | null;
  channel: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier: string;
  admin_id: string;
  admin_name: string | null;
  started_at: Date;
  ended_at: Date | null;
  reason: string | null;
}

export interface ConversationSummary {
  id: string;
  village_id: string;
  wa_user_id?: string | null;
  channel: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier: string;
  user_name: string | null;
  user_phone: string | null;  // Collected phone number (for webchat)
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
  channel_identifier: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<boolean> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    const session = await prisma.takeoverSession.findFirst({
      where: {
        village_id: resolvedVillageId,
        channel,
        channel_identifier,
        ended_at: null, // Active session
      },
    });
    return !!session;
  } catch (error: any) {
    logger.error('Failed to check takeover status', { error: error.message, channel, channel_identifier });
    return false;
  }
}

/**
 * Get active takeover session for a user
 */
export async function getActiveTakeover(
  channel_identifier: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<TakeoverSession | null> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    const session = await prisma.takeoverSession.findFirst({
      where: {
        village_id: resolvedVillageId,
        channel,
        channel_identifier,
        ended_at: null,
      },
    });
    return session;
  } catch (error: any) {
    logger.error('Failed to get takeover session', { error: error.message, channel, channel_identifier });
    return null;
  }
}

/**
 * Start takeover for a user
 */
export async function startTakeover(
  channel_identifier: string,
  admin_id: string,
  admin_name?: string,
  reason?: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<TakeoverSession> {
  const resolvedVillageId = resolveVillageId(village_id);
  // End any existing takeover first
  await endTakeover(channel_identifier, resolvedVillageId, channel);

  const session = await prisma.takeoverSession.create({
    data: {
      village_id: resolvedVillageId,
      wa_user_id: channel === 'WHATSAPP' ? channel_identifier : null,
      channel,
      channel_identifier,
      admin_id,
      admin_name,
      reason,
    },
  });

  // Update conversation to mark as takeover
  await prisma.conversation.upsert({
    where: {
      village_id_channel_channel_identifier: {
        village_id: resolvedVillageId,
        channel,
        channel_identifier,
      },
    },
    update: { is_takeover: true },
    create: {
      village_id: resolvedVillageId,
      wa_user_id: channel === 'WHATSAPP' ? channel_identifier : null,
      channel,
      channel_identifier,
      is_takeover: true,
    },
  });

  logger.info('Takeover started', { channel, channel_identifier, admin_id, session_id: session.id });
  return session;
}

/**
 * End takeover for a user
 */
export async function endTakeover(
  channel_identifier: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<boolean> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    const result = await prisma.takeoverSession.updateMany({
      where: {
        village_id: resolvedVillageId,
        channel,
        channel_identifier,
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
          village_id_channel_channel_identifier: {
            village_id: resolvedVillageId,
            channel,
            channel_identifier,
          },
        },
        data: { is_takeover: false },
      });

      logger.info('Takeover ended', { channel, channel_identifier, sessions_ended: result.count });
      return true;
    }
    return false;
  } catch (error: any) {
    logger.error('Failed to end takeover', { error: error.message, channel, channel_identifier });
    return false;
  }
}

/**
 * Get all active takeover sessions (filtered by village_id for multi-tenancy)
 */
export async function getActiveTakeovers(village_id?: string): Promise<TakeoverSession[]> {
  const where: any = { ended_at: null };
  if (village_id) {
    where.village_id = village_id;
  }
  return prisma.takeoverSession.findMany({
    where,
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
  channel_identifier: string,
  last_message: string,
  user_name?: string,
  incrementUnread: boolean | 'reset' = true,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<void> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    const existingConv = await prisma.conversation.findUnique({
      where: {
        village_id_channel_channel_identifier: {
          village_id: resolvedVillageId,
          channel,
          channel_identifier,
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
        village_id_channel_channel_identifier: {
          village_id: resolvedVillageId,
          channel,
          channel_identifier,
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
        wa_user_id: channel === 'WHATSAPP' ? channel_identifier : null,
        channel,
        channel_identifier,
        user_name,
        last_message: last_message.substring(0, 500),
        unread_count: incrementUnread === true ? 1 : 0,
      },
    });
  } catch (error: any) {
    logger.error('Failed to update conversation', { error: error.message, channel, channel_identifier });
  }
}

/**
 * Mark conversation as read (reset unread count)
 */
export async function markConversationAsRead(
  channel_identifier: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<void> {
  try {
    const resolvedVillageId = village_id ? resolveVillageId(village_id) : undefined;

    if (resolvedVillageId) {
      await prisma.conversation.update({
        where: {
          village_id_channel_channel_identifier: {
            village_id: resolvedVillageId,
            channel,
            channel_identifier,
          },
        },
        data: { unread_count: 0 },
      });
    } else {
      await prisma.conversation.updateMany({
        where: { channel, channel_identifier },
        data: { unread_count: 0 },
      });
    }
  } catch (error: any) {
    // Conversation might not exist
    logger.debug('Could not mark conversation as read', { channel, channel_identifier });
  }
}

/**
 * Update user profile in conversation (name and/or phone)
 * Called by AI service when user provides their name or phone during conversation
 */
export async function updateConversationUserProfile(
  channel_identifier: string,
  updates: { user_name?: string; user_phone?: string },
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<void> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    
    const updateData: { user_name?: string; user_phone?: string } = {};
    if (updates.user_name) updateData.user_name = updates.user_name;
    if (updates.user_phone) updateData.user_phone = updates.user_phone;
    
    if (Object.keys(updateData).length === 0) return;

    await prisma.conversation.updateMany({
      where: {
        village_id: resolvedVillageId,
        channel,
        channel_identifier,
      },
      data: updateData,
    });
    
    logger.info('Updated conversation user profile', {
      channel,
      channel_identifier,
      village_id: resolvedVillageId,
      updates: updateData,
    });
  } catch (error: any) {
    logger.error('Failed to update conversation user profile', { error: error.message, channel, channel_identifier });
  }
}

/**
 * Get all conversations for live chat list
 */
export async function getConversations(
  filter: 'all' | 'takeover' | 'bot' = 'all',
  limit: number = 50,
  village_id?: string
): Promise<ConversationSummary[]> {
  const resolvedVillageId = village_id ? resolveVillageId(village_id) : undefined;
  const where = filter === 'all' 
    ? {} 
    : filter === 'takeover' 
      ? { is_takeover: true }
      : { is_takeover: false };

  if (resolvedVillageId) {
    Object.assign(where, { village_id: resolvedVillageId });
  }

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
export async function getConversation(
  channel_identifier: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<ConversationSummary | null> {
  const resolvedVillageId = village_id ? resolveVillageId(village_id) : undefined;

  if (resolvedVillageId) {
    return prisma.conversation.findUnique({
      where: {
        village_id_channel_channel_identifier: {
          village_id: resolvedVillageId,
          channel,
          channel_identifier,
        },
      },
    });
  }

  return prisma.conversation.findFirst({
    where: { channel, channel_identifier },
    orderBy: { last_message_at: 'desc' },
  });
}

/**
 * Delete conversation and all related data for a user
 */
export async function deleteConversationHistory(
  channel_identifier: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<void> {
  try {
    const resolvedVillageId = village_id ? resolveVillageId(village_id) : undefined;
    const where: any = { channel, channel_identifier };
    if (resolvedVillageId) {
      where.village_id = resolvedVillageId;
    }
    // Delete all messages for this user
    await prisma.message.deleteMany({
      where,
    });

    // Delete all takeover sessions and conversations for this user
    // Use Prisma methods instead of raw queries to avoid enum type casting issues
    if (resolvedVillageId) {
      await prisma.takeoverSession.deleteMany({
        where: {
          village_id: resolvedVillageId,
          channel,
          channel_identifier,
        },
      });
      await prisma.conversation.deleteMany({
        where: {
          village_id: resolvedVillageId,
          channel,
          channel_identifier,
        },
      });
    } else {
      await prisma.takeoverSession.deleteMany({
        where: {
          channel,
          channel_identifier,
        },
      });
      await prisma.conversation.deleteMany({
        where: {
          channel,
          channel_identifier,
        },
      });
    }

    logger.info('Deleted conversation history', { channel, channel_identifier });
  } catch (error: any) {
    logger.error('Failed to delete conversation history', { error: error.message, channel, channel_identifier });
    throw error;
  }
}

/**
 * Set AI processing status to "processing"
 */
export async function setAIProcessing(
  channel_identifier: string,
  message_id: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<void> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    await prisma.conversation.upsert({
      where: {
        village_id_channel_channel_identifier: {
          village_id: resolvedVillageId,
          channel,
          channel_identifier,
        },
      },
      update: {
        ai_status: 'processing',
        pending_message_id: message_id,
        ai_error_message: null,
      },
      create: {
        village_id: resolvedVillageId,
        wa_user_id: channel === 'WHATSAPP' ? channel_identifier : null,
        channel,
        channel_identifier,
        ai_status: 'processing',
        pending_message_id: message_id,
      },
    });
    logger.info('AI processing started', { channel, channel_identifier, message_id });
  } catch (error: any) {
    logger.error('Failed to set AI processing status', { error: error.message, channel, channel_identifier });
  }
}

/**
 * Clear AI processing status (success)
 */
export async function clearAIStatus(
  channel_identifier: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<void> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    await prisma.conversation.update({
      where: {
        village_id_channel_channel_identifier: {
          village_id: resolvedVillageId,
          channel,
          channel_identifier,
        },
      },
      data: {
        ai_status: null,
        ai_error_message: null,
        pending_message_id: null,
      },
    });
    logger.info('AI status cleared', { channel, channel_identifier });
  } catch (error: any) {
    logger.debug('Could not clear AI status', { channel, channel_identifier });
  }
}

/**
 * Set AI error status (failed)
 */
export async function setAIError(
  channel_identifier: string,
  error_message: string,
  message_id?: string,
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<void> {
  try {
    const resolvedVillageId = resolveVillageId(village_id);
    await prisma.conversation.update({
      where: {
        village_id_channel_channel_identifier: {
          village_id: resolvedVillageId,
          channel,
          channel_identifier,
        },
      },
      data: {
        ai_status: 'error',
        ai_error_message: error_message.substring(0, 500),
        pending_message_id: message_id || undefined,
      },
    });
    logger.info('AI error status set', { channel, channel_identifier, error_message });
  } catch (error: any) {
    logger.error('Failed to set AI error status', { error: error.message, channel, channel_identifier });
  }
}

/**
 * Get pending message for retry
 */
export async function getPendingMessage(
  channel_identifier: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP',
  village_id?: string
): Promise<{ message_id: string; message_text: string; village_id: string } | null> {
  try {
    // Try with provided village_id first, then search across all villages
    let conversation;
    if (village_id) {
      conversation = await prisma.conversation.findUnique({
        where: {
          village_id_channel_channel_identifier: {
            village_id,
            channel,
            channel_identifier,
          },
        },
      });
    }
    // Fallback: find any conversation for this user
    if (!conversation) {
      conversation = await prisma.conversation.findFirst({
        where: { channel, channel_identifier, pending_message_id: { not: null } },
        orderBy: { updated_at: 'desc' },
      });
    }

    if (!conversation?.pending_message_id) {
      return null;
    }

    const message = await prisma.message.findFirst({
      where: {
        village_id: conversation.village_id,
        channel,
        channel_identifier,
        message_id: conversation.pending_message_id,
      },
    });

    if (!message) {
      return null;
    }

    return {
      message_id: message.message_id,
      message_text: message.message_text,
      village_id: conversation.village_id,
    };
  } catch (error: any) {
    logger.error('Failed to get pending message', { error: error.message, channel_identifier });
    return null;
  }
}
