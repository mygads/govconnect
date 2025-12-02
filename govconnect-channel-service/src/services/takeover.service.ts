import prisma from '../config/database';
import logger from '../utils/logger';

export interface TakeoverSession {
  id: string;
  wa_user_id: string;
  admin_id: string;
  admin_name: string | null;
  started_at: Date;
  ended_at: Date | null;
  reason: string | null;
}

export interface ConversationSummary {
  id: string;
  wa_user_id: string;
  user_name: string | null;
  last_message: string | null;
  last_message_at: Date;
  unread_count: number;
  is_takeover: boolean;
}

/**
 * Check if a user is currently in takeover mode
 */
export async function isUserInTakeover(wa_user_id: string): Promise<boolean> {
  try {
    const session = await prisma.takeoverSession.findFirst({
      where: {
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
export async function getActiveTakeover(wa_user_id: string): Promise<TakeoverSession | null> {
  try {
    const session = await prisma.takeoverSession.findFirst({
      where: {
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
  reason?: string
): Promise<TakeoverSession> {
  // End any existing takeover first
  await endTakeover(wa_user_id);

  const session = await prisma.takeoverSession.create({
    data: {
      wa_user_id,
      admin_id,
      admin_name,
      reason,
    },
  });

  // Update conversation to mark as takeover
  await prisma.conversation.upsert({
    where: { wa_user_id },
    update: { is_takeover: true },
    create: {
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
export async function endTakeover(wa_user_id: string): Promise<boolean> {
  try {
    const result = await prisma.takeoverSession.updateMany({
      where: {
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
        where: { wa_user_id },
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
 */
export async function updateConversation(
  wa_user_id: string,
  last_message: string,
  user_name?: string,
  incrementUnread: boolean = true
): Promise<void> {
  try {
    const existingConv = await prisma.conversation.findUnique({
      where: { wa_user_id },
    });

    await prisma.conversation.upsert({
      where: { wa_user_id },
      update: {
        last_message: last_message.substring(0, 500),
        last_message_at: new Date(),
        unread_count: incrementUnread ? (existingConv?.unread_count || 0) + 1 : existingConv?.unread_count || 0,
        user_name: user_name || existingConv?.user_name,
      },
      create: {
        wa_user_id,
        user_name,
        last_message: last_message.substring(0, 500),
        unread_count: incrementUnread ? 1 : 0,
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
    await prisma.conversation.update({
      where: { wa_user_id },
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
  return prisma.conversation.findUnique({
    where: { wa_user_id },
  });
}

/**
 * Delete conversation and all related data for a user
 */
export async function deleteConversationHistory(wa_user_id: string): Promise<void> {
  try {
    // Delete all messages for this user
    await prisma.message.deleteMany({
      where: { wa_user_id },
    });

    // Delete all takeover sessions for this user using raw query
    await prisma.$executeRaw`DELETE FROM "channel"."takeover_sessions" WHERE wa_user_id = ${wa_user_id}`;

    // Delete the conversation record using raw query
    await prisma.$executeRaw`DELETE FROM "channel"."conversations" WHERE wa_user_id = ${wa_user_id}`;

    logger.info('Deleted conversation history', { wa_user_id });
  } catch (error: any) {
    logger.error('Failed to delete conversation history', { error: error.message, wa_user_id });
    throw error;
  }
}
