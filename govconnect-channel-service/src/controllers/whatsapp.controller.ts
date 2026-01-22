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

function resolveVillageId(req: Request): string | null {
  const queryVillageId = typeof req.query.village_id === 'string' ? req.query.village_id : null;
  const bodyVillageId = typeof req.body?.village_id === 'string' ? req.body.village_id : null;
  const headerVillageId = typeof req.headers['x-village-id'] === 'string' ? req.headers['x-village-id'] : null;
  const fallbackVillageId = process.env.DEFAULT_VILLAGE_ID || null;
  return queryVillageId || bodyVillageId || headerVillageId || fallbackVillageId;
}

async function syncChannelAccountNumber(villageId: string, waNumber?: string | null) {
  if (!waNumber) return;

  const webhookUrl = (process.env.PUBLIC_CHANNEL_BASE_URL || process.env.PUBLIC_BASE_URL || '')
    .replace(/\/$/, '');
  const webhook = webhookUrl ? `${webhookUrl}/webhook/whatsapp` : '';

  await prisma.channel_accounts.upsert({
    where: { village_id: villageId },
    create: {
      village_id: villageId,
      wa_number: waNumber,
      wa_token: '',
      webhook_url: webhook,
      enabled_wa: true,
      enabled_webchat: true,
    },
    update: {
      wa_number: waNumber,
      webhook_url: webhook,
    },
  });
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
      res.status(404).json({ success: false, error: 'Session belum dibuat' });
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
    const result = await createSessionForVillage({ villageId, adminId });

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
