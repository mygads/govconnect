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
} from '../services/wa.service';
import logger from '../utils/logger';
import prisma from '../config/database';
import { getQuery } from '../utils/http';

function resolveVillageId(req: Request): string | null {
  const queryVillageId = getQuery(req, 'village_id') || null;
  const bodyVillageId = typeof req.body?.village_id === 'string' ? req.body.village_id : null;
  const headerVillageId = typeof req.headers['x-village-id'] === 'string' ? req.headers['x-village-id'] : null;
  const fallbackVillageId = process.env.DEFAULT_VILLAGE_ID || null;
  return queryVillageId || bodyVillageId || headerVillageId || fallbackVillageId;
}

async function syncChannelAccountNumber(villageId: string, waNumber?: string | null) {
  if (!waNumber) return;

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
      wa_number: waNumber,
      wa_token: '',
      webhook_url: webhook,
      enabled_wa: false,
      enabled_webchat: false,
    },
    update: {
      wa_number: waNumber,
      webhook_url: webhook,
      // Preserve existing enabled settings
      enabled_wa: existing?.enabled_wa ?? false,
      enabled_webchat: existing?.enabled_webchat ?? false,
    },
  });
}

async function syncSessionState(villageId: string): Promise<{
  connected: boolean;
  loggedIn: boolean;
  wa_number: string | null;
}> {
  const session = await getStoredSession(villageId);
  if (!session) {
    throw new Error('Session belum dibuat');
  }

  const status = await getSessionStatus(session.wa_token);
  const waNumber = status.jid ? status.jid.replace(/@s\.whatsapp\.net$/i, '') : session.wa_number;

  await updateStoredSessionStatus({
    villageId,
    status: status.connected ? 'connected' : 'disconnected',
    waNumber: waNumber || null,
  });

  await syncChannelAccountNumber(villageId, waNumber || null);

  return {
    connected: status.connected,
    loggedIn: status.loggedIn,
    wa_number: waNumber || null,
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
        },
      });
      return;
    }

    const status = await getSessionStatus(session.wa_token);
    const waNumber = status.jid ? status.jid.replace(/@s\.whatsapp\.net$/i, '') : session.wa_number;

    await updateStoredSessionStatus({
      villageId,
      status: status.connected ? 'connected' : 'disconnected',
      waNumber: waNumber || null,
    });

    await syncChannelAccountNumber(villageId, waNumber || null);

    res.json({
      success: true,
      data: {
        ...status,
        wa_number: waNumber || null,
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

    // Sync status after disconnect
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

    // Sync status after logout
    try {
      await syncSessionState(villageId);
    } catch (e: any) {
      logger.debug('Post-logout session sync failed', { error: e?.message, village_id: villageId });
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
    const settings = await getSessionSettings();
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
    const { autoReadMessages, typingIndicator } = req.body;
    
    const result = await updateSessionSettings({
      autoReadMessages,
      typingIndicator,
    });
    
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

    // Find any other village that has this WA number connected (excluding current village)
    const existingSession = await prisma.wa_sessions.findFirst({
      where: {
        wa_number: waNumber,
        village_id: { not: villageId },
        status: 'connected',
      },
    });

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
      data: { message: 'Session dari desa lain berhasil diputuskan' },
    });
  } catch (error: any) {
    logger.error('Force disconnect error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to force disconnect',
    });
  }
}
