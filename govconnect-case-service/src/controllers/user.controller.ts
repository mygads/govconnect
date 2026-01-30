import { Request, Response } from 'express';
import { getUserHistory } from '../services/user-history.service';
import { getParam } from '../utils/http';
import logger from '../utils/logger';

/**
 * GET /user/:wa_user_id/history
 * Get user's complaint and service request history
 */
export async function handleGetUserHistory(req: Request, res: Response) {
  try {
    const wa_user_id = getParam(req, 'wa_user_id');
    const channelRaw = (req.query.channel as string | undefined)?.toUpperCase();
    const channel = channelRaw === 'WEBCHAT' ? 'WEBCHAT' : 'WHATSAPP';
    const channelIdentifier = (req.query.session_id as string | undefined) || (req.query.channel_identifier as string | undefined);

    if (channel === 'WHATSAPP' && (!wa_user_id || !/^628\d{8,12}$/.test(wa_user_id))) {
      return res.status(400).json({
        status: 'error',
        error: 'INVALID_PHONE',
        message: 'Invalid phone number format',
      });
    }

    if (channel === 'WEBCHAT' && !channelIdentifier) {
      return res.status(400).json({
        status: 'error',
        error: 'INVALID_SESSION',
        message: 'session_id/channel_identifier diperlukan',
      });
    }

    const history = await getUserHistory({
      wa_user_id,
      channel,
      channel_identifier: channelIdentifier,
    });

    return res.json({
      status: 'success',
      data: history,
    });
  } catch (error: any) {
    logger.error('Get user history error', { error: error.message });
    return res.status(500).json({
      status: 'error',
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch user history',
    });
  }
}
