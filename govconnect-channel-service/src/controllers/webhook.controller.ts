import { Request, Response } from 'express';
import {
  saveIncomingMessage,
  saveOutgoingMessage,
  checkDuplicateMessage,
  applyMessageReaction,
  updateMessageMedia,
  updateMessageDeliveryStatus,
  publishTypingEvent,
} from '../services/message.service';
// markMessageAsRead is now called by AI service when processing starts
// Group message filtering improved - v3
import { processMediaFromWebhook, MediaInfo } from '../services/media.service';
import { updateConversation, isUserInTakeover, setAIProcessing } from '../services/takeover.service';
import { addPendingMessage } from '../services/pending-message.service';
import { publishLivechatEvent } from '../services/livechat-events.service';
import { addMessageToBatch, cancelBatch } from '../services/message-batcher.service';
import { checkSpamGuard } from '../services/spam-guard.service';
import { getStoredSession, resolveVillageIdFromInstanceName, updateStoredSessionStatus } from '../services/wa.service';
import { logWaActivity } from '../services/wa-activity-log.service';
import { enrichConversationProfile } from '../services/wa-profile.service';
import logger from '../utils/logger';
import prisma from '../config/database';
import { config } from '../config/env';
import { getQuery } from '../utils/http';
import { parseWebhookBody, webhookCandidateFromBody } from '../utils/webhook-payload';
import {
  GenfityWebhookPayload,
} from '../types/webhook.types';
import type { MessageKind } from '../types/message.types';

function cleanJidPhone(value?: string | null): string | null {
  if (!value) return null;
  return value.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') || null;
}

