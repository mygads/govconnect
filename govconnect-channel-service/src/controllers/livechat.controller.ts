import { Request, Response } from 'express';
import prisma from '../config/database';
import {
  startTakeover,
  endTakeover,
  getActiveTakeovers,
  getActiveTakeover,
  getConversations,
  getConversation,
  markConversationAsRead,
  updateConversation,
  TakeoverConflictError,
} from '../services/takeover.service';
import {
  getMessageHistory,
  markConversationMessagesAdminRead,
  publishTypingEvent,
  saveOutgoingMessage,
  replaceFailedOutgoingMessage,
} from '../services/message.service';
import { subscribeLivechatEvents } from '../services/livechat-events.service';
import {
  buildQuotedContextInfo,
  deleteWhatsAppMessage,
  markMessageAsRead,
  sendButtonsMessage,
  sendContactMessage,
  sendEditMessage,
  sendListMessage,
  sendLocationMessage,
  sendMediaMessage,
  sendPollMessage,
  sendReactionMessage,
  sendStickerMessage,
  sendTextMessage,
  sendTypingIndicator,
  WhatsAppMediaType,
} from '../services/wa.service';
import logger from '../utils/logger';
import { getParam, getQuery } from '../utils/http';
import type { MessageKind } from '../types/message.types';
import { logWaActivity } from '../services/wa-activity-log.service';

function resolveVillageId(req: Request): string | undefined {
  const queryVillageId = getQuery(req, 'village_id');
  const headerVillageId = typeof req.headers['x-village-id'] === 'string' ? req.headers['x-village-id'] : undefined;
  return queryVillageId || headerVillageId;
}

function resolveChannel(req: Request, identifier?: string): 'WHATSAPP' | 'WEBCHAT' {
  const queryChannel = (getQuery(req, 'channel') || req.body?.channel) as string | undefined;
  if (queryChannel && queryChannel.toUpperCase() === 'WEBCHAT') return 'WEBCHAT';
  if (identifier && identifier.startsWith('web_')) return 'WEBCHAT';
  return 'WHATSAPP';
}

type TypingState = 'composing' | 'paused';
type TypingActor = 'user' | 'admin' | 'ai';

const TYPING_COMPOSING_INTERVAL_MS = 1800;
const TYPING_PAUSED_DEDUPE_MS = 5000;
const typingThrottle = new Map<string, { state: TypingState; sentAt: number }>();

function typingThrottleKey(params: {
  villageId?: string;
  channel: 'WHATSAPP' | 'WEBCHAT';
  channelIdentifier: string;
  actor: TypingActor;
}) {
  return `${params.villageId || 'unknown'}:${params.channel}:${params.channelIdentifier}:${params.actor}`;
}

function shouldSendTyping(key: string, state: TypingState) {
  const now = Date.now();
  const previous = typingThrottle.get(key);
  if (previous) {
    const elapsed = now - previous.sentAt;
    if (state === 'composing' && previous.state === 'composing' && elapsed < TYPING_COMPOSING_INTERVAL_MS) {
      return false;
    }
    if (state === 'paused' && previous.state === 'paused' && elapsed < TYPING_PAUSED_DEDUPE_MS) {
      return false;
    }
  }

  typingThrottle.set(key, { state, sentAt: now });
  if (typingThrottle.size > 1000) {
    for (const [entryKey, entry] of typingThrottle.entries()) {
      if (now - entry.sentAt > 60_000) typingThrottle.delete(entryKey);
    }
  }
  return true;
}

