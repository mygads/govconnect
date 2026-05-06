import { Request, Response } from 'express';
import {
  getSessionStatus,
  connectSession,
  disconnectSession,
  logoutSession,
  getQRCode,
  pairPhone,
  getSessionSettings,
  updateSessionSettings,
  createSessionForVillage,
  deleteSessionForVillage,
  getStoredSession,
  updateStoredSessionStatus,
  normalizePhoneNumber,
  getWhatsAppContacts,
  syncWhatsAppContacts,
  sendUserPresence,
  rejectWhatsAppCall,
  setWhatsAppStatusText,
  getWhatsAppProxyConfig,
  syncWhatsAppHistory,
  getWhatsAppS3Status,
  syncWhatsAppS3Config,
  testWhatsAppS3,
  deleteWhatsAppS3Config,
  ensureWhatsAppLifecycleSync,
  repairAllWhatsAppSessions,
  deriveWhatsAppLifecycleState,
} from '../services/wa.service';
import logger from '../utils/logger';
import prisma from '../config/database';
import { getQuery } from '../utils/http';
import { auditWhatsAppSession, syncWhatsAppWebhook } from '../services/wa-reconciliation.service';
import { listWaActivities, logWaActivity, WaActivitySeverity } from '../services/wa-activity-log.service';
import { enrichConversationProfile } from '../services/wa-profile.service';
import { downloadWhatsAppMedia } from '../services/media.service';
import { updateMessageMedia } from '../services/message.service';

function resolveVillageId(req: Request): string | null {
  const queryVillageId = getQuery(req, 'village_id') || null;
  const bodyVillageId = typeof req.body?.village_id === 'string' ? req.body.village_id : null;
  const headerVillageId = typeof req.headers['x-village-id'] === 'string' ? req.headers['x-village-id'] : null;
  return queryVillageId || bodyVillageId || headerVillageId;
}

function requireVillageId(req: Request, res: Response): string | null {
  const villageId = resolveVillageId(req);
  if (!villageId) {
    res.status(400).json({ error: 'village_id is required' });
    return null;
  }
  return villageId;
}

function getStoredMediaMessage(rawMessage: any, mediaType: string | null | undefined): any | null {
  if (!rawMessage || typeof rawMessage !== 'object' || !mediaType) return null;
  const map: Record<string, string[]> = {
    image: ['imageMessage', 'ImageMessage'],
    video: ['videoMessage', 'VideoMessage'],
    audio: ['audioMessage', 'AudioMessage'],
    document: ['documentMessage', 'DocumentMessage'],
    sticker: ['stickerMessage', 'StickerMessage'],
  };
  for (const key of map[mediaType] || []) {
    if (rawMessage[key] && typeof rawMessage[key] === 'object') return rawMessage[key];
  }
  return null;
}

async function syncChannelAccountNumber(villageId: string, waNumber?: string | null, enabledWa?: boolean) {
  const normalizedWaNumber = typeof waNumber === 'string' ? waNumber : '';

  const webhookUrl = (process.env.PUBLIC_CHANNEL_BASE_URL || process.env.PUBLIC_BASE_URL || '')
    .replace(/\/$/, '');
  const webhook = webhookUrl ? `${webhookUrl}/webhook` : '';

  // Check if account exists to preserve existing enabled_* settings
  const existing = await prisma.channel_accounts.findUnique({
    where: { village_id: villageId },
  });

  await prisma.channel_accounts.upsert({
    where: { village_id: villageId },
    create: {
      village_id: villageId,
      wa_number: normalizedWaNumber,
      wa_token: '',
      webhook_url: webhook,
      enabled_wa: typeof enabledWa === 'boolean' ? enabledWa : false,
      enabled_webchat: false,
    },
    update: {
      wa_number: normalizedWaNumber,
      webhook_url: webhook,
      enabled_wa: typeof enabledWa === 'boolean' ? enabledWa : existing?.enabled_wa ?? false,
      enabled_webchat: existing?.enabled_webchat ?? false,
    },
  });
}

