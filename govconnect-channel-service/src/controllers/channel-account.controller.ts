import { Request, Response } from 'express';
import prisma from '../config/database';
import logger from '../utils/logger';

function buildWebhookUrl(): string {
  const baseUrl = process.env.PUBLIC_CHANNEL_BASE_URL || process.env.PUBLIC_BASE_URL || '';
  if (!baseUrl) return '';
  return `${baseUrl.replace(/\/$/, '')}/webhook/whatsapp`;
}

export async function handleGetChannelAccount(req: Request, res: Response) {
  try {
    const { village_id } = req.params;
    const account = await prisma.channel_accounts.findUnique({
      where: { village_id },
    });

    if (!account) {
      return res.status(404).json({ error: 'Channel account not found' });
    }

    return res.json({ data: account });
  } catch (error: any) {
    logger.error('Get channel account error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function handleUpsertChannelAccount(req: Request, res: Response) {
  try {
    const { village_id } = req.params;
    const {
      wa_number,
      enabled_wa,
      enabled_webchat,
    } = req.body;

    const webhookUrl = buildWebhookUrl();

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
        enabled_wa: enabled_wa ?? true,
        enabled_webchat: enabled_webchat ?? true,
      },
      update: {
        wa_number: typeof wa_number === 'string' ? wa_number : (existing?.wa_number || ''),
        webhook_url: webhookUrl,
        enabled_wa: enabled_wa ?? true,
        enabled_webchat: enabled_webchat ?? true,
      },
    });

    return res.json({ data: account });
  } catch (error: any) {
    logger.error('Upsert channel account error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