export function handleLivechatEvents(req: Request, res: Response): void {
  const villageId = resolveVillageId(req);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('connected', { village_id: villageId, at: Date.now() });

  const unsubscribe = subscribeLivechatEvents((event) => {
    if (villageId && event.village_id && event.village_id !== villageId) return;
    send(event.type, event);
  });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

interface LivechatMediaPayload {
  type: WhatsAppMediaType;
  url: string;
  internal_url?: string;
  mime_type?: string;
  file_name?: string;
  size?: number;
  storage_key?: string;
}

function mediaLabel(media: LivechatMediaPayload): string {
  if (media.type === 'document') return media.file_name ? `[Document] ${media.file_name}` : '[Document]';
  return `[${media.type.charAt(0).toUpperCase()}${media.type.slice(1)}]`;
}

function normalizeMediaPayload(value: any): LivechatMediaPayload | null {
  if (!value || typeof value !== 'object') return null;
  const type = value.type as WhatsAppMediaType;
  if (!['image', 'audio', 'document', 'video'].includes(type)) return null;
  if (typeof value.url !== 'string' || value.url.trim().length === 0) return null;

  return {
    type,
    url: value.url.trim(),
    internal_url: typeof value.internal_url === 'string' ? value.internal_url : undefined,
    mime_type: typeof value.mime_type === 'string' ? value.mime_type : undefined,
    file_name: typeof value.file_name === 'string' ? value.file_name : undefined,
    size: typeof value.size === 'number' ? value.size : undefined,
    storage_key: typeof value.storage_key === 'string' ? value.storage_key : undefined,
  };
}

function normalizeLocationPayload(value: any) {
  if (!value || typeof value !== 'object') return null;
  const latitude = Number(value.latitude ?? value.lat);
  const longitude = Number(value.longitude ?? value.lng ?? value.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    name: typeof value.name === 'string' ? value.name.trim() : undefined,
    address: typeof value.address === 'string' ? value.address.trim() : undefined,
  };
}

function normalizeContactPayload(value: any) {
  if (!value || typeof value !== 'object') return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const phone = typeof value.phone === 'string' ? value.phone.trim() : '';
  if (!name || !phone) return null;
  return {
    name,
    phone,
    organization: typeof value.organization === 'string' ? value.organization.trim() : undefined,
    title: typeof value.title === 'string' ? value.title.trim() : undefined,
    vcard: typeof value.vcard === 'string' ? value.vcard : undefined,
  };
}

function normalizeStickerPayload(value: any) {
  if (!value || typeof value !== 'object') return null;
  const sticker = typeof value.sticker === 'string'
    ? value.sticker.trim()
    : typeof value.url === 'string'
      ? value.url.trim()
      : '';
  if (!sticker) return null;
  return {
    sticker,
    mimeType: typeof value.mime_type === 'string' ? value.mime_type.trim() : typeof value.mimeType === 'string' ? value.mimeType.trim() : undefined,
    packId: typeof value.pack_id === 'string' ? value.pack_id.trim() : typeof value.packId === 'string' ? value.packId.trim() : undefined,
    packName: typeof value.pack_name === 'string' ? value.pack_name.trim() : typeof value.packName === 'string' ? value.packName.trim() : undefined,
    packPublisher: typeof value.pack_publisher === 'string' ? value.pack_publisher.trim() : typeof value.packPublisher === 'string' ? value.packPublisher.trim() : undefined,
    emojis: Array.isArray(value.emojis) ? value.emojis.filter((emoji: unknown) => typeof emoji === 'string' && emoji.trim()).map((emoji: string) => emoji.trim()) : undefined,
  };
}

function normalizePollPayload(value: any) {
  if (!value || typeof value !== 'object') return null;
  const header = typeof value.header === 'string' ? value.header.trim() : typeof value.question === 'string' ? value.question.trim() : '';
  const options = Array.isArray(value.options)
    ? value.options.filter((option: unknown) => typeof option === 'string' && option.trim()).map((option: string) => option.trim())
    : [];
  if (!header || options.length < 2) return null;
  return { header, options };
}

function normalizeMessageActionPayload(value: any) {
  if (!value || typeof value !== 'object') return null;
  const type = value.type === 'reaction' || value.type === 'edit' || value.type === 'delete' ? value.type : null;
  const messageId = typeof value.message_id === 'string' ? value.message_id.trim() : typeof value.messageId === 'string' ? value.messageId.trim() : '';
  if (!type || !messageId) return null;
  if (type === 'reaction') {
    const emoji = typeof value.emoji === 'string' ? value.emoji.trim() : typeof value.body === 'string' ? value.body.trim() : '';
    return {
      type,
      messageId,
      emoji: emoji || 'remove',
      participant: typeof value.participant === 'string' ? value.participant.trim() : undefined,
    };
  }
  if (type === 'edit') {
    const body = typeof value.body === 'string' ? value.body.trim() : typeof value.message === 'string' ? value.message.trim() : '';
    if (!body) return null;
    return { type, messageId, body };
  }
  return { type, messageId };
}

function normalizeInteractivePayload(value: any) {
  if (!value || typeof value !== 'object') return null;
  const type = value.type === 'list' ? 'list' : value.type === 'buttons' ? 'buttons' : null;
  if (!type) return null;
  if (type === 'buttons') {
    const buttons = Array.isArray(value.buttons)
      ? value.buttons
          .map((button: any) => {
            if (!button || typeof button !== 'object') return null;
            const buttonType = typeof button.type === 'string' ? button.type.trim() : 'reply';
            const title = typeof button.title === 'string'
              ? button.title.trim()
              : typeof button.text === 'string'
                ? button.text.trim()
                : '';
            if (!title) return null;
            const normalized: Record<string, unknown> = { type: buttonType, title };
            if (typeof button.id === 'string' && button.id.trim()) normalized.id = button.id.trim();
            if (typeof button.url === 'string' && button.url.trim()) normalized.url = button.url.trim();
            if (typeof button.phone_number === 'string' && button.phone_number.trim()) normalized.phone_number = button.phone_number.trim();
            if (typeof button.copy_code === 'string' && button.copy_code.trim()) normalized.copy_code = button.copy_code.trim();
            return normalized;
          })
          .filter(Boolean)
      : [];
    const body = typeof value.body === 'string' ? value.body.trim() : '';
    if (!body || buttons.length === 0) return null;
    return {
      type,
      body,
      title: typeof value.title === 'string' ? value.title.trim() : undefined,
      footer: typeof value.footer === 'string' ? value.footer.trim() : undefined,
      image: typeof value.image === 'string' ? value.image.trim() : undefined,
      buttons,
    };
  }

  const sections = Array.isArray(value.sections)
    ? value.sections
        .map((section: any) => {
          if (!section || typeof section !== 'object') return null;
          const rows = Array.isArray(section.rows)
            ? section.rows
                .map((row: any) => {
                  if (!row || typeof row !== 'object') return null;
                  const title = typeof row.title === 'string' ? row.title.trim() : '';
                  if (!title) return null;
                  const normalized: Record<string, unknown> = { title };
                  const desc = typeof row.desc === 'string' ? row.desc.trim() : typeof row.description === 'string' ? row.description.trim() : '';
                  const rowId = typeof row.RowId === 'string'
                    ? row.RowId.trim()
                    : typeof row.rowId === 'string'
                      ? row.rowId.trim()
                      : typeof row.id === 'string'
                        ? row.id.trim()
                        : '';
                  if (desc) normalized.desc = desc;
                  if (rowId) normalized.RowId = rowId;
                  return normalized;
                })
                .filter(Boolean)
            : [];
          if (rows.length === 0) return null;
          return {
            title: typeof section.title === 'string' && section.title.trim() ? section.title.trim() : 'Menu',
            rows,
          };
        })
        .filter(Boolean)
    : [];
  const body = typeof value.body === 'string' ? value.body.trim() : '';
  const buttonText = typeof value.buttonText === 'string' ? value.buttonText.trim() : typeof value.button_text === 'string' ? value.button_text.trim() : '';
  if (!body || !buttonText || sections.length === 0) return null;
  return {
    type,
    body,
    buttonText,
    title: typeof value.title === 'string' ? value.title.trim() : undefined,
    footer: typeof value.footer === 'string' ? value.footer.trim() : undefined,
    sections,
  };
}

/**
 * Start takeover for a user
 * POST /internal/takeover/:wa_user_id
 */
export async function handleStartTakeover(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const { admin_id, admin_name, reason } = req.body;
    const enrichment = req.body?.enrichment;
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id || undefined);

    if (!wa_user_id || !admin_id) {
      res.status(400).json({ error: 'wa_user_id and admin_id are required' });
      return;
    }

    const session = await startTakeover(
      wa_user_id,
      admin_id,
      admin_name,
      reason,
      villageId,
      channel,
      typeof enrichment === 'object' && enrichment ? enrichment : undefined,
    );

    res.json({
      success: true,
      data: session,
      message: `Takeover started for ${wa_user_id}`,
    });
  } catch (error: any) {
    if (error instanceof TakeoverConflictError) {
      res.status(409).json({
        error: 'Takeover already active',
        session: error.session,
      });
      return;
    }
    logger.error('Failed to start takeover', { error: error.message });
    res.status(500).json({ error: 'Failed to start takeover' });
  }
}