function eventTimestamp(payload: GenfityWebhookPayload): Date {
  const raw = payload.event?.Info?.Timestamp || (payload.event as any)?.Timestamp || (payload as any).timestamp;
  const parsed = raw ? new Date(raw) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function notifyNotificationServiceDeliveryStatus(params: {
  messageId: string;
  deliveryStatus: 'sent' | 'delivered' | 'read' | 'failed';
  occurredAt: Date;
  providerStatus?: string;
  providerError?: string;
}) {
  try {
    await fetch(`${config.NOTIFICATION_SERVICE_URL.replace(/\/$/, '')}/internal/delivery-status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-api-key': config.INTERNAL_API_KEY,
      },
      body: JSON.stringify({
        message_id: params.messageId,
        delivery_status: params.deliveryStatus,
        occurred_at: params.occurredAt.toISOString(),
        provider_status: params.providerStatus || params.deliveryStatus,
        provider_error: params.providerError || null,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error: any) {
    logger.warn('Failed to notify notification-service delivery status', {
      message_id: params.messageId,
      delivery_status: params.deliveryStatus,
      error: error.message,
    });
  }
}

function resolveWebhookMessageId(payload: GenfityWebhookPayload): string | null {
  const event: any = payload.event || {};
  const info: any = event.Info || {};
  const messageIds = event.MessageIDs || event.MessageIds || event.messageIDs || event.messageIds || (payload as any).messageIDs || (payload as any).messageIds;
  return info.ID || info.MessageID || info.MessageId || event.ID || event.MessageID || event.MessageId || (Array.isArray(messageIds) ? messageIds[0] : null) || (payload as any).message_id || null;
}

function resolvePresenceIdentifier(payload: GenfityWebhookPayload): string | null {
  const event: any = payload.event || {};
  const info: any = event.Info || {};
  return cleanJidPhone(info.Chat || info.SenderAlt || info.Sender || event.Chat || event.From || (payload as any).phone);
}

function resolveWebhookContactIdentifier(payload: GenfityWebhookPayload): string | null {
  const event: any = payload.event || {};
  const info: any = event.Info || {};
  return cleanJidPhone(
    info.Chat ||
    info.SenderAlt ||
    info.Sender ||
    event.Chat ||
    event.JID ||
    event.Jid ||
    event.Phone ||
    event.phone ||
    (payload as any).phone,
  );
}

function resolveWebhookPushName(payload: GenfityWebhookPayload): string | null {
  const event: any = payload.event || {};
  const info: any = event.Info || {};
  const value = info.PushName || event.PushName || event.pushName || event.Name || event.name || (payload as any).pushName;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveWebhookError(payload: GenfityWebhookPayload): string | null {
  const event: any = payload.event || {};
  const error = event.Error || event.error || event.Reason || event.reason || (payload as any).error || (payload as any).reason;
  if (!error) return null;
  return typeof error === 'string' ? error : JSON.stringify(error).slice(0, 500);
}

function resolveProviderEventPayload(payload: GenfityWebhookPayload): any {
  const event: any = payload.event || {};
  return event.Message || event.message || event.Data || event.data || event;
}

function compactSystemActivityIdPart(value?: string | null): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return 'unknown';
  return normalized.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'unknown';
}

function buildSystemActivityMessageId(namespace: string, providerMessageId?: string | null, targetMessageId?: string | null): string {
  return [
    'system',
    compactSystemActivityIdPart(namespace),
    compactSystemActivityIdPart(providerMessageId),
    targetMessageId ? compactSystemActivityIdPart(targetMessageId) : null,
  ].filter(Boolean).join('-');
}

async function saveLivechatSystemActivity(params: {
  villageId: string;
  channelIdentifier: string;
  messageId: string;
  messageText: string;
  timestamp: Date;
  status: string;
  providerEvent: string;
  metadata?: unknown;
}): Promise<void> {
  if (await checkDuplicateMessage(params.messageId)) return;

  await saveOutgoingMessage({
    village_id: params.villageId,
    wa_user_id: params.channelIdentifier,
    channel: 'WHATSAPP',
    channel_identifier: params.channelIdentifier,
    message_id: params.messageId,
    message_text: params.messageText,
    source: 'SYSTEM',
    delivery_status: 'received',
    message_kind: 'system',
    interactive_payload: {
      type: 'system_activity',
      status: params.status,
      providerEvent: params.providerEvent,
      metadata: params.metadata || null,
    },
    timestamp: params.timestamp,
  }).catch((error: any) => {
    logger.warn('Failed to save livechat system activity', {
      village_id: params.villageId,
      channel_identifier: params.channelIdentifier,
      message_id: params.messageId,
      error: error.message,
    });
  });
}

function pickObject(value: any, ...keys: string[]): any {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (value[key] && typeof value[key] === 'object') return value[key];
  }
  return null;
}

function pickValue(value: any, ...keys: string[]): any {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  return undefined;
}

function firstString(...values: any[]): string | null {
  const found = values.find(value => typeof value === 'string' && value.trim());
  return found ? found.trim() : null;
}

function extractInteractiveResponseText(response: any): string | null {
  const direct = pickValue(
    response,
    'selectedDisplayText',
    'SelectedDisplayText',
    'selectedButtonID',
    'selectedButtonId',
    'SelectedButtonID',
    'SelectedButtonId',
    'selectedRowID',
    'selectedRowId',
    'SelectedRowID',
    'SelectedRowId',
    'title',
    'Title',
    'displayText',
    'DisplayText',
  );
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const nested = pickObject(response, 'Response', 'response', 'singleSelectReply', 'SingleSelectReply', 'nativeFlowResponseMessage', 'NativeFlowResponseMessage');
  if (nested && nested !== response) return extractInteractiveResponseText(nested);

  const params = pickValue(response, 'paramsJson', 'ParamsJson', 'buttonParamsJSON', 'ButtonParamsJSON');
  if (typeof params === 'string') {
    try {
      const parsed = JSON.parse(params);
      return firstString(parsed.display_text, parsed.displayText, parsed.title, parsed.id);
    } catch {
      return null;
    }
  }

  return null;
}

function formatMediaOnlyMessage(params: {
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  fileName?: string | null;
  mimeType?: string | null;
  isVoiceNote?: boolean;
}): string {
  const fileNameSuffix = params.fileName ? ` ${params.fileName}` : '';

  switch (params.type) {
    case 'image':
      return `[Image] Gambar${fileNameSuffix}`;
    case 'video':
      return `[Video] Video${fileNameSuffix}`;
    case 'audio':
      return params.isVoiceNote ? '[Audio] Pesan suara' : `[Audio] Audio${fileNameSuffix}`;
    case 'document':
      return params.fileName ? `[Document] ${params.fileName}` : '[Document] Dokumen';
    case 'sticker':
      return '[Sticker] Stiker';
    default:
      return '[Media]';
  }
}

function extractTextFromMessageObject(message: any): string | null {
  if (!message || typeof message !== 'object') return null;
  return (
    pickValue(message, 'conversation', 'Conversation') ||
    pickValue(pickObject(message, 'extendedTextMessage', 'ExtendedTextMessage'), 'text', 'Text') ||
    pickValue(pickObject(message, 'imageMessage', 'ImageMessage'), 'caption', 'Caption') ||
    pickValue(pickObject(message, 'videoMessage', 'VideoMessage'), 'caption', 'Caption') ||
    pickValue(pickObject(message, 'documentMessage', 'DocumentMessage'), 'caption', 'Caption') ||
    extractInteractiveResponseText(pickObject(message, 'buttonsResponseMessage', 'ButtonsResponseMessage', 'templateButtonReplyMessage', 'TemplateButtonReplyMessage')) ||
    extractInteractiveResponseText(pickObject(message, 'listResponseMessage', 'ListResponseMessage')) ||
    extractInteractiveResponseText(pickObject(message, 'interactiveResponseMessage', 'InteractiveResponseMessage')) ||
    null
  );
}

function normalizeMessageKind(message: any, info: any): MessageKind {
  const type = String(info?.Type || info?.MessageType || '').toLowerCase();
  if (pickObject(message, 'reactionMessage', 'ReactionMessage')) return 'reaction';
  if (pickObject(message, 'editedMessage', 'EditedMessage') || pickObject(pickObject(message, 'protocolMessage', 'ProtocolMessage'), 'editedMessage', 'EditedMessage')) return 'edit';
  if (pickObject(message, 'protocolMessage', 'ProtocolMessage') && type.includes('revok')) return 'delete';
  if (pickObject(message, 'locationMessage', 'LocationMessage') || type.includes('location')) return 'location';
  if (pickObject(message, 'contactMessage', 'ContactMessage') || type.includes('contact')) return 'contact';
  if (pickObject(message, 'buttonsResponseMessage', 'ButtonsResponseMessage', 'buttonsMessage', 'ButtonsMessage')) return 'buttons';
  if (pickObject(message, 'listResponseMessage', 'ListResponseMessage', 'listMessage', 'ListMessage')) return 'list';
  if (pickObject(message, 'imageMessage', 'ImageMessage', 'videoMessage', 'VideoMessage', 'audioMessage', 'AudioMessage', 'documentMessage', 'DocumentMessage', 'stickerMessage', 'StickerMessage')) return 'media';
  return 'text';
}

function normalizeNumber(value: any): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeWaMetadata(payload: GenfityWebhookPayload) {
  const event: any = payload.event || {};
  const info: any = event.Info || {};
  const message: any = event.Message || {};
  const extendedText = pickObject(message, 'extendedTextMessage', 'ExtendedTextMessage');
  const contextInfo = pickValue(extendedText, 'contextInfo', 'ContextInfo') || pickValue(message, 'contextInfo', 'ContextInfo') || null;
  const quotedMessage = contextInfo ? pickValue(contextInfo, 'quotedMessage', 'QuotedMessage') : null;
  const location = pickObject(message, 'locationMessage', 'LocationMessage');
  const contact = pickObject(message, 'contactMessage', 'ContactMessage');
  const buttons = pickObject(message, 'buttonsResponseMessage', 'ButtonsResponseMessage', 'buttonsMessage', 'ButtonsMessage');
  const list = pickObject(message, 'listResponseMessage', 'ListResponseMessage', 'listMessage', 'ListMessage');
  const messageKind = normalizeMessageKind(message, info);
  const quotedText = quotedMessage ? extractTextFromMessageObject(quotedMessage) : null;

  return {
    wa_chat_jid: typeof info.Chat === 'string' ? info.Chat : null,
    wa_sender_jid: typeof info.Sender === 'string' ? info.Sender : typeof info.SenderAlt === 'string' ? info.SenderAlt : null,
    wa_sender_phone: cleanJidPhone(typeof info.Sender === 'string' ? info.Sender : info.Sender?.User || info.SenderAlt),
    wa_chat_phone: cleanJidPhone(info.Chat || info.SenderAlt),
    wa_message_type: info.Type || info.MessageType || null,
    wa_context_info: contextInfo,
    wa_raw_info: info,
    wa_raw_message: message,
    quoted_message_id: pickValue(contextInfo, 'stanzaId', 'StanzaId', 'StanzaID') || null,
    quoted_stanza_id: pickValue(contextInfo, 'stanzaId', 'StanzaId', 'StanzaID') || null,
    quoted_participant: pickValue(contextInfo, 'participant', 'Participant') || null,
    quoted_text: quotedText,
    quoted_message_json: quotedMessage,
    message_kind: messageKind,
    location_latitude: location ? normalizeNumber(pickValue(location, 'degreesLatitude', 'DegreesLatitude', 'latitude', 'Latitude')) : null,
    location_longitude: location ? normalizeNumber(pickValue(location, 'degreesLongitude', 'DegreesLongitude', 'longitude', 'Longitude')) : null,
    location_name: location ? pickValue(location, 'name', 'Name') || null : null,
    location_address: location ? pickValue(location, 'address', 'Address', 'jpegThumbnailCaption') || null : null,
    contact_name: contact ? pickValue(contact, 'displayName', 'DisplayName') || null : null,
    contact_phone: contact ? cleanJidPhone(pickValue(contact, 'phoneNumber', 'PhoneNumber', 'displayName', 'DisplayName')) : null,
    contact_vcard: contact ? pickValue(contact, 'vcard', 'Vcard') || null : null,
    interactive_payload: buttons || list || null,
  };
}

function resolveMessageActionActivity(payload: GenfityWebhookPayload): {
  kind: MessageKind;
  status: string;
  text: string;
  targetMessageId?: string | null;
  metadata: unknown;
} | null {
  const message = resolveProviderEventPayload(payload);
  const reaction = pickObject(message, 'reactionMessage', 'ReactionMessage');
  if (reaction) {
    const emoji = pickValue(reaction, 'text', 'Text') || 'hapus reaction';
    const key = pickValue(reaction, 'key', 'Key') || {};
    return {
      kind: 'reaction',
      status: 'reaction_received',
      text: `Reaction WhatsApp diterima: ${emoji}.`,
      targetMessageId: pickValue(key, 'id', 'ID', 'Id') || null,
      metadata: { emoji, key },
    };
  }

  const protocol = pickObject(message, 'protocolMessage', 'ProtocolMessage');
  if (protocol) {
    const editedMessage = pickObject(protocol, 'editedMessage', 'EditedMessage');
    if (editedMessage) {
      const editedText = extractTextFromMessageObject(editedMessage);
      const key = pickValue(protocol, 'key', 'Key') || {};
      return {
        kind: 'edit',
        status: 'message_edited',
        text: editedText ? `Pesan WhatsApp diedit: ${editedText}` : 'Pesan WhatsApp diedit.',
        targetMessageId: pickValue(key, 'id', 'ID', 'Id') || pickValue(protocol, 'stanzaId', 'StanzaId', 'StanzaID') || null,
        metadata: { editedText, protocol },
      };
    }

    const protocolType = String(pickValue(protocol, 'type', 'Type') || '').toLowerCase();
    if (protocolType.includes('revok') || protocolType === '0') {
      const key = pickValue(protocol, 'key', 'Key') || {};
      return {
        kind: 'delete',
        status: 'message_deleted',
        text: 'Pesan WhatsApp dihapus/revoke.',
        targetMessageId: pickValue(key, 'id', 'ID', 'Id') || pickValue(protocol, 'stanzaId', 'StanzaId', 'StanzaID') || null,
        metadata: { protocol },
      };
    }
  }

  const edited = pickObject(message, 'editedMessage', 'EditedMessage');
  if (edited) {
    return {
      kind: 'edit',
      status: 'message_edited',
      text: 'Pesan WhatsApp diedit.',
      targetMessageId: resolveWebhookMessageId(payload),
      metadata: { edited },
    };
  }

  return null;
}

async function handleNonMessageWebhook(payload: GenfityWebhookPayload, villageId?: string): Promise<boolean> {
  const type = payload.type;
  if (['MessageSent', 'Receipt', 'ReadReceipt'].includes(type)) {
    const messageId = resolveWebhookMessageId(payload);
    if (!messageId) return true;

    const rawState = String((payload.event as any)?.Receipt?.Type || (payload.event as any)?.Status || (payload.event as any)?.state || (payload.event as any)?.State || (payload as any).state || (payload as any).status || type).toLowerCase();
    const failed = rawState.includes('fail') || rawState.includes('error');
    const read = rawState.includes('read');
    const delivered = rawState.includes('deliver');
    const status: 'sent' | 'delivered' | 'read' | 'failed' = failed ? 'failed' : read ? 'read' : delivered ? 'delivered' : 'sent';
    const error = failed ? JSON.stringify((payload.event as any)?.Error || (payload as any).error || 'Delivery failed').slice(0, 500) : undefined;

    const occurredAt = eventTimestamp(payload);
    await updateMessageDeliveryStatus(messageId, status, {
      at: occurredAt,
      error,
    });

    await notifyNotificationServiceDeliveryStatus({
      messageId,
      deliveryStatus: status,
      occurredAt,
      providerStatus: rawState,
      providerError: error,
    });

    if (villageId) {
      await logWaActivity({
        villageId,
        type: 'message_delivery',
        severity: failed ? 'warning' : 'info',
        status,
        message: failed ? 'Pengiriman pesan WhatsApp gagal.' : 'Status pengiriman pesan WhatsApp diperbarui.',
        providerEvent: type,
        providerMessageId: messageId,
        metadata: { rawState, error },
      });

      const channelIdentifier = resolveWebhookContactIdentifier(payload);
      if (channelIdentifier && (read || failed)) {
        await saveLivechatSystemActivity({
          villageId,
          channelIdentifier,
          messageId: `system-delivery-${status}-${messageId}`,
          messageText: failed ? 'Status pengiriman WhatsApp gagal.' : 'Pesan WhatsApp sudah dibaca.',
          timestamp: eventTimestamp(payload),
          status: failed ? 'delivery_failed' : 'message_read',
          providerEvent: type,
          metadata: { providerMessageId: messageId, rawState, error },
        });
      }
    }
    return true;
  }

  if (['Presence', 'ChatPresence'].includes(type)) {
    const channelIdentifier = resolvePresenceIdentifier(payload);
    if (!channelIdentifier) return true;
    const rawState = String((payload.event as any)?.State || (payload.event as any)?.Presence || (payload as any).state || '').toLowerCase();
    const typingState = rawState.includes('compos') || rawState.includes('typing') ? 'composing' : 'paused';
    publishTypingEvent({
      village_id: villageId,
      channel: 'WHATSAPP',
      channel_identifier: channelIdentifier,
      typing_state: typingState,
      actor: 'user',
    });
    return true;
  }

  if (['Connected', 'Disconnected', 'LoggedOut', 'QR', 'ConnectFailure', 'PairSuccess', 'StreamReplaced'].includes(type)) {
    const status = type === 'Connected' || type === 'PairSuccess'
      ? 'connected'
      : type === 'QR'
        ? 'qr'
        : type === 'LoggedOut'
          ? 'logged_out'
          : type === 'ConnectFailure'
            ? 'error'
            : type === 'StreamReplaced'
              ? 'replaced'
              : 'disconnected';
    let previousStatus: string | null | undefined;

    if (villageId) {
      const storedSession = await getStoredSession(villageId).catch((error) => {
        logger.warn('Failed to load WA session before status webhook update', { villageId, status, error: error.message });
        return null;
      });
      previousStatus = storedSession?.status;

      if (type === 'QR' && previousStatus === 'connected') {
        logger.info('Ignoring QR lifecycle event for already connected WA session', { villageId });
        return true;
      }

      if (previousStatus !== status) {
        await updateStoredSessionStatus({ villageId, status }).catch((error) => {
          logger.warn('Failed to update WA session status from webhook', { villageId, status, error: error.message });
        });
      }

      await logWaActivity({
        villageId,
        type: 'session_lifecycle',
        severity: type === 'ConnectFailure' || type === 'StreamReplaced' ? 'warning' : 'info',
        status,
        message: type === 'ConnectFailure'
          ? 'Provider melaporkan koneksi WhatsApp gagal.'
          : type === 'StreamReplaced'
            ? 'Stream WhatsApp digantikan oleh koneksi lain.'
            : `Provider mengirim event session WhatsApp: ${type}.`,
        providerEvent: type,
        metadata: {
          previousStatus,
          error: resolveWebhookError(payload),
        },
      });
    }

    if (previousStatus === status) {
      return true;
    }

    publishLivechatEvent({
      type: 'wa_session_status',
      village_id: villageId,
      wa_session_status: status,
      wa_session_event: type,
    });
    return true;
  }

  if (['AppState', 'AppStateSyncComplete', 'HistorySync'].includes(type)) {
    if (villageId) {
      await logWaActivity({
        villageId,
        type: 'session_sync',
        severity: 'info',
        status: 'synced',
        message: type === 'HistorySync'
          ? 'Sinkronisasi riwayat WhatsApp selesai/berjalan.'
          : type === 'AppState'
            ? 'Provider mengirim update app state WhatsApp.'
            : 'Sinkronisasi app state WhatsApp selesai.',
        providerEvent: type,
        metadata: { event: payload.event || null },
      });
    }
    return true;
  }

  if (['CallOffer', 'CallAccept', 'CallTerminate', 'CallOfferNotice', 'CallRelayLatency'].includes(type)) {
    const channelIdentifier = resolveWebhookContactIdentifier(payload);
    if (villageId) {
      await logWaActivity({
        villageId,
        waUserId: channelIdentifier,
        channelIdentifier,
        type: 'call_activity',
        severity: 'info',
        status: type,
        message: `Aktivitas panggilan WhatsApp diterima: ${type}.`,
        providerEvent: type,
        metadata: { event: payload.event || null },
      });

      if (channelIdentifier) {
        const providerMessageId = resolveWebhookMessageId(payload);
        await saveLivechatSystemActivity({
          villageId,
          channelIdentifier,
          messageId: `system-call-${type}-${providerMessageId || eventTimestamp(payload).getTime()}`,
          messageText: `Aktivitas panggilan WhatsApp: ${type}.`,
          timestamp: eventTimestamp(payload),
          status: 'call_activity',
          providerEvent: type,
          metadata: { providerMessageId, event: payload.event || null },
        });
      }
    }
    return true;
  }

  if (type === 'PushNameSetting') {
    const channelIdentifier = resolveWebhookContactIdentifier(payload);
    const pushName = resolveWebhookPushName(payload);

    if (villageId && channelIdentifier && pushName) {
      await prisma.conversation.updateMany({
        where: {
          village_id: villageId,
          channel: 'WHATSAPP',
          channel_identifier: channelIdentifier,
        },
        data: {
          user_name: pushName,
          profile_name: pushName,
          profile_synced_at: new Date(),
        },
      });

      await logWaActivity({
        villageId,
        waUserId: channelIdentifier,
        channelIdentifier,
        type: 'profile_sync',
        severity: 'info',
        status: 'push_name_updated',
        message: 'Nama profil WhatsApp diperbarui dari event provider.',
        providerEvent: type,
        metadata: { pushName },
      });
    }
    return true;
  }

  return false;
}

async function isWaChannelEnabled(villageId?: string): Promise<boolean> {
  if (!villageId) return true;

  try {
    const account = await prisma.channel_accounts.findUnique({
      where: { village_id: villageId },
    });

    if (!account) return true;
    return account.enabled_wa !== false;
  } catch (error: any) {
    logger.warn('Failed to check WA channel settings, allowing by default', {
      error: error.message,
    });
    return true;
  }
}

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
    const parsed = parseWebhookBody(req.body);
    if (!parsed.payload) {
      logger.warn('Failed to parse jsonData field', { error: parsed.parseError });
      res.json({ status: 'ok', message: 'Invalid jsonData' });
      return;
    }

    const payload: GenfityWebhookPayload = parsed.payload;
    const instanceName = webhookCandidateFromBody(req.body);
    const villageId: string | undefined = instanceName
      ? await resolveVillageIdFromInstanceName(instanceName)
      : undefined;

    logger.debug('Webhook received', {
      type: payload.type,
      hasEvent: !!payload.event,
      instanceName,
      villageId,
      eventKeys: payload.event ? Object.keys(payload.event) : [],
      infoKeys: payload.event?.Info ? Object.keys(payload.event.Info) : [],
      messageKeys: payload.event?.Message ? Object.keys(payload.event.Message) : [],
    });

    if (payload.type !== 'Message') {
      const handled = await handleNonMessageWebhook(payload, villageId);
      if (!handled && villageId) {
        await logWaActivity({
          villageId,
          type: 'webhook_unknown_event',
          severity: 'warning',
          status: 'ignored',
          message: `Provider mengirim event webhook yang belum ditangani: ${payload.type}.`,
          providerEvent: payload.type,
          metadata: { event: payload.event || null },
        });
      }
      logger.debug('Non-message webhook received', { type: payload.type, handled });
      res.json({ status: 'ok', message: handled ? `Processed event type: ${payload.type}` : `Ignored event type: ${payload.type}` });
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
    const waMetadata = normalizeWaMetadata(payload);

    logger.debug('Parsed payload result', {
      from,
      messageId,
      timestamp,
      messageKind: waMetadata.message_kind,
      hasMessageText: !!message,
      messageLength: message?.length || 0,
    });

    if (from && messageId && payload.event?.Info.IsFromMe) {
      logger.info('Skipping own message', { message_id: messageId });
      res.json({ status: 'ok', message: 'Own message skipped' });
      return;
    }

    const messageAction = resolveMessageActionActivity(payload);
    if (messageAction && from && messageId) {
      const waUserId = extractPhoneFromJID(from);
      if (/^[\d]+$/.test(waUserId)) {
        const systemActivityMessageId = buildSystemActivityMessageId(
          `action-${messageAction.kind}`,
          messageId,
          messageAction.targetMessageId || null,
        );
        const isProviderDuplicate = await checkDuplicateMessage(messageId);
        const isSystemActivityDuplicate = await checkDuplicateMessage(systemActivityMessageId);

        if (!isProviderDuplicate && !isSystemActivityDuplicate && villageId) {
          let attached = false;
          if (messageAction.kind === 'reaction' && messageAction.targetMessageId) {
            const metadata = messageAction.metadata as any;
            attached = await applyMessageReaction({
              village_id: villageId,
              channel: 'WHATSAPP',
              channel_identifier: waUserId,
              target_message_id: messageAction.targetMessageId,
              reaction_message_id: messageId,
              emoji: String(metadata?.emoji || ''),
              from: waUserId,
              timestamp,
            });
          }

          if (!attached) {
            await saveLivechatSystemActivity({
              villageId,
              channelIdentifier: waUserId,
              messageId: systemActivityMessageId,
              messageText: messageAction.text,
              timestamp,
              status: messageAction.status,
              providerEvent: payload.type,
              metadata: {
                kind: messageAction.kind,
                providerMessageId: messageId,
                targetMessageId: messageAction.targetMessageId || null,
                action: messageAction.metadata,
              },
            });
          }

          await logWaActivity({
            villageId,
            waUserId,
            channelIdentifier: waUserId,
            type: 'message_action',
            severity: 'info',
            status: messageAction.status,
            message: messageAction.text,
            providerEvent: payload.type,
            providerMessageId: messageId,
            metadata: {
              systemActivityMessageId,
              targetMessageId: messageAction.targetMessageId || null,
              action: messageAction.metadata,
            },
          });
        }
        res.json({ status: 'ok', message_id: messageId, mode: 'message_action' });
        return;
      }
    }

    if (!message || !from || !messageId) {
      logger.warn('No valid message in webhook payload', {
        hasMessage: !!message,
        hasFrom: !!from,
        hasMessageId: !!messageId,
      });
      res.json({ status: 'ok', message: 'No message to process' });
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

    // Final safety check: Ensure waUserId is numeric only
    // LID format can be up to 20 digits, phone numbers are 10-15 digits
    // Group IDs were already filtered above by @g.us check
    if (!/^[\d]+$/.test(waUserId)) {
      logger.warn('Invalid wa_user_id format (non-numeric)', {
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
    // STEP 1.5: SPAM GUARD CHECK (BEFORE saving to DB)
    // ============================================
    // Check spam FIRST so spam messages are never saved to chat history.
    // This prevents AI from seeing spam in history and keeps chat clean.
    const spamResult = checkSpamGuard(villageId, waUserId, messageId, message, timestamp.toISOString());

    if (spamResult.isSpam) {
      // Message is SPAM → do NOT save to messages DB, do NOT process
      logger.warn('🚫 Message rejected by spam guard (not saved to history)', {
        wa_user_id: waUserId,
        message_id: messageId,
        reason: spamResult.reason,
        isBanned: spamResult.isBanned,
        isDuplicate: spamResult.isDuplicate,
      });
      res.json({
        status: 'ok',
        message_id: messageId,
        mode: 'spam_blocked',
        reason: spamResult.reason,
      });
      return;
    }

    // ============================================
    // STEP 2: SAVE TO DATABASE (parallel with media processing)
    // ============================================
    // Only reaches here if message is NOT spam
    
    // Process media if present (non-blocking)
    let mediaInfo: MediaInfo = { hasMedia: false };
    const mediaPromise = processMediaFromWebhook(payload, waUserId, messageId, villageId)
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

    // Save message to database (only non-spam messages reach here)
    await saveIncomingMessage({
      village_id: villageId,
      wa_user_id: waUserId,
      channel: 'WHATSAPP',
      channel_identifier: waUserId,
      message_id: messageId,
      message_text: message,
      ...waMetadata,
      timestamp: timestamp,
    });

    const pushName = payload.event?.Info?.PushName?.trim() || undefined;
    await updateConversation(waUserId, message, pushName, true, villageId, 'WHATSAPP');

    if (villageId) {
      void enrichConversationProfile(villageId, waUserId, pushName).catch((error: any) => {
        logger.warn('Failed to enrich WA profile after inbound message', {
          village_id: villageId,
          wa_user_id: waUserId,
          error: error.message,
        });
      });
    }

    // Wait for media processing to complete
    await mediaPromise;

    if (villageId) {
      await logWaActivity({
        villageId,
        waUserId,
        channelIdentifier: waUserId,
        type: 'message_received',
        severity: 'info',
        status: 'received',
        message: 'Pesan WhatsApp masuk diterima.',
        providerEvent: payload.type,
        providerMessageId: messageId,
        metadata: {
          hasMedia: mediaInfo.hasMedia,
          messageKind: waMetadata.message_kind,
          pushName: pushName || null,
        },
      });
    }

    if (mediaInfo.hasMedia) {
      await updateMessageMedia(messageId, {
        media_type: mediaInfo.mediaType,
        media_url: mediaInfo.mediaUrl,
        media_public_url: mediaInfo.mediaPublicUrl,
        mime_type: mediaInfo.mimeType,
        file_name: mediaInfo.fileName,
        file_size: mediaInfo.fileSize,
        storage_key: mediaInfo.storageKey,
      });
    }

    const waChannelEnabled = await isWaChannelEnabled(villageId);
    if (!waChannelEnabled) {
      logger.info('WA channel disabled, skipping AI processing', {
        wa_user_id: waUserId,
        message_id: messageId,
        village_id: villageId,
      });
      res.json({ status: 'ok', message_id: messageId, mode: 'disabled' });
      return;
    }

    // ============================================
    // STEP 3: CHECK TAKEOVER STATUS
    // ============================================
    const inTakeover = await isUserInTakeover(waUserId, villageId, 'WHATSAPP');
    
    if (inTakeover) {
      // User is being handled by admin - don't process with AI
      // Cancel any pending batch for this user
      cancelBatch(waUserId, villageId);
      
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
      village_id: villageId,
      wa_user_id: waUserId,
      channel: 'WHATSAPP',
      channel_identifier: waUserId,
      message_id: messageId,
      message_text: message,
    });

    // Set AI status to queued
    await setAIProcessing(waUserId, messageId, villageId, 'WHATSAPP');

    // Add to message batcher
    // The batcher forwards immediately with spam guard context
    addMessageToBatch(
      villageId,
      waUserId,
      messageId,
      message,
      timestamp.toISOString(),
      {
        has_media: mediaInfo.hasMedia,
        media_type: mediaInfo.mediaType,
        media_url: mediaInfo.mediaUrl,
        media_public_url: mediaInfo.mediaPublicUrl,
      },
      spamResult,
    );
    
    logger.info('Message forwarded to AI for processing', {
      village_id: villageId,
      wa_user_id: waUserId,
      message_id: messageId,
    });

    logger.info('Webhook processed successfully', {
      village_id: villageId,
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
    // For LID format (e.g., "93849498181695@lid"), use SenderAlt which contains the real phone
    let from = info.Chat; // e.g., "628123456789@s.whatsapp.net" or "93849498181695@lid"
    
    // Check if Chat is in LID format (@lid suffix)
    const isLIDFormat = from && (from.endsWith('@lid') || from.includes('@lid'));
    
    // Helper function to extract clean phone number from JID
    // Handles formats like: "6281233784490:24@s.whatsapp.net" -> "6281233784490"
    // Also handles: "6281233784490@s.whatsapp.net" -> "6281233784490"
    const extractCleanPhone = (jid: string): string => {
      // First split by @ to get the user part
      const userPart = jid.split('@')[0];
      // Then split by : to remove device ID if present
      return userPart.split(':')[0];
    };
    
    // If LID format, prefer SenderAlt which has the actual phone number
    if (isLIDFormat && info.SenderAlt) {
      // Clean the SenderAlt to get proper JID format for 'from'
      const cleanPhone = extractCleanPhone(info.SenderAlt);
      from = `${cleanPhone}@s.whatsapp.net`; // Reconstruct clean JID
      logger.debug('LID format detected, using SenderAlt', { 
        originalChat: info.Chat, 
        originalSenderAlt: info.SenderAlt,
        cleanFrom: from 
      });
    }
    
    // Extract sender and chat phone for auto-read feature
    // For LID: Sender might be "93849498181695:24@lid", use SenderAlt instead
    // Sender can be an object or string
    let senderPhone: string | null = null;
    if (typeof info.Sender === 'object' && info.Sender?.User) {
      senderPhone = info.Sender.User;
    } else if (typeof info.Sender === 'string' && info.SenderAlt) {
      // LID format: extract clean phone from SenderAlt
      senderPhone = extractCleanPhone(info.SenderAlt);
    }
    
    // For chatPhone, use SenderAlt if available (LID case), otherwise use Chat
    let chatPhone: string | null = null;
    if (isLIDFormat && info.SenderAlt) {
      chatPhone = extractCleanPhone(info.SenderAlt);
    } else if (info.Chat) {
      chatPhone = extractCleanPhone(info.Chat);
    }

    // Extract message ID
    const messageId = info.ID;

    // Extract timestamp - genfity-wa uses ISO format
    let timestamp = info.Timestamp ? new Date(info.Timestamp) : new Date();
    if (Number.isNaN(timestamp.getTime())) {
      logger.warn('Invalid webhook timestamp, using current time', { timestamp: info.Timestamp, messageId });
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
        // Media-only messages
        else if (msgObj.imageMessage || msgObj.ImageMessage) {
          const imageMessage = msgObj.imageMessage || msgObj.ImageMessage;
          messageText = formatMediaOnlyMessage({
            type: 'image',
            fileName: imageMessage.fileName || imageMessage.FileName || null,
            mimeType: imageMessage.mimetype || imageMessage.Mimetype || null,
          });
        }
        else if (msgObj.videoMessage || msgObj.VideoMessage) {
          const videoMessage = msgObj.videoMessage || msgObj.VideoMessage;
          messageText = formatMediaOnlyMessage({
            type: 'video',
            fileName: videoMessage.fileName || videoMessage.FileName || null,
            mimeType: videoMessage.mimetype || videoMessage.Mimetype || null,
          });
        }
        else if (msgObj.audioMessage || msgObj.AudioMessage) {
          const audioMessage = msgObj.audioMessage || msgObj.AudioMessage;
          messageText = formatMediaOnlyMessage({
            type: 'audio',
            fileName: audioMessage.fileName || audioMessage.FileName || null,
            mimeType: audioMessage.mimetype || audioMessage.Mimetype || null,
            isVoiceNote: Boolean(audioMessage.PTT || audioMessage.ptt),
          });
        }
        else if (msgObj.documentMessage || msgObj.DocumentMessage) {
          const documentMessage = msgObj.documentMessage || msgObj.DocumentMessage;
          messageText = formatMediaOnlyMessage({
            type: 'document',
            fileName: documentMessage.fileName || documentMessage.FileName || null,
            mimeType: documentMessage.mimetype || documentMessage.Mimetype || null,
          });
        }
        else if (msgObj.stickerMessage || msgObj.StickerMessage) {
          messageText = formatMediaOnlyMessage({ type: 'sticker' });
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
        else if (msgObj.buttonsResponseMessage || msgObj.ButtonsResponseMessage || msgObj.templateButtonReplyMessage || msgObj.TemplateButtonReplyMessage || msgObj.interactiveResponseMessage || msgObj.InteractiveResponseMessage) {
          const response = msgObj.buttonsResponseMessage || msgObj.ButtonsResponseMessage || msgObj.templateButtonReplyMessage || msgObj.TemplateButtonReplyMessage || msgObj.interactiveResponseMessage || msgObj.InteractiveResponseMessage;
          messageText = extractInteractiveResponseText(response) || '[Button response]';
        }
        else if (msgObj.listResponseMessage || msgObj.ListResponseMessage) {
          const response = msgObj.listResponseMessage || msgObj.ListResponseMessage;
          messageText = extractInteractiveResponseText(response) || '[List response]';
        }
      }
    }

    logger.debug('Parsed message details', {
      from,
      messageId,
      hasMessageText: !!messageText,
      messageLength: messageText?.length || 0,
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
    .replace(/@broadcast$/i, '') // Broadcast JID
    .replace(/@lid$/i, ''); // Linked Device ID (new WhatsApp format)
}

/**
 * Webhook verification (for WhatsApp Cloud API setup - kept for compatibility)
 * GET /webhook/whatsapp
 * 
 * If WA_WEBHOOK_VERIFY_TOKEN is not set, accept any verification request.
 * This allows simpler webhook setup without verify token.
 */
export function verifyWebhook(req: Request, res: Response): void {
  const mode = getQuery(req, 'hub.mode');
  const token = getQuery(req, 'hub.verify_token');
  const challenge = getQuery(req, 'hub.challenge');

  const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN;
  const isProduction = process.env.NODE_ENV === 'production';

  // SECURITY: In production, require verify token
  if (!verifyToken || verifyToken === '') {
    if (isProduction) {
      logger.error('SECURITY: WA_WEBHOOK_VERIFY_TOKEN not configured in production!');
      res.status(500).send('Webhook not configured');
      return;
    }
    // Development only: accept without token
    if (mode === 'subscribe' && challenge) {
      logger.warn('Webhook verified WITHOUT token (development mode only)');
      res.send(challenge);
      return;
    }
    logger.warn('Webhook ping accepted WITHOUT token (development mode only)');
    res.send('OK');
    return;
  }

  // Verify token is configured - validate it
  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Webhook verified successfully');
    res.send(challenge);
    return;
  }

  logger.warn('Webhook verification failed', { mode, hasToken: !!token });
  res.sendStatus(403);
}