async function syncSessionState(villageId: string): Promise<{
  connected: boolean;
  loggedIn: boolean;
  wa_number: string | null;
  status?: string | null;
  lifecycle_status?: string;
  reconnectable?: boolean;
  requires_qr?: boolean;
  problematic?: boolean;
  status_fetch_ok?: boolean;
}> {
  const session = await getStoredSession(villageId);
  if (!session) {
    throw new Error('Session belum dibuat');
  }

  const status = await getSessionStatus(session.wa_token);
  // Strip :N device identifier and @s.whatsapp.net from JID
  const waNumber = status.jid
    ? status.jid.replace(/@s\.whatsapp\.net$/i, '').replace(/:\d+$/, '')
    : (session.wa_number ? session.wa_number.replace(/:\d+$/, '') : session.wa_number);
  const lifecycle = deriveWhatsAppLifecycleState({ dbStatus: session.status, providerStatus: status });

  if (lifecycle.status_fetch_ok && lifecycle.status) {
    await updateStoredSessionStatus({
      villageId,
      status: lifecycle.status,
      waNumber: waNumber || null,
    });
  } else if (waNumber) {
    await updateStoredSessionStatus({ villageId, waNumber });
  }

  await syncChannelAccountNumber(villageId, waNumber || null);

  return {
    connected: status.connected,
    loggedIn: status.loggedIn,
    wa_number: waNumber || null,
    ...lifecycle,
  };
}

/**
 * Get WhatsApp session status
 * GET /internal/whatsapp/status
 */
export async function getStatus(_req: Request, res: Response): Promise<void> {
  try {
    const villageId = resolveVillageId(_req);
    if (!villageId) {
      res.status(400).json({ success: false, error: 'village_id diperlukan' });
      return;
    }

    const session = await getStoredSession(villageId);
    if (!session) {
      res.json({
        success: true,
        data: {
          exists: false,
          connected: false,
          loggedIn: false,
          wa_number: null,
          status: null,
          lifecycle_status: 'unknown',
          reconnectable: false,
          requires_qr: false,
          problematic: false,
          status_fetch_ok: true,
        },
      });
      return;
    }

    const status = await getSessionStatus(session.wa_token);
    // JID format: 628xxx:N@s.whatsapp.net where :N is the device identifier
    // Strip both the @s.whatsapp.net suffix AND the :N device part to get clean phone number
    const waNumber = status.jid
      ? status.jid.replace(/@s\.whatsapp\.net$/i, '').replace(/:\d+$/, '')
      : (session.wa_number ? session.wa_number.replace(/:\d+$/, '') : session.wa_number);
    const lifecycle = deriveWhatsAppLifecycleState({ dbStatus: session.status, providerStatus: status });

    if (lifecycle.status_fetch_ok && lifecycle.status) {
      await updateStoredSessionStatus({
        villageId,
        status: lifecycle.status,
        waNumber: waNumber || null,
      });
    } else if (waNumber) {
      await updateStoredSessionStatus({ villageId, waNumber: waNumber || null });
    }

    await syncChannelAccountNumber(villageId, waNumber || null);

    res.json({
      success: true,
      data: {
        exists: true,
        ...status,
        wa_number: waNumber || null,
        status: lifecycle.status,
        lifecycle_status: lifecycle.lifecycle_status,
        reconnectable: lifecycle.reconnectable,
        requires_qr: lifecycle.requires_qr,
        problematic: lifecycle.problematic,
        status_fetch_ok: lifecycle.status_fetch_ok,
      },
    });
  } catch (error: any) {
    logger.error('Get WhatsApp status error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get session status',
    });
  }
}

/**
 * Create WhatsApp session
 * POST /internal/whatsapp/session
 */