/**
 * End takeover for a user
 * DELETE /internal/takeover/:wa_user_id
 */
export async function handleEndTakeover(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id || undefined);

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    const ended = await endTakeover(wa_user_id, villageId, channel);

    res.json({
      success: true,
      ended,
      message: ended ? `Takeover ended for ${wa_user_id}` : 'No active takeover found',
    });
  } catch (error: any) {
    logger.error('Failed to end takeover', { error: error.message });
    res.status(500).json({ error: 'Failed to end takeover' });
  }
}

/**
 * Get all active takeovers
 * GET /internal/takeover
 */
export async function handleGetActiveTakeovers(req: Request, res: Response): Promise<void> {
  try {
    const villageId = resolveVillageId(req);
    const sessions = await getActiveTakeovers(villageId);

    res.json({
      success: true,
      data: sessions,
      count: sessions.length,
    });
  } catch (error: any) {
    logger.error('Failed to get active takeovers', { error: error.message });
    res.status(500).json({ error: 'Failed to get active takeovers' });
  }
}

/**
 * Check if user is in takeover
 * GET /internal/takeover/:wa_user_id/status
 */
export async function handleCheckTakeover(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id || undefined);

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    const session = await getActiveTakeover(wa_user_id, villageId, channel);

    res.json({
      success: true,
      is_takeover: !!session,
      session,
    });
  } catch (error: any) {
    logger.error('Failed to check takeover status', { error: error.message });
    res.status(500).json({ error: 'Failed to check takeover status' });
  }
}

