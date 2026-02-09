import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';
import { config } from '../config/env';
import { processUnifiedMessage } from '../services/unified-message-processor.service';
import { extractAndRecord } from '../services/token-usage.service';
import { apiKeyManager, isRateLimitError } from '../services/api-key-manager.service';
import { firstHeader } from '../utils/http';

// Using same unified processor as WhatsApp for consistency

const router = Router();

// Timeout for ping calls (10 seconds)
const PING_TIMEOUT_MS = 10_000;

function verifyInternalKey(req: Request, res: Response, next: Function) {
  const apiKey = firstHeader(req.headers['x-internal-api-key']);

  if (!apiKey || apiKey !== config.internalApiKey) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  next();
}

/**
 * POST /api/testing/ping
 * Lightweight LLM connectivity check — sends a tiny prompt to Gemini
 * and verifies the response. Uses minimal tokens (~20 tokens total).
 */
router.post('/ping', verifyInternalKey, async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();

    // Use the cheapest model available via BYOK key rotation
    const microModels = ['gemini-2.0-flash-lite', 'gemini-2.5-flash-lite'];
    const callPlan = apiKeyManager.getCallPlan(microModels, microModels);

    // Fallback to .env key if no BYOK keys
    if (callPlan.length === 0 && config.geminiApiKey) {
      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      callPlan.push({
        key: { genAI, apiKey: config.geminiApiKey, keyName: 'env', keyId: null, isByok: false, tier: 'env' },
        model: 'gemini-2.0-flash-lite',
      });
    }

    if (callPlan.length === 0) {
      return res.status(503).json({
        success: false,
        error: 'No API keys available',
      });
    }

    // Try each key/model until one succeeds
    let lastError = '';
    for (const { key, model: modelName } of callPlan) {
      try {
        const geminiModel = key.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 10,
          },
        });

        const result = await Promise.race([
          geminiModel.generateContent('Reply with just: OK'),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Ping timeout after ${PING_TIMEOUT_MS}ms`)), PING_TIMEOUT_MS)
          ),
        ]);

        const responseText = result.response.text().trim();
        const elapsed = Date.now() - startTime;

        // Record BYOK usage
        if (key.isByok && key.keyId) {
          const usage = result.response.usageMetadata;
          apiKeyManager.recordSuccess(key.keyId);
          apiKeyManager.recordUsage(key.keyId, modelName, usage?.promptTokenCount ?? 0, usage?.totalTokenCount ?? 0);
        }

        // Record token usage (minimal — ~20 tokens)
        extractAndRecord(result, modelName, 'micro_nlu', 'connection_test', {
          success: true,
          duration_ms: elapsed,
          key_source: key.isByok ? 'byok' : 'env',
          key_id: key.keyId,
          key_tier: key.tier,
        });

        logger.info('✅ LLM ping successful', {
          model: modelName,
          keyName: key.keyName,
          responseTime: elapsed,
          response: responseText,
        });

        return res.json({
          success: true,
          model: modelName,
          responseTime: elapsed,
          response: responseText,
          keySource: key.isByok ? 'byok' : 'env',
        });
      } catch (err: any) {
        lastError = err.message || 'Unknown error';
        logger.warn('⚠️ LLM ping attempt failed', {
          model: modelName,
          keyName: key.keyName,
          error: lastError,
        });
        // Mark rate-limited model at capacity so getCallPlan skips it
        if (isRateLimitError(lastError) && key.isByok && key.keyId) {
          apiKeyManager.recordRateLimit(key.keyId, modelName, key.tier);
        }
        continue;
      }
    }

    // All attempts failed
    return res.status(503).json({
      success: false,
      error: 'All LLM ping attempts failed',
      details: lastError,
      responseTime: Date.now() - startTime,
    });
  } catch (error: any) {
    logger.error('LLM ping error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Ping failed',
      details: error.message,
    });
  }
});

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
      processor: 'UNIFIED',
    });

    // Use SAME unified processor as WhatsApp for consistent results
    const result = await processUnifiedMessage({
      userId,
      message,
      channel: 'webchat',
      villageId: resolvedVillageId,
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
