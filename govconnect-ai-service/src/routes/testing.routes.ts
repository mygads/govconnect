import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
import { processWebchatWithNLU } from '../services/nlu-webchat.service';
import { firstHeader } from '../utils/http';

// NLU-based processor is now the only architecture

const router = Router();

function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);

  if (!apiKey || apiKey !== config.internalApiKey) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  next();
}

/**
 * POST /api/testing/chat
 * Testing AI response using the same NLU processor as webchat
 * This ensures consistency between testing and actual webchat experience
 */
router.post('/chat', verifyInternalKey, async (req: Request, res: Response) => {
  try {
    const { message, village_id, villageId, user_id } = req.body || {};
    const resolvedVillageId: string | undefined = typeof village_id === 'string' && village_id.length > 0
      ? village_id
      : typeof villageId === 'string' && villageId.length > 0
        ? villageId
        : undefined;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message wajib diisi' });
    }

    const userId = typeof user_id === 'string' && user_id.length > 0
      ? user_id
      : `test_admin_${Date.now()}`;

    logger.info('🧪 Testing chat request', {
      userId,
      village_id: resolvedVillageId,
      messageLength: message.length,
      processor: 'NLU',
    });

    // Use NLU processor for consistent results
    const result = await processWebchatWithNLU({
      userId,
      message,
      village_id: resolvedVillageId,
      conversationHistory: [],
    });

    return res.json({
      success: result.success,
      data: result,
    });
  } catch (error: any) {
    logger.error('Testing chat error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Testing chat failed',
      details: error.message,
    });
  }
});

export default router;
