import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';

/**
 * Send typing indicator to Channel Service
 * @param wa_user_id - User's WhatsApp phone number
 * @param state - 'composing' | 'paused' | 'stop'
 */
export async function sendTypingIndicator(
  wa_user_id: string,
  state: 'composing' | 'paused' | 'stop' = 'composing'
): Promise<boolean> {
  try {
    const url = `${config.channelServiceUrl}/internal/typing`;
    
    await axios.post(
      url,
      {
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
export async function startTyping(wa_user_id: string): Promise<boolean> {
  return sendTypingIndicator(wa_user_id, 'composing');
}

/**
 * Stop typing indicator
 */
export async function stopTyping(wa_user_id: string): Promise<boolean> {
  return sendTypingIndicator(wa_user_id, 'stop');
}

/**
 * Check if a user is in takeover mode (admin handling)
 * @param wa_user_id - User's WhatsApp phone number
 * @returns true if user is in takeover mode, false otherwise
 */
export async function isUserInTakeover(wa_user_id: string): Promise<boolean> {
  try {
    const url = `${config.channelServiceUrl}/internal/takeover/${encodeURIComponent(wa_user_id)}/status`;
    
    const response = await axios.get(url, {
      headers: {
        'x-internal-api-key': config.internalApiKey,
      },
      timeout: 5000,
    });
    
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
