import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { resilientHttp } from './circuit-breaker.service';

/**
 * Send typing indicator to Channel Service
 * @param wa_user_id - User's WhatsApp phone number
 * @param state - 'composing' | 'paused' | 'stop'
 */
export async function sendTypingIndicator(
  wa_user_id: string,
  state: 'composing' | 'paused' | 'stop' = 'composing',
  village_id?: string
): Promise<boolean> {
  // Skip WhatsApp API calls in testing mode
  if (config.testingMode) {
    logger.debug('TESTING MODE: Skipping typing indicator', {
      wa_user_id,
      state,
    });
    return true;
  }

  try {
    const url = `${config.channelServiceUrl}/internal/typing`;
    
    await axios.post(
      url,
      {
        village_id,
        wa_user_id,
        state,
      },
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );
    
    logger.debug('Typing indicator sent', {
      wa_user_id,
      state,
    });
    
    return true;
  } catch (error: any) {
    logger.warn('Failed to send typing indicator', {
      wa_user_id,
      state,
      error: error.message,
    });
    // Don't throw - typing indicator is non-critical
    return false;
  }
}

/**
 * Start typing indicator (composing)
 */
export async function startTyping(wa_user_id: string, village_id?: string): Promise<boolean> {
  return sendTypingIndicator(wa_user_id, 'composing', village_id);
}

/**
 * Stop typing indicator
 */
export async function stopTyping(wa_user_id: string, village_id?: string): Promise<boolean> {
  return sendTypingIndicator(wa_user_id, 'stop', village_id);
}

/**
 * Mark messages as read via Channel Service
 * This is called when AI starts processing the message
 * @param wa_user_id - User's WhatsApp phone number
 * @param message_ids - Array of message IDs to mark as read
 */
export async function markMessagesAsRead(
  wa_user_id: string,
  message_ids: string[],
  village_id?: string
): Promise<boolean> {
  // Skip WhatsApp API calls in testing mode
  if (config.testingMode) {
    logger.debug('TESTING MODE: Skipping mark messages as read', {
      wa_user_id,
      count: message_ids.length,
    });
    return true;
  }

  try {
    const url = `${config.channelServiceUrl}/internal/messages/read`;
    
    await axios.post(
      url,
      {
        village_id,
        wa_user_id,
        message_ids,
      },
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );
    
    logger.debug('Messages marked as read', {
      wa_user_id,
      count: message_ids.length,
    });
    
    return true;
  } catch (error: any) {
    logger.warn('Failed to mark messages as read', {
      wa_user_id,
      error: error.message,
    });
    // Don't throw - marking as read is non-critical
    return false;
  }
}

/**
 * Check if a user is in takeover mode (admin handling)
 * @param wa_user_id - User's WhatsApp phone number
 * @returns true if user is in takeover mode, false otherwise
 */
export async function isUserInTakeover(wa_user_id: string, village_id?: string): Promise<boolean> {
  // Skip takeover check in testing mode (assume AI always processes)
  if (config.testingMode) {
    logger.debug('TESTING MODE: Skipping takeover check (AI processes)', {
      wa_user_id,
    });
    return false;
  }

  try {
    const url = `${config.channelServiceUrl}/internal/takeover/${encodeURIComponent(wa_user_id)}/status`;
    
    const response = await resilientHttp.get<{ is_takeover?: boolean }>(url, {
      headers: {
        'x-internal-api-key': config.internalApiKey,
      },
      params: village_id ? { village_id } : undefined,
      timeout: 5000,
    });

    if (resilientHttp.isFallbackResponse(response)) return false;
    
    const isTakeover = response.data?.is_takeover === true;
    
    logger.debug('Checked takeover status', {
      wa_user_id,
      isTakeover,
    });
    
    return isTakeover;
  } catch (error: any) {
    logger.warn('Failed to check takeover status', {
      wa_user_id,
      error: error.message,
    });
    // Default to false (AI processes) if check fails
    return false;
  }
}

/**
 * Update user profile in conversation
 * Called when user provides their name or phone during conversation
 */
export async function updateConversationUserProfile(
  channel_identifier: string,
  updates: { user_name?: string; user_phone?: string },
  village_id?: string,
  channel: 'WHATSAPP' | 'WEBCHAT' = 'WHATSAPP'
): Promise<boolean> {
  // Skip in testing mode
  if (config.testingMode) {
    logger.debug('TESTING MODE: Skipping user profile update', {
      channel,
      channel_identifier,
      updates,
    });
    return true;
  }

  try {
    const url = `${config.channelServiceUrl}/internal/conversations/user-profile`;
    
    await axios.patch(
      url,
      {
        village_id,
        channel_identifier,
        channel,
        user_name: updates.user_name,
        user_phone: updates.user_phone,
      },
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );
    
    logger.info('Conversation user profile updated', {
      channel,
      channel_identifier,
      updates: {
        user_name: updates.user_name,
        user_phone: updates.user_phone ? '***' : undefined,
      },
    });
    
    return true;
  } catch (error: any) {
    logger.warn('Failed to update conversation user profile', {
      channel,
      channel_identifier,
      error: error.message,
    });
    // Don't throw - profile update is non-critical
    return false;
  }
}
