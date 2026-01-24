/**
 * Webchat Sync Service
 * 
 * Syncs webchat messages to Channel Service database
 * so they appear in Live Chat dashboard and admin can takeover
 */

import axios from 'axios';
import { config } from '../config/env';
import logger from '../utils/logger';

const CHANNEL_SERVICE_URL = config.channelServiceUrl;
const INTERNAL_API_KEY = config.internalApiKey;

/**
 * Save incoming webchat message to Channel Service
 * Uses /internal/messages endpoint which handles both message storage and conversation update
 */
export async function saveWebchatMessage(data: {
  session_id: string;
  village_id?: string;
  message: string;
  direction: 'IN' | 'OUT';
  source?: 'USER' | 'AI' | 'ADMIN';
}): Promise<boolean> {
  try {
    const messageId = `webchat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await axios.post(
      `${CHANNEL_SERVICE_URL}/internal/messages`,
      {
        village_id: data.village_id,
        wa_user_id: data.session_id,
        message_id: messageId,
        message_text: data.message,
        direction: data.direction,
        source: data.source || (data.direction === 'IN' ? 'USER' : 'AI'),
        metadata: {
          channel: 'webchat',
          timestamp: new Date().toISOString(),
        },
      },
      {
        headers: {
          'x-internal-api-key': INTERNAL_API_KEY,
          ...(data.village_id ? { 'x-village-id': data.village_id } : {}),
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );
    
    logger.debug('Webchat message saved to Channel Service', {
      session_id: data.session_id,
      direction: data.direction,
    });
    
    return true;
  } catch (error: any) {
    logger.warn('Failed to save webchat message to Channel Service', {
      session_id: data.session_id,
      error: error.message,
    });
    return false;
  }
}

/**
 * Update webchat conversation in Channel Service
 * Note: This is now handled automatically by storeMessage in internal.controller.ts
 * This function is kept for explicit conversation updates if needed
 */
export async function updateWebchatConversation(data: {
  session_id: string;
  last_message?: string;
  unread_count?: number;
  resetUnread?: boolean;
}): Promise<boolean> {
  // Conversation is automatically updated when messages are stored via /internal/messages
  // This function is now a no-op but kept for API compatibility
  logger.debug('Webchat conversation update (handled by message storage)', {
    session_id: data.session_id,
    resetUnread: data.resetUnread,
  });
  return true;
}

/**
 * Check if webchat session is taken over by admin
 * Uses /internal/takeover/:wa_user_id/status endpoint
 */
export async function checkWebchatTakeover(
  session_id: string,
  village_id?: string
): Promise<{
  is_takeover: boolean;
  admin_id?: string;
  admin_name?: string;
}>;

export async function checkWebchatTakeover(
  session_id: string,
  village_id?: string
): Promise<{
  is_takeover: boolean;
  admin_id?: string;
  admin_name?: string;
}> {
  try {
    const response = await axios.get(
      `${CHANNEL_SERVICE_URL}/internal/takeover/${encodeURIComponent(session_id)}/status`,
      {
        params: {
          ...(village_id ? { village_id } : {}),
        },
        headers: {
          'x-internal-api-key': INTERNAL_API_KEY,
          ...(village_id ? { 'x-village-id': village_id } : {}),
        },
        timeout: 3000,
      }
    );
    
    // Response format: { success: true, is_takeover: boolean, session: {...} }
    const { is_takeover, session } = response.data;
    
    return {
      is_takeover: !!is_takeover,
      admin_id: session?.admin_id,
      admin_name: session?.admin_name,
    };
  } catch (error: any) {
    // If error, assume no takeover to allow AI to respond
    logger.warn('Failed to check webchat takeover status', {
      session_id,
      error: error.message,
    });
    
    return { is_takeover: false };
  }
}

/**
 * Get pending admin messages for webchat session
 * Called by webchat to check if admin has sent any messages while user was away
 */
export async function getAdminMessages(
  session_id: string,
  since?: Date,
  village_id?: string
): Promise<Array<{
  message: string;
  admin_name?: string;
  timestamp: Date;
}>>;

export async function getAdminMessages(
  session_id: string,
  since?: Date,
  village_id?: string
): Promise<Array<{
  message: string;
  admin_name?: string;
  timestamp: Date;
}>> {
  try {
    const response = await axios.get(
      `${CHANNEL_SERVICE_URL}/internal/messages`,
      {
        params: {
          wa_user_id: session_id,
          limit: 20, // Increase limit to get more messages
          ...(village_id ? { village_id } : {}),
        },
        headers: {
          'x-internal-api-key': INTERNAL_API_KEY,
          ...(village_id ? { 'x-village-id': village_id } : {}),
        },
        timeout: 3000,
      }
    );
    
    // Filter for admin messages only (direction OUT and source ADMIN)
    const messages = response.data.messages || [];
    const sinceTime = since ? since.getTime() : 0;
    
    return messages
      .filter((m: any) => {
        // Must be outgoing message from ADMIN
        if (m.direction !== 'OUT' || m.source !== 'ADMIN') {
          return false;
        }
        // Must be after 'since' timestamp if provided
        if (since) {
          const msgTime = new Date(m.timestamp).getTime();
          return msgTime > sinceTime;
        }
        return true;
      })
      .map((m: any) => ({
        message: m.message_text,
        admin_name: m.admin_name,
        timestamp: new Date(m.timestamp),
      }))
      .sort((a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime()); // Sort oldest first
  } catch (error: any) {
    logger.warn('Failed to get admin messages', {
      session_id,
      error: error.message,
    });
    return [];
  }
}

export default {
  saveWebchatMessage,
  updateWebchatConversation,
  checkWebchatTakeover,
  getAdminMessages,
};
