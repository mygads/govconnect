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
} from '../services/wa.service';
import logger from '../utils/logger';

/**
 * Get WhatsApp session status
 * GET /internal/whatsapp/status
 */
export async function getStatus(_req: Request, res: Response): Promise<void> {
  try {
    const status = await getSessionStatus();
    res.json({
      success: true,
      data: status,
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
 * Connect WhatsApp session
 * POST /internal/whatsapp/connect
 */
export async function connect(_req: Request, res: Response): Promise<void> {
  try {
    const result = await connectSession();
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
    const result = await disconnectSession();
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
    const result = await logoutSession();
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
    const result = await getQRCode();
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
    
    if (!Phone) {
      res.status(400).json({
        success: false,
        error: 'Phone number is required',
      });
      return;
    }

    const result = await pairPhone(Phone);
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