export async function createSession(req: Request, res: Response): Promise<void> {
  try {
    const villageId = resolveVillageId(req);
    if (!villageId) {
      res.status(400).json({ success: false, error: 'village_id diperlukan' });
      return;
    }

    const adminId = typeof req.body?.admin_id === 'string' ? req.body.admin_id : undefined;
    const villageSlug = typeof req.body?.village_slug === 'string' ? req.body.village_slug : undefined;
    const result = await createSessionForVillage({ villageId, adminId, villageSlug });

    // Best-effort: sync status immediately so DB is always aligned with WA server.
    // This will typically show disconnected/not logged in until QR is scanned.
    try {
      await syncSessionState(villageId);
    } catch (e: any) {
      logger.debug('Post-create session sync skipped/failed', { error: e?.message, village_id: villageId });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Create WhatsApp session error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create session',
    });
  }
}

/**
 * Connect WhatsApp session
 * POST /internal/whatsapp/connect
 */
export async function connect(_req: Request, res: Response): Promise<void> {
  try {
    const villageId = resolveVillageId(_req);
    if (!villageId) {
      res.status(400).json({ success: false, error: 'village_id diperlukan' });
      return;
    }

    const session = await getStoredSession(villageId);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session belum dibuat' });
      return;
    }

    const result = await connectSession(session.wa_token);

    // Sync status after connect so DB reflects latest WA state
    try {
      await syncSessionState(villageId);
    } catch (e: any) {
      logger.debug('Post-connect session sync failed', { error: e?.message, village_id: villageId });
    }
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Connect WhatsApp error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to connect session',
    });
  }
}

/**
 * Disconnect WhatsApp session
 * POST /internal/whatsapp/disconnect
 */
export async function disconnect(_req: Request, res: Response): Promise<void> {
  try {
    const villageId = resolveVillageId(_req);
    if (!villageId) {
      res.status(400).json({ success: false, error: 'village_id diperlukan' });
      return;
    }

    const session = await getStoredSession(villageId);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session belum dibuat' });
      return;
    }

    const result = await disconnectSession(session.wa_token);

    try {
      await syncSessionState(villageId);
    } catch (e: any) {
      logger.debug('Post-disconnect session sync failed', { error: e?.message, village_id: villageId });
    }
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Disconnect WhatsApp error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to disconnect session',
    });
  }
}

/**
 * Logout WhatsApp session
 * POST /internal/whatsapp/logout
 */
export async function logout(_req: Request, res: Response): Promise<void> {
  try {
    const villageId = resolveVillageId(_req);
    if (!villageId) {
      res.status(400).json({ success: false, error: 'village_id diperlukan' });
      return;
    }

    const session = await getStoredSession(villageId);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session belum dibuat' });
      return;
    }

    const result = await logoutSession(session.wa_token);

    await updateStoredSessionStatus({ villageId, status: 'logged_out' });
    try {
      await syncChannelAccountNumber(villageId, null, false);
    } catch {
      // no-op
    }
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Logout WhatsApp error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to logout session',
    });
  }
}

/**
 * Get QR Code
 * GET /internal/whatsapp/qr
 */
export async function getQR(_req: Request, res: Response): Promise<void> {
  try {
    const villageId = resolveVillageId(_req);
    if (!villageId) {
      res.status(400).json({ success: false, error: 'village_id diperlukan' });
      return;
    }

    const session = await getStoredSession(villageId);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session belum dibuat' });
      return;
    }

    const result = await getQRCode(session.wa_token);
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Get QR code error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get QR code',
    });
  }
}

/**
 * Pair phone
 * POST /internal/whatsapp/pairphone
 */
export async function pair(req: Request, res: Response): Promise<void> {
  try {
    const { Phone } = req.body;
    const villageId = resolveVillageId(req);
    if (!villageId) {
      res.status(400).json({ success: false, error: 'village_id diperlukan' });
      return;
    }
    
    if (!Phone) {
      res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
      return;
    }

    const session = await getStoredSession(villageId);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session belum dibuat' });
      return;
    }

    const result = await pairPhone(session.wa_token, Phone);
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Pair phone error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to pair phone',
    });
  }
}

/**
 * Get session settings
 * GET /internal/whatsapp/settings
 */
export async function getSettings(_req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(_req, res);
    if (!villageId) return;

    const settings = await getSessionSettings(villageId);
    res.json({
      success: true,
      data: settings,
    });
  } catch (error: any) {
    logger.error('Get WhatsApp settings error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get session settings',
    });
  }
}