/**
 * Get conversations list for live chat
 * GET /internal/conversations
 * Query params: status=all|takeover|bot, limit=50
 */
export async function handleGetConversations(req: Request, res: Response): Promise<void> {
  try {
    const statusRaw = getQuery(req, 'status');
    const status = (statusRaw as 'all' | 'takeover' | 'bot') || 'all';
    const limitRaw = getQuery(req, 'limit');
    const offsetRaw = getQuery(req, 'offset');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    const offset = offsetRaw ? parseInt(offsetRaw, 10) : 0;
    const search = getQuery(req, 'search') || getQuery(req, 'q') || undefined;
    const villageId = resolveVillageId(req);

    const result = await getConversations(status, limit, villageId, search, offset);

    res.json({
      success: true,
      data: result.data,
      count: result.total,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get conversations', { error: error.message });
    res.status(500).json({ error: 'Failed to get conversations' });
  }
}

/**
 * Get single conversation with messages
 * GET /internal/conversations/:wa_user_id
 */
export async function handleGetConversation(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    const limitRaw = getQuery(req, 'limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id);

    const conversation = await getConversation(wa_user_id, villageId, channel);
    const messages = await getMessageHistory(wa_user_id, limit, villageId, channel);
    const takeoverSession = await getActiveTakeover(wa_user_id, villageId, channel);

    // Mark as read when admin opens conversation
    await markConversationAsRead(wa_user_id, villageId, channel);

    res.json({
      success: true,
      data: {
        conversation,
        messages, // Already sorted oldest first from getMessageHistory
        is_takeover: !!takeoverSession,
        takeover_session: takeoverSession,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get conversation', { error: error.message });
    res.status(500).json({ error: 'Failed to get conversation' });
  }
}

/**
 * Admin sends message to user
 * POST /internal/conversations/:wa_user_id/send
 *
 * Supports both WhatsApp users (628xxx) and Webchat users (web_xxx)
 * - WhatsApp: Sends via WhatsApp API
 * - Webchat: Stores in database, user polls for new messages
 */
export async function handleAdminSendMessage(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const { message, admin_id, admin_name } = req.body;
    const media = normalizeMediaPayload(req.body?.media);
    const location = normalizeLocationPayload(req.body?.location);
    const contact = normalizeContactPayload(req.body?.contact);
    const interactive = normalizeInteractivePayload(req.body?.interactive);
    const sticker = normalizeStickerPayload(req.body?.sticker);
    const poll = normalizePollPayload(req.body?.poll);
    const action = normalizeMessageActionPayload(req.body?.action);
    const replyToMessageId = typeof req.body?.reply_to_message_id === 'string' ? req.body.reply_to_message_id.trim() : undefined;
    const retryMessageId = typeof req.body?.retry_message_id === 'string' ? req.body.retry_message_id.trim() : undefined;
    const messageText = typeof message === 'string' ? message.trim() : '';
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id || undefined);

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    const hasTextOnlyPayload = !!messageText && !media && !location && !contact && !interactive && !sticker && !poll && !action;
    const primaryPayloadCount = [hasTextOnlyPayload, media, location, contact, interactive, sticker, poll, action].filter(Boolean).length;
    if (primaryPayloadCount !== 1) {
      res.status(400).json({ error: 'send exactly one of message, media, location, contact, interactive, sticker, poll, or action' });
      return;
    }

    if (req.body?.media && !media) {
      res.status(400).json({ error: 'invalid media payload' });
      return;
    }
    if (req.body?.location && !location) {
      res.status(400).json({ error: 'invalid location payload' });
      return;
    }
    if (req.body?.contact && !contact) {
      res.status(400).json({ error: 'invalid contact payload' });
      return;
    }
    if (req.body?.interactive && !interactive) {
      res.status(400).json({ error: 'invalid interactive payload' });
      return;
    }
    if (req.body?.sticker && !sticker) {
      res.status(400).json({ error: 'invalid sticker payload' });
      return;
    }
    if (req.body?.poll && !poll) {
      res.status(400).json({ error: 'invalid poll payload' });
      return;
    }
    if (req.body?.action && !action) {
      res.status(400).json({ error: 'invalid action payload' });
      return;
    }

    let retryMessage: Awaited<ReturnType<typeof prisma.message.findFirst>> = null;
    if (retryMessageId) {
      retryMessage = await prisma.message.findFirst({
        where: {
          id: retryMessageId,
          village_id: villageId || 'unknown',
          channel,
          channel_identifier: wa_user_id,
          direction: 'OUT',
          source: 'ADMIN',
          delivery_status: 'failed',
        },
      });
      if (!retryMessage) {
        res.status(404).json({ error: 'Failed message not found for retry' });
        return;
      }
    }

    const activeTakeover = await getActiveTakeover(wa_user_id, villageId, channel);
    const isTakeover = !!activeTakeover;
    if (activeTakeover && activeTakeover.admin_id !== admin_id) {
      res.status(409).json({ error: 'Conversation is handled by another admin', session: activeTakeover });
      return;
    }

    const isWebchatUser = channel === 'WEBCHAT';
    const messageKind: MessageKind = media ? 'media' : location ? 'location' : contact ? 'contact' : interactive?.type === 'buttons' ? 'buttons' : interactive?.type === 'list' ? 'list' : sticker ? 'sticker' : poll ? 'poll' : action?.type === 'reaction' ? 'reaction' : action?.type === 'edit' ? 'edit' : action?.type === 'delete' ? 'delete' : 'text';
    const persistedText = messageText ||
      (media ? mediaLabel(media) : '') ||
      (location ? `Location: ${location.name || location.address || `${location.latitude}, ${location.longitude}`}` : '') ||
      (contact ? `Contact: ${contact.name}` : '') ||
      (interactive?.type === 'buttons' ? interactive.body : '') ||
      (interactive?.type === 'list' ? interactive.body : '') ||
      (sticker ? '[Sticker]' : '') ||
      (poll ? `Poll: ${poll.header}` : '') ||
      (action?.type === 'reaction' ? `Reaction: ${action.emoji}` : '') ||
      (action?.type === 'edit' ? `Edit: ${action.body}` : '') ||
      (action?.type === 'delete' ? 'Delete message' : '');

    if (isWebchatUser) {
      if (media || location || contact || interactive || sticker || poll || action) {
        res.status(400).json({ error: 'WhatsApp native payloads are only supported for WhatsApp conversations' });
        return;
      }
      // For webchat users, just save to database
      // User will poll for new messages via webchat endpoint
      const messageId = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      await saveOutgoingMessage({
        village_id: villageId, // Required for webchat poll filtering
        wa_user_id: undefined, // Webchat users don't have wa_user_id
        channel,
        channel_identifier: wa_user_id,
        message_id: messageId,
        message_text: persistedText,
        source: 'ADMIN',
        message_kind: messageKind,
      });

      // Update conversation summary and reset unread count (admin has responded)
      await updateConversation(wa_user_id, persistedText, undefined, 'reset', villageId, channel);

      logger.info('Admin sent webchat message', {
        wa_user_id,
        admin_id,
        admin_name,
        is_takeover: isTakeover,
        message_id: messageId,
        channel: 'webchat',
      });

      res.json({
        success: true,
        message_id: messageId,
        is_takeover: isTakeover,
        channel: 'webchat',
      });
    } else {
      const quoteContext = await buildQuotedContextInfo({
        villageId,
        channel,
        channelIdentifier: wa_user_id,
        messageId: replyToMessageId,
      });

      const quotedStanzaId = typeof quoteContext.ContextInfo?.StanzaId === 'string'
        ? quoteContext.ContextInfo.StanzaId
        : typeof quoteContext.ContextInfo?.StanzaID === 'string'
          ? quoteContext.ContextInfo.StanzaID
          : undefined;
      const quotedParticipant = typeof quoteContext.ContextInfo?.Participant === 'string'
        ? quoteContext.ContextInfo.Participant
        : undefined;

      const result = media
        ? await sendMediaMessage({
            to: wa_user_id,
            mediaType: media.type,
            url: media.url,
            caption: messageText || undefined,
            fileName: media.file_name,
            mimeType: media.mime_type,
            villageId,
            ...quoteContext,
          })
        : location
          ? await sendLocationMessage({
              to: wa_user_id,
              latitude: location.latitude,
              longitude: location.longitude,
              name: location.name,
              address: location.address,
              villageId,
              ...quoteContext,
            })
          : contact
            ? await sendContactMessage(wa_user_id, contact, villageId, quoteContext)
            : interactive?.type === 'buttons'
              ? await sendButtonsMessage({
                  to: wa_user_id,
                  body: interactive.body,
                  title: interactive.title,
                  footer: interactive.footer,
                  image: interactive.image,
                  buttons: interactive.buttons,
                  villageId,
                  ...quoteContext,
                })
              : interactive?.type === 'list'
                ? await sendListMessage({
                    to: wa_user_id,
                    body: interactive.body,
                    buttonText: interactive.buttonText,
                    title: interactive.title,
                    footer: interactive.footer,
                    sections: interactive.sections,
                    villageId,
                    ...quoteContext,
                  })
                : sticker
                  ? await sendStickerMessage({
                      to: wa_user_id,
                      sticker: sticker.sticker,
                      mimeType: sticker.mimeType,
                      packId: sticker.packId,
                      packName: sticker.packName,
                      packPublisher: sticker.packPublisher,
                      emojis: sticker.emojis,
                      villageId,
                      ...quoteContext,
                    })
                  : poll
                    ? await sendPollMessage({
                        to: wa_user_id,
                        header: poll.header,
                        options: poll.options,
                        villageId,
                      })
                    : action?.type === 'reaction'
                      ? await sendReactionMessage({
                          to: wa_user_id,
                          messageId: action.messageId,
                          emoji: action.emoji,
                          participant: action.participant,
                          villageId,
                        })
                      : action?.type === 'edit'
                        ? await sendEditMessage({
                            to: wa_user_id,
                            messageId: action.messageId,
                            body: action.body,
                            villageId,
                          })
                        : action?.type === 'delete'
                          ? await deleteWhatsAppMessage({
                              to: wa_user_id,
                              messageId: action.messageId,
                              villageId,
                            })
                          : await sendTextMessage(wa_user_id, messageText, villageId, quoteContext);

      const sendResult = result as typeof result & {
        endpoint?: string;
        gateway?: string;
        provider_response?: unknown;
      };

      if (result.success) {
        // Generate message ID if not provided by WA
        const messageId = result.message_id || `admin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        let stored = true;
        try {
          if (retryMessage) {
            await replaceFailedOutgoingMessage(retryMessage.id, {
              village_id: villageId,
              wa_user_id,
              channel,
              channel_identifier: wa_user_id,
              message_id: messageId,
              message_text: persistedText,
              media_type: media?.type,
              media_url: media?.internal_url || media?.url,
              media_public_url: media?.url,
              mime_type: media?.mime_type,
              file_name: media?.file_name,
              file_size: media?.size,
              storage_key: media?.storage_key,
              source: 'ADMIN',
              delivery_status: 'sent',
              message_kind: messageKind,
              quoted_message_id: replyToMessageId,
              quoted_stanza_id: quotedStanzaId,
              quoted_participant: quotedParticipant,
              quoted_text: quoteContext.QuotedText,
              quoted_message_json: quoteContext.QuotedMessage,
              location_latitude: location?.latitude,
              location_longitude: location?.longitude,
              location_name: location?.name,
              location_address: location?.address,
              contact_name: contact?.name,
              contact_phone: contact?.phone,
              contact_vcard: contact?.vcard,
              interactive_payload: interactive || (sticker ? { type: 'sticker', ...sticker } : undefined) || (poll ? { type: 'poll', ...poll } : undefined) || action,
            });
          } else {
            await saveOutgoingMessage({
            village_id: villageId,
            wa_user_id,
            channel,
            channel_identifier: wa_user_id,
            message_id: messageId,
            message_text: persistedText,
            media_type: media?.type,
            media_url: media?.internal_url || media?.url,
            media_public_url: media?.url,
            mime_type: media?.mime_type,
            file_name: media?.file_name,
            file_size: media?.size,
            storage_key: media?.storage_key,
            source: 'ADMIN',
            delivery_status: 'sent',
            message_kind: messageKind,
            quoted_message_id: replyToMessageId,
            quoted_stanza_id: quotedStanzaId,
            quoted_participant: quotedParticipant,
            quoted_text: quoteContext.QuotedText,
            quoted_message_json: quoteContext.QuotedMessage,
            location_latitude: location?.latitude,
            location_longitude: location?.longitude,
            location_name: location?.name,
            location_address: location?.address,
            contact_name: contact?.name,
            contact_phone: contact?.phone,
            contact_vcard: contact?.vcard,
            interactive_payload: interactive || (sticker ? { type: 'sticker', ...sticker } : undefined) || (poll ? { type: 'poll', ...poll } : undefined) || action,
          });
          }

          // Update conversation summary and reset unread count (admin has responded)
          await updateConversation(wa_user_id, persistedText, undefined, 'reset', villageId, channel);
        } catch (storeError: any) {
          stored = false;
          logger.error('Admin WhatsApp message sent but failed to store locally', {
            wa_user_id,
            message_id: messageId,
            error: storeError.message,
          });
        }

        await sendTypingIndicator(wa_user_id, 'paused', villageId).catch(() => false);
        await logWaActivity({
          villageId: villageId || 'unknown',
          waUserId: wa_user_id,
          channelIdentifier: wa_user_id,
          type: 'message_send',
          severity: 'info',
          status: 'sent',
          message: `Pesan ${messageKind} admin berhasil dikirim ke WhatsApp.`,
          providerMessageId: messageId,
          metadata: {
            messageKind,
            replyToMessageId,
            retryMessageId,
            endpoint: sendResult.endpoint,
            gateway: sendResult.gateway,
          },
        });

        logger.info('Admin sent WhatsApp message', {
          wa_user_id,
          admin_id,
          admin_name,
          is_takeover: isTakeover,
          message_id: messageId,
          channel: 'whatsapp',
          has_media: !!media,
          stored,
        });

        res.json({
          success: true,
          message_id: messageId,
          is_takeover: isTakeover,
          channel: 'whatsapp',
          stored,
          retry_message_id: retryMessage?.id,
        });
      } else {
        const messageId = `admin-failed-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        await saveOutgoingMessage({
          village_id: villageId,
          wa_user_id,
          channel,
          channel_identifier: wa_user_id,
          message_id: messageId,
          message_text: persistedText,
          media_type: media?.type,
          media_url: media?.internal_url || media?.url,
          media_public_url: media?.url,
          mime_type: media?.mime_type,
          file_name: media?.file_name,
          file_size: media?.size,
          storage_key: media?.storage_key,
          source: 'ADMIN',
          delivery_status: 'failed',
          status_error: result.error || 'Failed to send message',
          message_kind: messageKind,
          quoted_message_id: replyToMessageId,
          quoted_stanza_id: quotedStanzaId,
          quoted_participant: quotedParticipant,
          quoted_text: quoteContext.QuotedText,
          quoted_message_json: quoteContext.QuotedMessage,
          location_latitude: location?.latitude,
          location_longitude: location?.longitude,
          location_name: location?.name,
          location_address: location?.address,
          contact_name: contact?.name,
          contact_phone: contact?.phone,
          contact_vcard: contact?.vcard,
          interactive_payload: interactive || (sticker ? { type: 'sticker', ...sticker } : undefined) || (poll ? { type: 'poll', ...poll } : undefined) || action,
        });

        await logWaActivity({
          villageId: villageId || 'unknown',
          waUserId: wa_user_id,
          channelIdentifier: wa_user_id,
          type: 'message_send',
          severity: 'error',
          status: 'failed',
          message: `Gagal mengirim pesan ${messageKind} admin ke WhatsApp: ${result.error || 'provider mengembalikan non-success'}`,
          providerMessageId: messageId,
          metadata: {
            messageKind,
            replyToMessageId,
            endpoint: sendResult.endpoint,
            gateway: sendResult.gateway,
            providerResponse: sendResult.provider_response,
          },
        });

        res.status(502).json({
          success: false,
          error: result.error || 'Failed to send message',
          message_id: messageId,
        });
      }
    }
  } catch (error: any) {
    logger.error('Failed to send admin message', { error: error.message });
    res.status(500).json({ error: 'Failed to send message' });
  }
}

export async function handleConversationTyping(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id || undefined);
    const state: TypingState = req.body?.state === 'paused' ? 'paused' : 'composing';
    const actor: TypingActor = req.body?.actor === 'ai' ? 'ai' : req.body?.actor === 'user' ? 'user' : 'admin';

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    const throttleKey = typingThrottleKey({ villageId, channel, channelIdentifier: wa_user_id, actor });
    const shouldSend = shouldSendTyping(throttleKey, state);
    if (!shouldSend) {
      res.json({ success: true, state, provider_sent: false, throttled: true });
      return;
    }

    let provider_sent = false;
    if (channel === 'WHATSAPP') {
      provider_sent = await sendTypingIndicator(wa_user_id, state, villageId);
    }

    publishTypingEvent({
      village_id: villageId,
      channel,
      channel_identifier: wa_user_id,
      typing_state: state,
      actor,
    });

    res.json({ success: true, state, provider_sent, throttled: false });
  } catch (error: any) {
    logger.error('Failed to send typing indicator', { error: error.message });
    res.status(500).json({ error: 'Failed to send typing indicator' });
  }
}

/**
 * Mark conversation as read
 * POST /internal/conversations/:wa_user_id/read
 */
export async function handleMarkAsRead(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id);

    await markConversationAsRead(wa_user_id, villageId, channel);
    const messageIds = await markConversationMessagesAdminRead(wa_user_id, villageId, channel);
    let provider_marked = false;
    if (channel === 'WHATSAPP' && messageIds.length > 0) {
      provider_marked = await markMessageAsRead(messageIds, wa_user_id, wa_user_id, villageId);
    }

    res.json({
      success: true,
      message: 'Conversation marked as read',
      marked_count: messageIds.length,
      provider_marked,
    });
  } catch (error: any) {
    logger.error('Failed to mark as read', { error: error.message });
    res.status(500).json({ error: 'Failed to mark as read' });
  }
}

