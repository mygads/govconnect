import { Request, Response } from 'express';
import { getUserHistory } from '../services/user-history.service';
import logger from '../utils/logger';

/**
 * GET /user/:wa_user_id/history
 * Get user's complaint and service request history
 */
export async function handleGetUserHistory(req: Request, res: Response) {
  try {
    const { wa_user_id } = req.params;

    if (!wa_user_id || !/^628\d{8,12}$/.test(wa_user_id)) {
      return res.status(400).json({
        status: 'error',
        error: 'INVALID_PHONE',
        message: 'Invalid phone number format',
      });
    }

    const history = await getUserHistory(wa_user_id);

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