/**
 * Update session settings
 * PATCH /internal/whatsapp/settings
 */
export async function updateSettings(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;

    const { autoReadMessages, typingIndicator } = req.body;

    const result = await updateSessionSettings({
      autoReadMessages,
      typingIndicator,
    }, villageId);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Update WhatsApp settings error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update session settings',
    });
  }
}

/**
 * Delete WhatsApp session
 * DELETE /internal/whatsapp/session
 */
export async function deleteSession(req: Request, res: Response): Promise<void> {
  try {
    const villageId = resolveVillageId(req);
    if (!villageId) {
      res.status(400).json({ success: false, error: 'village_id diperlukan' });
      return;
    }

    const result = await deleteSessionForVillage(villageId);
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('Delete WhatsApp session error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete session',
    });
  }
}

/**
 * Check for duplicate WhatsApp number
 * GET /internal/whatsapp/check-duplicate
 * Returns the village that already has this WA number connected (if any)
 */
export async function checkDuplicateWaNumber(req: Request, res: Response): Promise<void> {
  try {
    const villageId = resolveVillageId(req);
    if (!villageId) {
      res.status(400).json({ success: false, error: 'village_id diperlukan' });
      return;
    }

    const waNumber = getQuery(req, 'wa_number');
    if (!waNumber) {
      res.status(400).json({ success: false, error: 'wa_number diperlukan' });
      return;
    }

    const normalizedWaNumber = normalizePhoneNumber(waNumber);
    const connectedSessions = await prisma.wa_sessions.findMany({
      where: {
        village_id: { not: villageId },
        status: 'connected',
        wa_number: { not: null },
      },
    });
    const existingSession = connectedSessions.find(session =>
      session.wa_number && normalizePhoneNumber(session.wa_number) === normalizedWaNumber
    ) || null;

    if (existingSession) {
      // Try to get village name from govconnect database
      let villageName = existingSession.village_id;
      try {
        // Fetch village info from dashboard's prisma or via a lookup
        const channelAccount = await prisma.channel_accounts.findUnique({
          where: { village_id: existingSession.village_id },
        });
        if (channelAccount) {
          villageName = existingSession.village_id; // Use village_id as name placeholder
        }
      } catch {
        // Keep using village_id as name
      }

      res.json({
        success: true,
        data: {
          isDuplicate: true,
          waNumber: normalizedWaNumber,
          existingVillageId: existingSession.village_id,
          existingVillageName: villageName,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        isDuplicate: false,
        waNumber: normalizedWaNumber,
      },
    });
  } catch (error: any) {
    logger.error('Check duplicate WA number error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check duplicate',
    });
  }
}

/**
 * Force disconnect a WhatsApp session from another village
 * POST /internal/whatsapp/force-disconnect
 * Disconnects the WA session from another village so current village can use it
 */
export async function getWebhookAudit(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;

    const audit = await auditWhatsAppSession(villageId);
    res.json({ success: true, data: audit });
  } catch (error: any) {
    logger.error('Webhook audit error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to audit webhook' });
  }
}

export async function syncWebhook(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;

    const audit = await syncWhatsAppWebhook(villageId);
    res.json({ success: true, data: audit });
  } catch (error: any) {
    logger.error('Webhook sync error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to sync webhook' });
  }
}

export async function getWaActivity(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;

    const type = getQuery(req, 'type') || undefined;
    const rawSeverity = getQuery(req, 'severity') || undefined;
    const severity = rawSeverity === 'info' || rawSeverity === 'warning' || rawSeverity === 'error'
      ? rawSeverity as WaActivitySeverity
      : undefined;
    const limit = Number(getQuery(req, 'limit') || 20);
    const activities = await listWaActivities({ villageId, type, severity, limit });

    res.json({ success: true, data: activities });
  } catch (error: any) {
    logger.error('WA activity list error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to load WA activity' });
  }
}

