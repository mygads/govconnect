/**
 * WA Support V2 Superadmin Controller
 * 
 * Provides endpoints for superadmin to view and manage wa-support-v2 users,
 * sessions, and message statistics.
 */

import { Request, Response } from 'express';
import { waSupportClient } from '../clients/wa-support.client';
import { ensureWaSupportUser } from '../services/wa.service';
import prisma from '../config/database';
import logger from '../utils/logger';
import { getQuery } from '../utils/http';

/**
 * GET /internal/wa-support/users
 * List all wa-support-v2 users for govconnect
 */
export async function listWaSupportUsers(req: Request, res: Response): Promise<void> {
  try {
    if (!waSupportClient.isConfigured()) {
      res.status(503).json({ success: false, error: 'WA Support V2 not configured' });
      return;
    }

    const page = parseInt(getQuery(req, 'page') || '1', 10);
    const limit = parseInt(getQuery(req, 'limit') || '20', 10);

    const result = await waSupportClient.listUsers({
      source: 'govconnect',
      page,
      limit: Math.min(limit, 100),
    });

    if (!result.success) {
      res.status(500).json({ success: false, error: result.error?.message || 'Failed to list users' });
      return;
    }

    res.json({ success: true, data: result.data });
  } catch (error: any) {
    logger.error('Failed to list wa-support users', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /internal/wa-support/users/:user_id
 * Get detail of a specific wa-support-v2 user including sessions
 */
export async function getWaSupportUser(req: Request, res: Response): Promise<void> {
  try {
    if (!waSupportClient.isConfigured()) {
      res.status(503).json({ success: false, error: 'WA Support V2 not configured' });
      return;
    }

    const userId = req.params.user_id;
    if (!userId) {
      res.status(400).json({ success: false, error: 'user_id is required' });
      return;
    }

    // Get stored api_key for this user from local DB
    const localSession = await prisma.wa_sessions.findFirst({
      where: { wa_support_user_id: userId },
      select: { wa_support_api_key: true, village_id: true },
    });

    // Get user info via internal API
    const userInfoResult = await waSupportClient.getUserApiKeyInfo(userId);

    // Get sessions if we have the api_key
    let sessions: any[] = [];
    if (localSession?.wa_support_api_key) {
      const sessionsResult = await waSupportClient.listCustomerSessions(localSession.wa_support_api_key);
      if (sessionsResult.success && sessionsResult.data?.sessions) {
        sessions = sessionsResult.data.sessions;
      }
    }

    res.json({
      success: true,
      data: {
        user_id: userId,
        village_id: localSession?.village_id || userId,
        user_info: userInfoResult.success ? userInfoResult.data : null,
        sessions,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get wa-support user', { error: error.message, user_id: req.params.user_id });
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /internal/wa-support/users/:user_id/sessions/:session_id/settings
 * Get session settings and message stats
 */
export async function getWaSupportSessionSettings(req: Request, res: Response): Promise<void> {
  try {
    if (!waSupportClient.isConfigured()) {
      res.status(503).json({ success: false, error: 'WA Support V2 not configured' });
      return;
    }

    const { user_id, session_id } = req.params;

    const localSession = await prisma.wa_sessions.findFirst({
      where: { wa_support_user_id: user_id },
      select: { wa_support_api_key: true },
    });

    if (!localSession?.wa_support_api_key) {
      res.status(404).json({ success: false, error: 'API key not found for this user' });
      return;
    }

    const result = await waSupportClient.getSessionSettings(localSession.wa_support_api_key, session_id);
    if (!result.success) {
      res.status(500).json({ success: false, error: result.error?.message });
      return;
    }

    res.json({ success: true, data: result.data });
  } catch (error: any) {
    logger.error('Failed to get session settings', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /internal/wa-support/summary
 * Get a summary of all wa-support users with their session status
 * Combines wa-support-v2 data with local DB data
 */
export async function getWaSupportSummary(_req: Request, res: Response): Promise<void> {
  try {
    if (!waSupportClient.isConfigured()) {
      res.status(503).json({ success: false, error: 'WA Support V2 not configured' });
      return;
    }

    // Get all wa-support users for govconnect
    const usersResult = await waSupportClient.listUsers({
      source: 'govconnect',
      limit: 100,
    });

    if (!usersResult.success) {
      res.status(500).json({ success: false, error: usersResult.error?.message });
      return;
    }

    // Get all local sessions with wa-support data
    const localSessions = await prisma.wa_sessions.findMany({
      where: { wa_support_user_id: { not: null } },
      select: {
        village_id: true,
        instance_name: true,
        wa_number: true,
        status: true,
        wa_support_user_id: true,
        wa_support_session_id: true,
        last_connected_at: true,
        created_at: true,
      },
    });

    // Map local sessions by user_id for quick lookup
    const localMap = new Map(localSessions.map((s) => [s.wa_support_user_id, s]));

    const items = (usersResult.data?.items || []).map((user: any) => ({
      ...user,
      local_session: localMap.get(user.id) || null,
    }));

    res.json({
      success: true,
      data: {
        total: usersResult.data?.meta?.total || items.length,
        items,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get wa-support summary', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /internal/wa-support/health
 * Check wa-support-v2 connectivity
 */
export async function checkWaSupportHealth(_req: Request, res: Response): Promise<void> {
  try {
    if (!waSupportClient.isConfigured()) {
      res.json({ success: true, data: { configured: false, status: 'not_configured' } });
      return;
    }

    const result = await waSupportClient.getInternalMe();
    res.json({
      success: true,
      data: {
        configured: true,
        status: result.success ? 'connected' : 'error',
        detail: result.success ? result.data : result.error?.message,
      },
    });
  } catch (error: any) {
    res.json({
      success: true,
      data: {
        configured: true,
        status: 'error',
        detail: error.message,
      },
    });
  }
}

/**
 * POST /internal/wa-support/provision
 * Auto-create wa-support-v2 user for a village (used during registration or migration).
 * Body: { village_id: string }
 */
export async function provisionWaSupportUser(req: Request, res: Response): Promise<void> {
  try {
    if (!waSupportClient.isConfigured()) {
      res.status(503).json({ success: false, error: 'WA Support V2 not configured' });
      return;
    }

    const villageId = req.body?.village_id;
    if (!villageId || typeof villageId !== 'string') {
      res.status(400).json({ success: false, error: 'village_id is required' });
      return;
    }

    const result = await ensureWaSupportUser(villageId);

    logger.info('WA Support user provisioned', { village_id: villageId, user_id: result.userId });

    res.json({
      success: true,
      data: {
        user_id: result.userId,
        provisioned: true,
      },
    });
  } catch (error: any) {
    logger.error('Failed to provision wa-support user', { error: error.message, village_id: req.body?.village_id });
    res.status(500).json({ success: false, error: error.message });
  }
}
