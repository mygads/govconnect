import { Request, Response } from 'express';
import {
  saveIncomingMessage,
  checkDuplicateMessage,
} from '../services/message.service';
// markMessageAsRead is now called by AI service when processing starts
// Group message filtering improved - v3
import { processMediaFromWebhook, MediaInfo } from '../services/media.service';
import { updateConversation, isUserInTakeover, setAIProcessing } from '../services/takeover.service';
import { addPendingMessage } from '../services/pending-message.service';
import { addMessageToBatch, cancelBatch } from '../services/message-batcher.service';
import logger from '../utils/logger';
import { 
  GenfityWebhookPayload,
} from '../types/webhook.types';

/**
 * Handle WhatsApp webhook from genfity-wa
 * POST /webhook/whatsapp
 * 
 * genfity-wa sends webhooks in two formats:
 * 1. JSON mode: Content-Type: application/json
 * 2. Form mode: Content-Type: application/x-www-form-urlencoded
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  try {
    let payload: GenfityWebhookPayload;
    
    // Handle both JSON and form-urlencoded formats
    if (req.body.jsonData) {
      // Form mode: parse jsonData field
      try {
        payload = JSON.parse(req.body.jsonData);
      } catch (e) {
        logger.warn('Failed to parse jsonData field', { error: e });
        res.json({ status: 'ok', message: 'Invalid jsonData' });
        return;
      }
    } else {
      // JSON mode: use body directly
      payload = req.body;
    }

    // Debug: Log full payload structure
    logger.debug('Webhook received', { 
      type: payload.type, 
      hasEvent: !!payload.event,
      eventKeys: payload.event ? Object.keys(payload.event) : [],
      fullPayload: JSON.stringify(payload).substring(0, 2000) // First 2000 chars
    });
    
    // Extra detailed debug
    if (payload.event) {
      logger.debug('Event details', {
        hasInfo: !!payload.event.Info,
        hasMessage: !!payload.event.Message,
        infoKeys: payload.event.Info ? Object.keys(payload.event.Info) : [],
        messageKeys: payload.event.Message ? Object.keys(payload.event.Message) : [],
        messageContent: payload.event.Message ? JSON.stringify(payload.event.Message).substring(0, 500) : 'null'
      });
    }

    // Only process "Message" type events (incoming messages)
    if (payload.type !== 'Message') {
      // Skip status notifications, receipts, etc. silently
      logger.debug('Non-message webhook received, ignoring', { type: payload.type });
      res.json({ status: 'ok', message: `Ignored event type: ${payload.type}` });
      return;
    }

    // ============================================
    // FILTER: Only process PRIVATE messages
    // Skip group messages, broadcasts, and status updates
    // ============================================
    const chatJid = payload.event?.Info?.Chat || '';
    const isGroup = payload.event?.Info?.IsGroup || false;
    
    // Check IsGroup flag first (most reliable)
    if (isGroup) {
      logger.info('Skipping group message (IsGroup=true)', { 
        chat: chatJid,
        type: 'group'
      });
      res.json({ status: 'ok', message: 'Group message ignored' });
      return;
    }
    
    // Group messages end with @g.us OR contain @g.us (safety check)
    if (chatJid.endsWith('@g.us') || chatJid.includes('@g.us')) {
      logger.info('Skipping group message (@g.us detected)', { 
        chat: chatJid,
        type: 'group'
      });
      res.json({ status: 'ok', message: 'Group message ignored' });
      return;
    }
    
    // Broadcast messages end with @broadcast
    if (chatJid.endsWith('@broadcast')) {
      logger.debug('Skipping broadcast message', { 
        chat: chatJid,
        type: 'broadcast'
      });
      res.json({ status: 'ok', message: 'Broadcast message ignored' });
      return;
    }
    
    // Status updates have chat like "status@broadcast"
    if (chatJid.includes('status@') || chatJid === 'status@broadcast') {
      logger.debug('Skipping status update', { 
        chat: chatJid,
        type: 'status'
      });
      res.json({ status: 'ok', message: 'Status update ignored' });
      return;
    }

    // Parse genfity-wa webhook payload
    const { message, from, messageId, timestamp } = parseGenfityPayload(payload);

    logger.debug('Parsed payload result', { message, from, messageId, timestamp });

    if (!message || !from || !messageId) {
      logger.warn('No valid message in webhook payload', {
        hasMessage: !!message,
        hasFrom: !!from,
        hasMessageId: !!messageId,
      });
      res.json({ status: 'ok', message: 'No message to process' });
      return;
    }

    // Check if message is from the bot itself (IsFromMe)
    if (payload.event?.Info.IsFromMe) {
      logger.info('Skipping own message', { message_id: messageId });
      res.json({ status: 'ok', message: 'Own message skipped' });
      return;
    }

    // Check duplicate
    const isDuplicate = await checkDuplicateMessage(messageId);
    if (isDuplicate) {
      logger.warn('Duplicate message', { message_id: messageId });
      res.json({ status: 'ok', message: 'Duplicate message' });
      return;
    }

    // Extract phone number from JID (remove @s.whatsapp.net)
    const waUserId = extractPhoneFromJID(from);

    // Final safety check: Ensure waUserId doesn't look like a group ID
    // Group IDs are typically longer (18+ digits) vs phone numbers (10-15 digits)
    if (waUserId.length > 16 || !/^[\d]+$/.test(waUserId)) {
      logger.warn('Suspicious wa_user_id detected, may be group or invalid', {
        original_jid: from,
        extracted_id: waUserId,
        length: waUserId.length,
      });
      res.json({ status: 'ok', message: 'Invalid user ID format' });
      return;
    }

    // ============================================
    // STEP 1: DON'T READ MESSAGE YET
    // ============================================
    // Message will be marked as read when AI starts processing
    // This gives user feedback that their message is being worked on

    // ============================================
    // STEP 2: SAVE TO DATABASE (parallel with media processing)
    // ============================================
    
    // Process media if present (non-blocking)
    let mediaInfo: MediaInfo = { hasMedia: false };
    const mediaPromise = processMediaFromWebhook(payload, waUserId, messageId)
      .then(info => {
        mediaInfo = info;
        if (info.hasMedia) {
          logger.info('Media processed', {
            wa_user_id: waUserId,
            message_id: messageId,
            mediaType: info.mediaType,
            hasUrl: !!info.mediaUrl,
          });
        }
      })
      .catch((err) => {
        logger.warn('Failed to process media, continuing without it', {
          error: err.message,
          message_id: messageId,
        });
      });

    // Save message to database
    await saveIncomingMessage({
      wa_user_id: waUserId,
      message_id: messageId,
      message_text: message,
      timestamp: timestamp,
    });

    // Update conversation for live chat
    const pushName = payload.event?.Info.PushName || undefined;
    await updateConversation(waUserId, message, pushName, true);

    // Wait for media processing to complete
    await mediaPromise;

    // ============================================
    // STEP 3: CHECK TAKEOVER STATUS
    // ============================================
    const inTakeover = await isUserInTakeover(waUserId);
    
    if (inTakeover) {
      // User is being handled by admin - don't process with AI
      // Cancel any pending batch for this user
      cancelBatch(waUserId);
      
      logger.info('User in takeover mode, skipping AI processing', {
        wa_user_id: waUserId,
        message_id: messageId,
      });
      res.json({ status: 'ok', message_id: messageId, mode: 'takeover' });
      return;
    }

    // ============================================
    // STEP 4: BATCH MESSAGES FOR AI PROCESSING
    // ============================================
    // Add to pending queue (for retry if needed)
    await addPendingMessage({
      wa_user_id: waUserId,
      message_id: messageId,
      message_text: message,
    });

    // Set AI status to queued
    await setAIProcessing(waUserId, messageId);

    // Add to message batcher
    // The batcher will wait for more messages before sending to AI
    // This prevents spam and combines multiple messages into one AI request
    const { isNewBatch, batchSize } = addMessageToBatch(
      waUserId,
      messageId,
      message,
      timestamp.toISOString(),
      {
        has_media: mediaInfo.hasMedia,
        media_type: mediaInfo.mediaType,
        media_url: mediaInfo.mediaUrl,
        media_public_url: mediaInfo.mediaPublicUrl,
      }
    );
    
    logger.info('Message added to batch for AI processing', {
      wa_user_id: waUserId,
      message_id: messageId,
      is_new_batch: isNewBatch,
      batch_size: batchSize,
    });

    logger.info('Webhook processed successfully', {
      from: waUserId,
      message_id: messageId,
      has_media: mediaInfo.hasMedia,
    });

    res.json({ status: 'ok', message_id: messageId });
  } catch (error: any) {
    logger.error('Webhook handler error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Parse genfity-wa webhook payload to extract message details
 * 
 * Example payload from genfity-wa:
 * {
 *   "type": "Message",
 *   "event": {
 *     "Info": {
 *       "Sender": "6281233784490:24@s.whatsapp.net",
 *       "Chat": "6281233784490@s.whatsapp.net",
 *       "Type": "text",
 *       "ID": "3FF8AEEAF9BA3B25E4DE",
 *       "PushName": "M. Yoga",
 *       "Timestamp": "2025-11-12T13:07:43+07:00"
 *     },
 *     "Message": {
 *       "extendedTextMessage": { "text": "Hello" },
 *       "conversation": "Hello" // alternative
 *     }
 *   }
 * }
 */