export async function getWaContacts(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;

    const sync = getQuery(req, 'sync') === 'true';
    const contacts = await getWhatsAppContacts(villageId, sync);
    res.json({ success: true, data: { contacts, count: contacts.length } });
  } catch (error: any) {
    logger.error('WA contacts list error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to load WA contacts' });
  }
}

export async function syncWaContacts(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;

    const contacts = await syncWhatsAppContacts(villageId);
    res.json({ success: true, data: { contacts, count: contacts.length } });
  } catch (error: any) {
    logger.error('WA contacts sync error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to sync WA contacts' });
  }
}

export async function setWaPresence(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;

    const state = req.body?.state === 'unavailable' ? 'unavailable' : req.body?.state === 'available' ? 'available' : null;
    if (!state) {
      res.status(400).json({ success: false, error: 'state must be available or unavailable' });
      return;
    }

    const sent = await sendUserPresence(villageId, state);
    res.json({ success: true, data: { state, provider_sent: sent } });
  } catch (error: any) {
    logger.error('WA presence error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to set WA presence' });
  }
}

export async function rejectWaCall(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;

    const callId = typeof req.body?.call_id === 'string' ? req.body.call_id.trim() : undefined;
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : undefined;
    if (!callId && !phone) {
      res.status(400).json({ success: false, error: 'call_id or phone is required' });
      return;
    }

    const result = await rejectWhatsAppCall({ villageId, callId, to: phone });
    res.status(result.success ? 200 : 502).json({ success: result.success, data: result, error: result.error });
  } catch (error: any) {
    logger.error('WA call reject error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to reject WA call' });
  }
}

export async function setWaStatusText(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      res.status(400).json({ success: false, error: 'text is required' });
      return;
    }
    if (text.length > 700) {
      res.status(400).json({ success: false, error: 'text is too long' });
      return;
    }

    const result = await setWhatsAppStatusText({ villageId, text });
    res.status(result.success ? 200 : 502).json({ success: result.success, data: result, error: result.error });
  } catch (error: any) {
    logger.error('WA status text error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to set WA status text' });
  }
}

export async function retryWaMediaDownload(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;

    const messageId = req.params.message_id || req.body?.message_id;
    if (!messageId || typeof messageId !== 'string') {
      res.status(400).json({ success: false, error: 'message_id is required' });
      return;
    }

    const message = await prisma.message.findFirst({
      where: {
        village_id: villageId,
        message_id: messageId,
        channel: 'WHATSAPP',
      },
    });

    if (!message) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }

    const mediaType = message.media_type as 'image' | 'video' | 'audio' | 'document' | 'sticker' | null;
    const rawMediaMessage = getStoredMediaMessage(message.wa_raw_message, mediaType);
    if (!mediaType || !rawMediaMessage) {
      res.status(400).json({ success: false, error: 'Stored message does not contain downloadable media metadata' });
      return;
    }

    const waUserId = message.wa_user_id || message.channel_identifier;
    const downloaded = await downloadWhatsAppMedia(rawMediaMessage, mediaType, waUserId, messageId, villageId);
    if (!downloaded) {
      await logWaActivity({
        villageId,
        waUserId,
        channelIdentifier: message.channel_identifier,
        type: 'media_download',
        severity: 'warning',
        status: 'retry_failed',
        message: 'Download ulang media WhatsApp gagal.',
        providerMessageId: messageId,
      });
      res.status(502).json({ success: false, error: 'Failed to download media from provider' });
      return;
    }

    await updateMessageMedia(messageId, {
      media_type: mediaType,
      media_url: downloaded.internalUrl,
      media_public_url: downloaded.publicUrl,
      mime_type: message.mime_type,
      file_name: message.file_name,
      file_size: message.file_size,
      storage_key: downloaded.storageKey,
    });

    await logWaActivity({
      villageId,
      waUserId,
      channelIdentifier: message.channel_identifier,
      type: 'media_download',
      severity: 'info',
      status: 'retry_success',
      message: 'Download ulang media WhatsApp berhasil.',
      providerMessageId: messageId,
      metadata: { storageKey: downloaded.storageKey },
    });

    res.json({ success: true, data: downloaded });
  } catch (error: any) {
    logger.error('WA media retry error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to retry media download' });
  }
}

