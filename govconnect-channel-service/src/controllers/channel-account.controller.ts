import { Request, Response } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';
import { getParam, getQuery } from '../utils/http';
import { checkObjectStorageHealth } from '../services/object-storage.service';

function buildWebhookUrl(): string {
  const baseUrl = process.env.PUBLIC_CHANNEL_BASE_URL || process.env.PUBLIC_BASE_URL || '';
  if (!baseUrl) return '';
    return `${baseUrl.replace(/\/$/, '')}/webhook`;
}

export async function handleGetChannelAccount(req: Request, res: Response) {
  try {
    const village_id = getParam(req, 'village_id');
    if (!village_id) {
      return res.status(400).json({ error: 'village_id is required' });
    }
    const account = await prisma.channel_accounts.findUnique({
      where: { village_id },
    });

    const webhookUrl = buildWebhookUrl();
    const objectStorage = await checkObjectStorageHealth({ includeUsage: false });
    const data = account
      ? {
          ...account,
          webhook_url: account.webhook_url || webhookUrl,
          object_storage: objectStorage,
        }
      : {
          village_id,
          wa_number: '',
          wa_token: '',
          webhook_url: webhookUrl,
          enabled_wa: false,
          enabled_webchat: false,
          reply_delay_seconds: 0,
          object_storage: objectStorage,
        };
    return res.json({ data });
  } catch (error: any) {
    logger.error('Get channel account error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpsertChannelAccount(req: Request, res: Response) {
  try {
    const village_id = getParam(req, 'village_id');
    if (!village_id) {
      return res.status(400).json({ error: 'village_id is required' });
    }
    const {
      wa_number,
      enabled_wa,
      enabled_webchat,
      reply_delay_seconds,
    } = req.body;

    const webhookUrl = buildWebhookUrl();

    // Clamp delay to a sane range (0–60s). undefined → keep existing/default.
    const normalizeDelay = (raw: unknown, fallback: number): number => {
      if (raw === undefined || raw === null || raw === '') return fallback;
      const n = Math.floor(Number(raw));
      if (!Number.isFinite(n)) return fallback;
      return Math.max(0, Math.min(60, n));
    };

    const existing = await prisma.channel_accounts.findUnique({
      where: { village_id },
    });

    const account = await prisma.channel_accounts.upsert({
      where: { village_id },
      create: {
        village_id,
        wa_number: typeof wa_number === 'string' ? wa_number : '',
        wa_token: existing?.wa_token || '',
        webhook_url: webhookUrl,
        enabled_wa: enabled_wa ?? false,
        enabled_webchat: enabled_webchat ?? false,
        reply_delay_seconds: normalizeDelay(reply_delay_seconds, 0),
      },
      update: {
        wa_number: typeof wa_number === 'string' ? wa_number : (existing?.wa_number || ''),
        webhook_url: webhookUrl,
        enabled_wa: enabled_wa ?? existing?.enabled_wa ?? false,
        enabled_webchat: enabled_webchat ?? existing?.enabled_webchat ?? false,
        reply_delay_seconds: normalizeDelay(reply_delay_seconds, existing?.reply_delay_seconds ?? 0),
      },
    });

    return res.json({ data: account });
  } catch (error: any) {
    logger.error('Upsert channel account error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleListChannelAccounts(req: Request, res: Response) {
  try {
    const enabledWebchatRaw = getQuery(req, 'enabled_webchat');
    const enabledWebchat =
      enabledWebchatRaw === 'true' ? true : enabledWebchatRaw === 'false' ? false : undefined;

    const accounts = await prisma.channel_accounts.findMany({
      where: {
        ...(typeof enabledWebchat === 'boolean' ? { enabled_webchat: enabledWebchat } : {}),
      },
      select: {
        village_id: true,
        enabled_webchat: true,
        enabled_wa: true,
        wa_number: true,
      },
      orderBy: {
        village_id: 'asc',
      },
    });

    return res.json({ data: accounts });
  } catch (error: any) {
    logger.error('List channel accounts error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