function parseGenfityPayload(payload: GenfityWebhookPayload): {
  message: string | null;
  from: string | null;
  messageId: string | null;
  timestamp: Date;
  senderPhone: string | null;
  chatPhone: string | null;
} {
  try {
    const event = payload.event;
    if (!event) {
      logger.debug('No event in payload');
      return { message: null, from: null, messageId: null, timestamp: new Date(), senderPhone: null, chatPhone: null };
    }

    // Handle both "Info" (from genfity-wa) formats
    const info = event.Info;
    if (!info) {
      logger.debug('No Info in event');
      return { message: null, from: null, messageId: null, timestamp: new Date(), senderPhone: null, chatPhone: null };
    }

    // Extract sender JID - Chat field contains the conversation JID
    const from = info.Chat; // e.g., "628123456789@s.whatsapp.net"
    
    // Extract sender and chat phone for auto-read feature
    // Sender is an object: { User: "6281233784490", Server: "s.whatsapp.net", AD?: boolean }
    // Chat format: "6281233784490@s.whatsapp.net"
    const senderPhone = info.Sender?.User || null;
    const chatPhone = info.Chat ? info.Chat.split('@')[0] : null;

    // Extract message ID
    const messageId = info.ID;

    // Extract timestamp - genfity-wa uses ISO format
    let timestamp: Date;
    if (info.Timestamp) {
      timestamp = new Date(info.Timestamp);
    } else {
      timestamp = new Date();
    }

    // Check if message is from bot itself
    // In genfity-wa, Sender contains the actual sender JID
    // If sender equals our JID (IsFromMe), skip it
    // Note: This is handled by IsFromMe check in handleWebhook

    // Extract message text from the Message object
    const msg = event.Message;
    let messageText: string | null = null;

    if (msg) {
      // genfity-wa uses camelCase for message fields
      // Check various message types (camelCase from genfity-wa)
      
      // Text messages
      if (typeof msg === 'object') {
        const msgObj = msg as Record<string, any>;
        
        // Priority 1: conversation (simple text)
        if (msgObj.conversation) {
          messageText = msgObj.conversation;
        }
        // Priority 2: extendedTextMessage (text with formatting/reply)
        else if (msgObj.extendedTextMessage?.text) {
          messageText = msgObj.extendedTextMessage.text;
        }
        // Priority 3: PascalCase variants (backward compatibility)
        else if (msgObj.Conversation) {
          messageText = msgObj.Conversation;
        }
        else if (msgObj.ExtendedTextMessage?.Text) {
          messageText = msgObj.ExtendedTextMessage.Text;
        }
        // Media with captions
        else if (msgObj.imageMessage?.caption) {
          messageText = msgObj.imageMessage.caption;
        }
        else if (msgObj.videoMessage?.caption) {
          messageText = msgObj.videoMessage.caption;
        }
        else if (msgObj.documentMessage?.caption) {
          messageText = msgObj.documentMessage.caption;
        }
        // PascalCase media captions
        else if (msgObj.ImageMessage?.Caption) {
          messageText = msgObj.ImageMessage.Caption;
        }
        else if (msgObj.VideoMessage?.Caption) {
          messageText = msgObj.VideoMessage.Caption;
        }
        else if (msgObj.DocumentMessage?.Caption) {
          messageText = msgObj.DocumentMessage.Caption;
        }
        // Location
        else if (msgObj.locationMessage) {
          messageText = `📍 Location: ${msgObj.locationMessage.name || 'Shared location'}`;
        }
        else if (msgObj.LocationMessage) {
          messageText = `📍 Location: ${msgObj.LocationMessage.Name || 'Shared location'}`;
        }
        // Contact
        else if (msgObj.contactMessage) {
          messageText = `👤 Contact: ${msgObj.contactMessage.displayName}`;
        }
        else if (msgObj.ContactMessage) {
          messageText = `👤 Contact: ${msgObj.ContactMessage.DisplayName}`;
        }
      }
    }

    logger.debug('Parsed message details', {
      from,
      messageId,
      messageText: messageText?.substring(0, 50),
      timestamp: timestamp.toISOString(),
      senderPhone,
      chatPhone,
    });

    return {
      message: messageText,
      from,
      messageId,
      timestamp,
      senderPhone,
      chatPhone,
    };
  } catch (error: any) {
    logger.error('Error parsing webhook payload', { error: error.message });
    return { message: null, from: null, messageId: null, timestamp: new Date(), senderPhone: null, chatPhone: null };
  }
}