/**
 * Delete conversation and all messages for a user
 * DELETE /internal/conversations/:wa_user_id
 */
export async function handleDeleteConversation(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const villageId = resolveVillageId(req);
    const channel = resolveChannel(req, wa_user_id || undefined);

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    // Import prisma for direct database operations
    const { deleteConversationHistory } = await import('../services/takeover.service');

    await deleteConversationHistory(wa_user_id, villageId, channel);

    // Clear AI user profile/caches so name is forgotten (fresh session)
    try {
      const { config } = await import('../config/env');
      await fetch(`${config.AI_SERVICE_URL}/admin/cache/clear-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: wa_user_id }),
      });
      logger.info('AI cache cleared for user', { wa_user_id });
    } catch (aiErr: any) {
      // Non-blocking — conversation is already deleted
      logger.warn('Failed to clear AI cache for user', { wa_user_id, error: aiErr.message });
    }

    logger.info('Conversation deleted', { wa_user_id });

    res.json({
      success: true,
      message: 'Conversation and message history deleted',
    });
  } catch (error: any) {
    logger.error('Failed to delete conversation', { error: error.message });
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
}

/**
 * Retry AI processing for a failed message
 * POST /internal/conversations/:wa_user_id/retry
 */
export async function handleRetryAI(req: Request, res: Response): Promise<void> {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const channel = resolveChannel(req, wa_user_id || undefined);
    const villageId = resolveVillageId(req);

    if (!wa_user_id) {
      res.status(400).json({ error: 'wa_user_id is required' });
      return;
    }

    const { getPendingMessage, setAIProcessing } = await import('../services/takeover.service');
    const { publishEvent } = await import('../services/rabbitmq.service');
    const { rabbitmqConfig } = await import('../config/rabbitmq');

    // Get the pending message that failed — pass village_id for correct lookup
    const pendingMessage = await getPendingMessage(wa_user_id, channel, villageId);

    if (!pendingMessage) {
      res.status(404).json({ error: 'No pending message found for retry' });
      return;
    }

    // Set AI processing status again — use the village_id from the message
    await setAIProcessing(wa_user_id, pendingMessage.message_id, pendingMessage.village_id, channel);

    // Re-publish the message to AI service queue with correct village_id
    await publishEvent(rabbitmqConfig.ROUTING_KEYS.MESSAGE_RECEIVED, {
      wa_user_id,
      village_id: pendingMessage.village_id,
      message: pendingMessage.message_text,
      message_id: pendingMessage.message_id,
      is_retry: true,
      channel: channel.toLowerCase(),
    });

    logger.info('AI retry requested', { wa_user_id, message_id: pendingMessage.message_id, village_id: pendingMessage.village_id });

    res.json({
      success: true,
      message: 'AI processing retry initiated',
    });
  } catch (error: any) {
    logger.error('Failed to retry AI', { error: error.message });
    res.status(500).json({ error: 'Failed to retry AI processing' });
  }
}