export async function getWaProxyConfig(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;
    res.json({ success: true, data: await getWhatsAppProxyConfig(villageId) });
  } catch (error: any) {
    logger.error('WA proxy config error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to load WA proxy config' });
  }
}

export async function syncWaHistory(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;
    const history = Number(req.body?.history ?? getQuery(req, 'history') ?? 0);
    res.json({ success: true, data: await syncWhatsAppHistory(villageId, history) });
  } catch (error: any) {
    logger.error('WA history sync error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to sync WA history' });
  }
}

export async function getWaS3Status(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;
    res.json({ success: true, data: await getWhatsAppS3Status(villageId) });
  } catch (error: any) {
    logger.error('WA S3 status error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to load WA S3 status' });
  }
}

export async function syncWaS3(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;
    res.json({ success: true, data: await syncWhatsAppS3Config(villageId) });
  } catch (error: any) {
    logger.error('WA S3 sync error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to sync WA S3 config' });
  }
}

export async function syncLifecycle(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;
    const data = await ensureWhatsAppLifecycleSync(villageId);
    res.json({ success: data.success, warning: data.warning, data });
  } catch (error: any) {
    logger.error('WA lifecycle sync error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to sync WA lifecycle' });
  }
}

export async function repairAllWaSessions(_req: Request, res: Response): Promise<void> {
  try {
    const data = await repairAllWhatsAppSessions();
    res.json({ success: data.success, warning: data.warningCount > 0, data });
  } catch (error: any) {
    logger.error('WA bulk lifecycle repair error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to repair WA sessions' });
  }
}

export async function testWaS3(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;
    res.json({ success: true, data: await testWhatsAppS3(villageId) });
  } catch (error: any) {
    logger.error('WA S3 test error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to test WA S3' });
  }
}

export async function deleteWaS3(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;
    res.json({ success: true, data: await deleteWhatsAppS3Config(villageId) });
  } catch (error: any) {
    logger.error('WA S3 delete error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to delete WA S3 config' });
  }
}

export async function refreshWaProfile(req: Request, res: Response): Promise<void> {
  try {
    const villageId = requireVillageId(req, res);
    if (!villageId) return;

    const phone = typeof req.body?.phone === 'string'
      ? req.body.phone.trim()
      : getQuery(req, 'phone') || getQuery(req, 'wa_user_id') || '';
    const pushName = typeof req.body?.push_name === 'string' ? req.body.push_name.trim() : undefined;
    if (!phone) {
      res.status(400).json({ success: false, error: 'phone is required' });
      return;
    }

    const profile = await enrichConversationProfile(villageId, phone, pushName);
    res.json({ success: true, data: profile });
  } catch (error: any) {
    logger.error('WA profile refresh error', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to refresh WA profile' });
  }
}

export async function forceDisconnectOtherVillage(req: Request, res: Response): Promise<void> {
  try {
    const currentVillageId = resolveVillageId(req);
    if (!currentVillageId) {
      res.status(400).json({ success: false, error: 'village_id diperlukan' });
      return;
    }

    const targetVillageId = req.body?.target_village_id;
    if (!targetVillageId || typeof targetVillageId !== 'string') {
      res.status(400).json({ success: false, error: 'target_village_id diperlukan' });
      return;
    }

    // Get the target village's session
    const targetSession = await getStoredSession(targetVillageId);
    if (!targetSession) {
      res.status(404).json({ success: false, error: 'Target village session tidak ditemukan' });
      return;
    }

    // Disconnect and delete the target village's session
    try {
      await disconnectSession(targetSession.wa_token);
    } catch {
      // Ignore disconnect errors - session might already be disconnected
    }

    await deleteSessionForVillage(targetVillageId);

    logger.info('Force disconnected WA session from other village', {
      currentVillageId,
      targetVillageId,
    });

    res.json({
      success: true,
      data: { message: 'Session dari desa/kelurahan lain berhasil diputuskan' },
    });
  } catch (error: any) {
    logger.error('Force disconnect error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to force disconnect',
    });
  }
}