/**
 * Extract phone number from WhatsApp JID
 * e.g., "628123456789@s.whatsapp.net" -> "628123456789"
 */
function extractPhoneFromJID(jid: string): string {
  // Remove all known WhatsApp JID suffixes
  return jid
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@c\.us$/i, '')
    .replace(/@g\.us$/i, '') // Group JID (should be filtered before reaching here)
    .replace(/@broadcast$/i, ''); // Broadcast JID
}

/**
 * Webhook verification (for WhatsApp Cloud API setup - kept for compatibility)
 * GET /webhook/whatsapp
 * 
 * If WA_WEBHOOK_VERIFY_TOKEN is not set, accept any verification request.
 * This allows simpler webhook setup without verify token.
 */
export function verifyWebhook(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN;

  // If no verify token is configured, accept any subscription request
  if (!verifyToken || verifyToken === '') {
    if (mode === 'subscribe' && challenge) {
      logger.info('Webhook verified (no token required)');
      res.send(challenge);
      return;
    }
    // No challenge but valid request - just accept
    logger.info('Webhook ping accepted (no token required)');
    res.send('OK');
    return;
  }

  // Verify token is configured - validate it
  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Webhook verified successfully');
    res.send(challenge);
    return;
  }

  logger.warn('Webhook verification failed', { mode, token });
  res.sendStatus(403);
}
