import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import prisma from '../config/database';

// In-memory settings cache (since we're using single session)
let sessionSettings = {
  autoReadMessages: false,
  typingIndicator: false,
};

/**
 * Load settings from database at startup
 */
export async function loadSettingsFromDatabase(): Promise<void> {
  try {
    const settings = await prisma.wa_settings.findFirst({
      where: { id: 'default' },
    });
    
    if (settings) {
      sessionSettings = {
        autoReadMessages: settings.auto_read_messages,
        typingIndicator: settings.typing_indicator,
      };
      logger.info('Settings loaded from database', { sessionSettings });
    } else {
      logger.info('No settings in database, using defaults', { sessionSettings });
    }
  } catch (error: any) {
    logger.warn('Failed to load settings from database', { error: error.message });
  }
}

// =====================================================
// SESSION MANAGEMENT FUNCTIONS
// =====================================================

interface SessionStatus {
  connected: boolean;
  loggedIn: boolean;
  jid?: string;
  qrcode?: string;
  name?: string;
  events?: string;
  webhook?: string;
}

/**
 * Get WhatsApp session status
 * API: GET {WA_API_URL}/session/status
 * Response: { code: 200, data: { connected, loggedIn, jid, name, events, webhook, ... }, success: true }
 */
export async function getSessionStatus(): Promise<SessionStatus> {
  try {
    if (!config.WA_ACCESS_TOKEN) {
      logger.warn('WhatsApp token not configured');
      return { connected: false, loggedIn: false };
    }

    const url = `${config.WA_API_URL}/session/status`;
    
    const response = await axios.get(url, {
      headers: {
        token: config.WA_ACCESS_TOKEN,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    
    // genfity-wa returns lowercase fields
    return {
      connected: data.connected || false,
      loggedIn: data.loggedIn || false,
      jid: data.jid || '',
      qrcode: data.qrcode || '',
      name: data.name || '',
      events: data.events || '',
      webhook: data.webhook || '',
    };
  } catch (error: any) {
    logger.error('Failed to get session status', {
      error: error.message,
      response: error.response?.data,
    });
    return { connected: false, loggedIn: false };
  }
}

/**
 * Get available webhook events
 * API: GET {WA_API_URL}/webhook/events?active=true
 */
export async function getWebhookEvents(): Promise<string[]> {
  try {
    if (!config.WA_ACCESS_TOKEN) {
      return ['Message'];
    }

    const url = `${config.WA_API_URL}/webhook/events?active=true`;
    
    const response = await axios.get(url, {
      headers: {
        token: config.WA_ACCESS_TOKEN,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    return data.events || ['Message'];
  } catch (error: any) {
    logger.warn('Failed to get webhook events, using default', { error: error.message });
    return ['Message'];
  }
}

/**
 * Get current webhook configuration
 * API: GET {WA_API_URL}/webhook
 */
export async function getWebhookConfig(): Promise<{ subscribe: string[]; webhook: string }> {
  try {
    if (!config.WA_ACCESS_TOKEN) {
      return { subscribe: ['Message'], webhook: '' };
    }

    const url = `${config.WA_API_URL}/webhook`;
    
    const response = await axios.get(url, {
      headers: {
        token: config.WA_ACCESS_TOKEN,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    return {
      subscribe: data.subscribe || ['Message'],
      webhook: data.webhook || '',
    };
  } catch (error: any) {
    logger.warn('Failed to get webhook config', { error: error.message });
    return { subscribe: ['Message'], webhook: '' };
  }
}

/**
 * Connect WhatsApp session
 * API: POST {WA_API_URL}/session/connect
 * Body: { Subscribe: ["Message", "ReadReceipt"], Immediate: true }
 */
export async function connectSession(): Promise<{ details: string }> {
  try {
    if (!config.WA_ACCESS_TOKEN) {
      throw new Error('WhatsApp token not configured');
    }

    const url = `${config.WA_API_URL}/session/connect`;
    
    const response = await axios.post(url, {
      Subscribe: ['Message', 'ReadReceipt'],
      Immediate: true,
    }, {
      headers: {
        token: config.WA_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const data = response.data.data || response.data;
    logger.info('WhatsApp session connected', { details: data });
    
    return {
      details: data.Details || data.details || 'Connected',
    };
  } catch (error: any) {
    logger.error('Failed to connect session', {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(error.response?.data?.error || error.response?.data?.message || error.message);
  }
}

/**
 * Disconnect WhatsApp session (keeps session data)
 */
export async function disconnectSession(): Promise<{ details: string }> {
  try {
    if (!config.WA_ACCESS_TOKEN) {
      throw new Error('WhatsApp token not configured');
    }

    const url = `${config.WA_API_URL}/session/disconnect`;
    
    const response = await axios.post(url, {}, {
      headers: {
        token: config.WA_ACCESS_TOKEN,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    logger.info('WhatsApp session disconnected', { details: data });
    
    return {
      details: data.Details || 'Disconnected',
    };
  } catch (error: any) {
    logger.error('Failed to disconnect session', {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(error.response?.data?.message || error.message);
  }
}

/**
 * Logout WhatsApp session (clears session data, requires QR rescan)
 */
export async function logoutSession(): Promise<{ details: string }> {
  try {
    if (!config.WA_ACCESS_TOKEN) {
      throw new Error('WhatsApp token not configured');
    }

    const url = `${config.WA_API_URL}/session/logout`;
    
    const response = await axios.post(url, {}, {
      headers: {
        token: config.WA_ACCESS_TOKEN,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    logger.info('WhatsApp session logged out', { details: data });
    
    return {
      details: data.Details || 'Logged out',
    };
  } catch (error: any) {
    logger.error('Failed to logout session', {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(error.response?.data?.message || error.message);
  }
}

/**
 * Get QR Code for authentication
 * API: GET {WA_API_URL}/session/qr
 * Only works when session is connected but not logged in yet
 */
export async function getQRCode(): Promise<{ QRCode: string; alreadyLoggedIn?: boolean }> {
  try {
    if (!config.WA_ACCESS_TOKEN) {
      throw new Error('WhatsApp token not configured');
    }

    const url = `${config.WA_API_URL}/session/qr`;
    
    const response = await axios.get(url, {
      headers: {
        token: config.WA_ACCESS_TOKEN,
      },
      timeout: 10000,
    });

    const data = response.data.data || response.data;
    
    return {
      QRCode: data.QRCode || '',
    };
  } catch (error: any) {
    // Handle "already logged in" case - this is not an error
    if (error.response?.data?.error === 'already logged in') {
      return {
        QRCode: '',
        alreadyLoggedIn: true,
      };
    }
    
    // Handle "no session" case
    if (error.response?.data?.error === 'no session') {
      throw new Error('Session not connected. Please connect first.');
    }
    
    logger.error('Failed to get QR code', {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(error.response?.data?.error || error.response?.data?.message || error.message);
  }
}

/**
 * Pair phone for authentication
 */
export async function pairPhone(phone: string): Promise<{ LinkingCode: string }> {
  try {
    if (!config.WA_ACCESS_TOKEN) {
      throw new Error('WhatsApp token not configured');
    }

    const url = `${config.WA_API_URL}/session/pairphone`;
    
    const response = await axios.post(url, {
      Phone: phone,
    }, {
      headers: {
        token: config.WA_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const data = response.data.data || response.data;
    logger.info('Phone pairing initiated', { phone });
    
    return {
      LinkingCode: data.LinkingCode || data.linkingCode || '',
    };
  } catch (error: any) {
    logger.error('Failed to pair phone', {
      error: error.message,
      response: error.response?.data,
    });
    throw new Error(error.response?.data?.message || error.message);
  }
}

// =====================================================
// SESSION SETTINGS FUNCTIONS
// =====================================================

interface SessionSettingsData {
  autoReadMessages: boolean;
  typingIndicator: boolean;
}

/**
 * Get session settings
 */
export async function getSessionSettings(): Promise<SessionSettingsData> {
  // Try to load from database if available
  try {
    const settings = await prisma.wa_settings.findFirst({
      where: { id: 'default' },
    });
    
    if (settings) {
      sessionSettings = {
        autoReadMessages: settings.auto_read_messages,
        typingIndicator: settings.typing_indicator,
      };
    }
  } catch (error) {
    // Table might not exist, use in-memory settings
    logger.debug('Using in-memory settings (database table may not exist)');
  }
  
  return sessionSettings;
}

/**
 * Update session settings
 */
export async function updateSessionSettings(
  updates: Partial<SessionSettingsData>
): Promise<SessionSettingsData> {
  // Update in-memory settings
  if (updates.autoReadMessages !== undefined) {
    sessionSettings.autoReadMessages = updates.autoReadMessages;
  }
  if (updates.typingIndicator !== undefined) {
    sessionSettings.typingIndicator = updates.typingIndicator;
  }
  
  // Try to persist to database
  try {
    await prisma.wa_settings.upsert({
      where: { id: 'default' },
      update: {
        auto_read_messages: sessionSettings.autoReadMessages,
        typing_indicator: sessionSettings.typingIndicator,
        updated_at: new Date(),
      },
      create: {
        id: 'default',
        auto_read_messages: sessionSettings.autoReadMessages,
        typing_indicator: sessionSettings.typingIndicator,
      },
    });
    logger.info('Session settings saved to database', sessionSettings);
  } catch (error) {
    // Table might not exist, settings will be in-memory only
    logger.warn('Failed to persist settings to database, using in-memory only');
  }
  
  return sessionSettings;
}

/**
 * Check if auto-read is enabled
 */
export function isAutoReadEnabled(): boolean {
  return sessionSettings.autoReadMessages;
}

/**
 * Check if typing indicator is enabled
 */
export function isTypingIndicatorEnabled(): boolean {
  return sessionSettings.typingIndicator;
}

/**
 * Send typing indicator (composing state)
 */
export async function sendTypingIndicator(
  phone: string,
  state: 'composing' | 'paused' = 'composing'
): Promise<boolean> {
  if (!sessionSettings.typingIndicator) {
    return false;
  }
  
  try {
    if (!config.WA_ACCESS_TOKEN) {
      return false;
    }

    const url = `${config.WA_API_URL}/chat/presence`;
    
    await axios.post(url, {
      Phone: phone,
      State: state,
      Media: '',
    }, {
      headers: {
        token: config.WA_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });

    return true;
  } catch (error: any) {
    logger.error('Failed to send typing indicator', {
      phone,
      state,
      error: error.message,
    });
    return false;
  }
}

/**
 * Mark messages as read
 * Note: Always reload settings from database to ensure we have the latest value
 */
export async function markMessageAsRead(
  messageIds: string[],
  chatPhone: string,
  senderPhone: string
): Promise<boolean> {
  // Always reload settings from database to get latest value
  // This ensures setting changes from dashboard are reflected immediately
  try {
    const settings = await prisma.wa_settings.findFirst({
      where: { id: 'default' },
    });
    
    if (settings) {
      sessionSettings.autoReadMessages = settings.auto_read_messages;
    }
  } catch (error) {
    logger.debug('Could not reload settings, using cached value');
  }
  
  if (!sessionSettings.autoReadMessages) {
    logger.debug('Auto read is disabled, skipping mark as read', { 
      chatPhone, 
      messageCount: messageIds.length,
      autoReadEnabled: sessionSettings.autoReadMessages 
    });
    return false;
  }
  
  try {
    if (!config.WA_ACCESS_TOKEN) {
      return false;
    }

    const url = `${config.WA_API_URL}/chat/markread`;
    
    await axios.post(url, {
      Id: messageIds,
      ChatPhone: chatPhone,
      SenderPhone: senderPhone,
    }, {
      headers: {
        token: config.WA_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });

    logger.info('Messages marked as read', { messageIds, chatPhone, autoReadEnabled: true });
    return true;
  } catch (error: any) {
    logger.error('Failed to mark messages as read', {
      messageIds,
      chatPhone,
      error: error.message,
    });
    return false;
  }
}

// =====================================================
// MESSAGE SENDING FUNCTIONS
// =====================================================

/**
 * Send text message via clivy-wa-support/genfity-wa API
 * 
 * API Endpoint: POST {WA_API_URL}/chat/send/text
 * Headers: token: <session_token>
 * Body: { "Phone": "628xxx", "Body": "message text" }
 */
export async function sendTextMessage(
  to: string,
  message: string
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  try {
    if (!config.WA_ACCESS_TOKEN) {
      logger.warn('WhatsApp token not configured, message not sent');
      return {
        success: false,
        error: 'WhatsApp not configured',
      };
    }

    // Normalize phone number - remove any non-digit characters and ensure starts with country code
    const normalizedPhone = normalizePhoneNumber(to);

    const url = `${config.WA_API_URL}/chat/send/text`;

    logger.debug('Sending WhatsApp message', { url, to: normalizedPhone });

    const response = await axios.post(
      url,
      {
        Phone: normalizedPhone,
        Body: message,
      },
      {
        headers: {
          token: config.WA_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 seconds timeout
      }
    );

    // genfity-wa returns { code: 200, data: { Details: "Sent", Id: "msgid", Timestamp: "..." }, success: true }
    const responseData = response.data.data || response.data;
    const messageId = responseData.Id || responseData.id;
    const isSuccess = response.data.success === true || response.data.code === 200 || responseData.Details === 'Sent';

    if (!isSuccess) {
      logger.warn('WhatsApp API returned non-success response', { 
        to: normalizedPhone,
        response: response.data
      });
      return {
        success: false,
        error: responseData.Message || responseData.message || 'Unknown error from WhatsApp API',
      };
    }

    logger.info('WhatsApp message sent', { 
      to: normalizedPhone, 
      message_id: messageId,
      details: responseData.Details 
    });

    return {
      success: true,
      message_id: messageId,
    };
  } catch (error: any) {
    logger.error('Failed to send WhatsApp message', {
      to,
      error: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });

    return {
      success: false,
      error: error.response?.data?.message || error.response?.data?.Message || error.message,
    };
  }
}

/**
 * Normalize phone number to standard format
 * - Remove non-digit characters
 * - Ensure starts with country code (62 for Indonesia)
 * - Remove @s.whatsapp.net suffix if present
 */
function normalizePhoneNumber(phone: string): string {
  // Remove @s.whatsapp.net suffix
  let normalized = phone.replace(/@s\.whatsapp\.net$/i, '');
  
  // Remove all non-digit characters
  normalized = normalized.replace(/\D/g, '');
  
  // If starts with 0, replace with 62 (Indonesia country code)
  if (normalized.startsWith('0')) {
    normalized = '62' + normalized.substring(1);
  }
  
  // If doesn't start with country code, add 62
  if (!normalized.startsWith('62') && !normalized.startsWith('+')) {
    normalized = '62' + normalized;
  }
  
  return normalized;
}

/**
 * Validate webhook signature (optional, for production)
 */
export function validateWebhookSignature(
  _signature: string,
  _body: string,
  _secret: string
): boolean {
  // TODO: Implement HMAC signature verification
  // For now, return true (skip verification in development)
  return true;
}
