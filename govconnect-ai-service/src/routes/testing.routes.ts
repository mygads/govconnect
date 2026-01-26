import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import { config } from '../config/env';
import { processUnifiedMessage } from '../services/unified-message-processor.service';

const router = Router();

function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = req.headers['x-internal-api-key'];

  if (!apiKey || apiKey !== config.internalApiKey) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  next();
}

/**
 * POST /api/testing/chat
 * Testing AI response without saving chat history
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

    const testingMessage = `INSTRUKSI MODE UJI ADMIN: Jawab informatif dan relevan berdasarkan basis pengetahuan/nomor penting/profil desa. Jangan membuat link layanan kecuali diminta eksplisit untuk mengajukan layanan.\n\nPERTANYAAN: ${message}`;

    const result = await processUnifiedMessage({
      userId,
      villageId: resolvedVillageId,
      message: testingMessage,
      channel: 'other',
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
