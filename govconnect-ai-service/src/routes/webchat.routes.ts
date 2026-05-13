/**
 * Web Chat Routes
 * HTTP endpoint untuk live chat widget di landing page
 * Memproses pesan secara synchronous dan mengembalikan respons langsung
 * 
 * IMPORTANT: Menggunakan unified-message-processor.service.ts untuk konsistensi
 * dengan WhatsApp flow. Semua logic NLU, intent detection, RAG, dll dipusatkan
 * di unified processor.
 * 
 * LIVE CHAT INTEGRATION: Messages are synced to Channel Service database
 * so they appear in Live Chat dashboard and admin can takeover.
 * 
 * ARCHITECTURE: UNIFIED PROCESSOR
 * Sama persis dengan WhatsApp - full LLM, tidak ada pattern matching.
 */

import { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { processUnifiedMessage, ProcessMessageResult } from '../services/unified-message-processor.service';
import {
  saveWebchatMessage,
  updateWebchatAIStatus,
  checkWebchatTakeover,
  getAdminMessages,
} from '../services/webchat-sync.service';
import { getStatus, onStatusUpdate } from '../services/processing-status.service';
import {
  addWebchatMessageToBatch,
  cancelWebchatBatch,
} from '../services/webchat-batcher.service';
import { getParam, getQuery } from '../utils/http';
import { internalApiKeyMatches } from '../utils/internal-auth';

// Using same unified processor as WhatsApp for consistency
logger.info('🏗️ Webchat architecture: Unified Processor (same as WhatsApp)');

async function isWebchatEnabled(villageId?: string): Promise<boolean> {
  if (!villageId) return true;

  try {
    const response = await axios.get(
      `${config.channelServiceUrl}/internal/channel-accounts/${villageId}`,
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
        },
        timeout: 3000,
      }
    );

    const enabled = response.data?.data?.enabled_webchat;
    if (typeof enabled === 'boolean') return enabled;
    return true;
  } catch (error: any) {
    // If channel account doesn't exist, treat as disabled
    if (error?.response?.status === 404) return false;
    logger.warn('Failed to check webchat channel settings, allowing by default', {
      error: error.message,
    });
    return true;
  }
}

/**
 * Process webchat message with UNIFIED PROCESSOR
 * SAMA PERSIS dengan WhatsApp - full LLM, tidak ada pattern matching
 */
async function processWebchatMessage(params: {
  userId: string;
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  village_id?: string;
  messageId?: string;
  batchedMessageIds?: string[];
}): Promise<ProcessMessageResult> {
  logger.debug('Processing webchat with UNIFIED processor (same as WhatsApp)', {
    userId: params.userId,
  });

  // Use SAME processor as WhatsApp for 100% consistency
  return processUnifiedMessage({
    userId: params.userId,
    message: params.message,
    channel: 'webchat',
    conversationHistory: params.conversationHistory,
    villageId: params.village_id,
    messageId: params.messageId,
    batchedMessageIds: params.batchedMessageIds,
  });
}

function resolveWebchatAIStatusAfterReply(params: {
  intent: string;
  replySynced: boolean;
  hasGuidance: boolean;
  guidanceSynced: boolean;
}): {
  action: 'clear' | 'error' | 'pending_balance';
  error_message?: string;
} {
  if (params.intent === 'AI_BALANCE_EXHAUSTED') {
    return { action: 'pending_balance' };
  }

  if (!params.replySynced) {
    return {
      action: 'error',
      error_message: 'Balasan AI siap, tetapi sinkronisasi ke dashboard live chat gagal.',
    };
  }

  if (params.hasGuidance && !params.guidanceSynced) {
    return {
      action: 'error',
      error_message: 'Balasan AI siap, tetapi sinkronisasi pesan panduan ke dashboard live chat gagal.',
    };
  }

  return { action: 'clear' };
}

const router = Router();

// Rate limit: max 15 messages per minute per session
const webchatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  skip: (req: Request) => internalApiKeyMatches(req.headers['x-internal-api-key']),
  keyGenerator: (req: Request) => {
    // Prioritize IP to prevent client-controlled bypass (Temuan 9)
    const forwardedIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
    const clientIp = forwardedIp || req.ip;

    if (clientIp) {
      return ipKeyGenerator(clientIp);
    }

    return req.body?.session_id || 'unknown';
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Terlalu banyak pesan, silakan tunggu sebentar.',
  },
  handler: (_req, res, _next, options) => {
    logger.warn('Webchat rate limit exceeded', { ip: _req.ip, session_id: _req.body?.session_id });
    res.status(429).json(options.message);
  },
});

async function fetchWebchatHistory(params: {
  session_id: string;
  village_id?: string;
  limit?: number;
}): Promise<Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>> {
  try {
    const response = await axios.get(`${config.channelServiceUrl}/internal/messages`, {
      params: {
        channel_identifier: params.session_id,
        channel: 'WEBCHAT',
        limit: params.limit ?? 30,
        ...(params.village_id ? { village_id: params.village_id } : {}),
      },
      headers: {
        'x-internal-api-key': config.internalApiKey,
        ...(params.village_id ? { 'x-village-id': params.village_id } : {}),
      },
      timeout: 5000,
    });

    const messages = response.data?.messages || [];
    return messages.map((m: any) => ({
      role: m.direction === 'IN' ? 'user' : 'assistant',
      content: m.message_text,
      timestamp: new Date(m.timestamp),
    }));
  } catch (error: any) {
    logger.warn('Failed to fetch webchat history from Channel Service', {
      session_id: params.session_id,
      error: error.message,
    });
    return [];
  }
}

/**
 * Process web chat message
 * POST /api/webchat
 * 
 * Menggunakan unified processor untuk konsistensi dengan WhatsApp
 */
router.post('/', webchatRateLimit, async (req: Request, res: Response) => {
  const startTime = Date.now();
  let statusSessionId: string | undefined;
  let statusVillageId: string | undefined;
  let statusMessageId: string | undefined;

  try {
    const { session_id, message, channel } = req.body;
    const village_id: string | undefined = req.body.village_id || req.body.villageId;
    statusSessionId = session_id;
    statusVillageId = village_id;
    
    if (!session_id || !message) {
      res.status(400).json({
        success: false,
        error: 'session_id dan message diperlukan',
      });
      return;
    }

    if (!village_id) {
      res.status(400).json({
        success: false,
        error: 'village_id diperlukan',
      });
      return;
    }
    
    // Validate session ID format
    if (!session_id.startsWith('web_')) {
      res.status(400).json({
        success: false,
        error: 'Format session_id tidak valid',
      });
      return;
    }

    const webchatEnabled = await isWebchatEnabled(village_id);
    if (!webchatEnabled) {
      res.json({
        success: true,
        response: 'Maaf, webchat saat ini dinonaktifkan oleh admin desa. Silakan hubungi kembali nanti.',
        intent: 'CHANNEL_DISABLED',
        processing_time_ms: Date.now() - startTime,
      });
      return;
    }
    
    logger.info('📱 Web chat message received', {
      session_id,
      messageLength: message.length,
      channel: channel || 'webchat',
      village_id,
    });

    // Check if admin has taken over this conversation
    const takeoverStatus = await checkWebchatTakeover(session_id, village_id);
    if (takeoverStatus.is_takeover) {
      // Cancel any pending batch when takeover is active
      cancelWebchatBatch(session_id);
      
      // Save user message to database but don't process with AI
      await saveWebchatMessage({
        session_id,
        village_id,
        message,
        direction: 'IN',
        source: 'USER',
      });
      
      logger.info('🛑 Webchat takeover active, skipping AI', {
        session_id,
        admin_id: takeoverStatus.admin_id,
      });
      
      res.json({
        success: true,
        response: '', // Empty response - admin will reply
        intent: 'TAKEOVER',
        metadata: {
          session_id,
          is_takeover: true,
          admin_name: takeoverStatus.admin_name,
        },
      });
      return;
    }
    
    // Build conversation history from Channel Service (stateless)
    const historyMessages = await fetchWebchatHistory({
      session_id,
      village_id,
      limit: 30,
    });
    
    const sourceMessageId = `webmsg:${session_id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

    // Save incoming message to Channel Service (for Live Chat dashboard)
    await saveWebchatMessage({
      session_id,
      village_id,
      message,
      direction: 'IN',
      source: 'USER',
      message_id: sourceMessageId,
    });
    
    // Use message batching - wait for more messages within 3 seconds
    // This combines multiple rapid messages into one AI request
    const batchResult = await addWebchatMessageToBatch(session_id, message, sourceMessageId);
    
    logger.info('📦 Webchat batch result', {
      session_id,
      isBatched: batchResult.isBatched,
      isPrimary: batchResult.isPrimary,
      messageCount: batchResult.messageCount,
      combinedLength: batchResult.combinedMessage.length,
    });
    
    // Only the primary request should process the message
    // Secondary requests (from batched messages) should NOT send any response to user
    // The primary request will handle the actual processing and response
    if (!batchResult.isPrimary) {
      logger.info('📦 [Webchat] Secondary request, returning silent acknowledgment', { session_id });
      // Return empty response - frontend should ignore this
      // This prevents duplicate/confusing messages to user
      res.json({
        success: true,
        response: '', // Empty - don't show anything to user
        guidanceText: '',
        intent: 'BATCHED_SILENT', // Frontend should ignore this
        metadata: {
          session_id,
          processingTimeMs: Date.now() - startTime,
          isBatched: true,
          isPrimary: false,
          silent: true, // Flag to indicate this should not be displayed
        },
      });
      return;
    }

    statusMessageId = batchResult.primaryMessageId;
    await updateWebchatAIStatus({
      session_id,
      village_id,
      action: 'processing',
      message_id: batchResult.primaryMessageId,
    });

    // Process batched message using selected architecture
    // This ensures consistent NLU, intent detection, RAG, prompts, etc.
    // 90s timeout to accommodate fallback chain + retry from slow free-tier models
    const WEBCHAT_TIMEOUT_MS = 90_000;
    const resultPromise = processWebchatMessage({
      userId: session_id,
      message: batchResult.combinedMessage, // Use combined message from batch
      conversationHistory: [...historyMessages, { role: 'user', content: batchResult.combinedMessage, timestamp: new Date() }].map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      village_id,
      messageId: batchResult.primaryMessageId,
      batchedMessageIds: batchResult.messageIds,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('WEBCHAT_TIMEOUT')), WEBCHAT_TIMEOUT_MS)
    );

    let result: ProcessMessageResult;
    try {
      result = await Promise.race([resultPromise, timeoutPromise]);
    } catch (timeoutErr: any) {
      if (timeoutErr.message === 'WEBCHAT_TIMEOUT') {
        logger.warn('Webchat processing timed out', { session_id, timeout: WEBCHAT_TIMEOUT_MS });
        await updateWebchatAIStatus({
          session_id,
          village_id,
          action: 'error',
          message_id: batchResult.primaryMessageId,
          error_message: 'Pemrosesan webchat melebihi batas waktu.',
        });
        res.json({
          success: true,
          response: 'Maaf, pemrosesan pesan memakan waktu terlalu lama. Silakan coba lagi.',
          intent: 'TIMEOUT',
          metadata: { session_id, processingTimeMs: Date.now() - startTime },
        });
        return;
      }
      throw timeoutErr;
    }
    
    const guidanceText = result.guidanceText?.trim() ? result.guidanceText : '';
    const hasGuidance = guidanceText.length > 0;
    const replySynced = await saveWebchatMessage({
      session_id,
      village_id,
      message: result.response,
      direction: 'OUT',
      source: 'AI',
    });

    let guidanceSynced = true;
    if (hasGuidance) {
      guidanceSynced = await saveWebchatMessage({
        session_id,
        village_id,
        message: guidanceText,
        direction: 'OUT',
        source: 'AI',
      });
    }

    const nextAIStatus = resolveWebchatAIStatusAfterReply({
      intent: result.intent,
      replySynced,
      hasGuidance,
      guidanceSynced,
    });

    if (nextAIStatus.action === 'error') {
      logger.warn('Webchat reply sync incomplete before clearing AI status', {
        session_id,
        village_id,
        replySynced,
        hasGuidance,
        guidanceSynced,
      });
    }

    await updateWebchatAIStatus({
      session_id,
      village_id,
      action: nextAIStatus.action,
      message_id: nextAIStatus.action === 'clear' ? undefined : batchResult.primaryMessageId,
      error_message: nextAIStatus.error_message,
    });

    const processingTime = Date.now() - startTime;
    
    logger.info('✅ Web chat response sent', {
      session_id,
      intent: result.intent,
      responseLength: result.response.length,
      processingTimeMs: processingTime,
    });
    
    // Format contacts for webchat: clickable WA links instead of vCard
    let webchatContacts: Array<{ name: string; phone: string; waLink: string; organization?: string; title?: string }> | undefined;
    if (result.contacts && result.contacts.length > 0) {
      webchatContacts = result.contacts.map(c => {
        const digits = (c.phone || '').replace(/\D/g, '');
        let normalized = digits;
        if (digits.startsWith('0')) normalized = `62${digits.slice(1)}`;
        else if (digits.startsWith('8')) normalized = `62${digits}`;
        return {
          name: c.name,
          phone: c.phone,
          waLink: `https://wa.me/${normalized}`,
          organization: c.organization,
          title: c.title,
        };
      });
    }

    res.json({
      success: true,
      response: result.response,
      guidanceText: result.guidanceText,
      intent: result.intent,
      contacts: webchatContacts,
      metadata: {
        session_id,
        processingTimeMs: result.metadata.processingTimeMs,
        messageCount: historyMessages.length + 1,
        model: result.metadata.model,
        hasKnowledge: result.metadata.hasKnowledge,
        knowledgeConfidence: result.metadata.knowledgeConfidence,
        sentiment: result.metadata.sentiment,
        // Batch info
        isBatched: batchResult.isBatched,
        batchedMessageCount: batchResult.messageCount,
      },
    });
    
  } catch (error: any) {
    logger.error('❌ Web chat error', {
      error: error.message,
      stack: error.stack,
    });

    if (statusSessionId) {
      await updateWebchatAIStatus({
        session_id: statusSessionId,
        village_id: statusVillageId,
        action: 'error',
        message_id: statusMessageId,
        error_message: error.message || 'Terjadi kesalahan saat memproses webchat.',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Terjadi kesalahan saat memproses pesan',
      response: 'Maaf, terjadi kesalahan. Silakan coba lagi atau hubungi kami via WhatsApp.',
    });
  }
});

/**
 * Get session stats
 * GET /api/webchat/stats
 *
 * NOTE: Must be defined BEFORE `/:session_id` to avoid Express matching
 * "stats" as a session_id parameter.
 */
router.get('/stats', (_req: Request, res: Response) => {
  res.json({
    success: true,
    activeSessions: 0,
  });
});

/**
 * Get session history
 * GET /api/webchat/:session_id
 */
router.get('/:session_id', (req: Request, res: Response) => {
  const session_id = getParam(req, 'session_id');
  if (!session_id) {
    res.status(400).json({
      success: false,
      error: 'session_id is required',
    });
    return;
  }

  const village_id = getQuery(req, 'village_id') ?? getQuery(req, 'villageId');

  fetchWebchatHistory({
    session_id,
    village_id: village_id ? String(village_id) : undefined,
    limit: 30,
  })
    .then((messages) => {
      if (!messages || messages.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Session tidak ditemukan',
        });
        return;
      }

      res.json({
        success: true,
        session: {
          session_id,
          messages,
        },
      });
    })
    .catch(() => {
      res.status(500).json({
        success: false,
        error: 'Gagal mengambil riwayat sesi',
      });
    });
});

/**
 * Clear session
 * DELETE /api/webchat/:session_id
 */
router.delete('/:session_id', (req: Request, res: Response) => {
  const session_id = getParam(req, 'session_id');
  if (!session_id) {
    res.status(400).json({
      success: false,
      error: 'session_id is required',
    });
    return;
  }

  const village_id = getQuery(req, 'village_id') ?? getQuery(req, 'villageId');

  axios
    .delete(`${config.channelServiceUrl}/internal/conversations/${encodeURIComponent(session_id)}`, {
      params: {
        channel: 'WEBCHAT',
        ...(village_id ? { village_id } : {}),
      },
      headers: {
        'x-internal-api-key': config.internalApiKey,
        ...(village_id ? { 'x-village-id': village_id } : {}),
      },
      timeout: 5000,
    })
    .then(() => {
      res.json({
        success: true,
        deleted: true,
      });
    })
    .catch((error: any) => {
      res.status(500).json({
        success: false,
        error: error.message || 'Gagal menghapus sesi',
      });
    });
});

/**
 * Poll for new messages (admin messages when takeover is active)
 * GET /api/webchat/:session_id/poll
 * 
 * This endpoint is used by webchat to check for:
 * 1. Admin takeover status
 * 2. New messages from admin
 */
router.get('/:session_id/poll', async (req: Request, res: Response) => {
  try {
    const session_id = getParam(req, 'session_id');
    if (!session_id) {
      res.status(400).json({
        success: false,
        error: 'session_id is required',
      });
      return;
    }
    const sinceRaw = getQuery(req, 'since');
    const since = sinceRaw ? new Date(sinceRaw) : undefined;

    const village_id = getQuery(req, 'village_id') ?? getQuery(req, 'villageId');

    if (!session_id.startsWith('web_')) {
      res.status(400).json({
        success: false,
        error: 'Invalid session_id format',
      });
      return;
    }

    if (!village_id) {
      res.status(400).json({
        success: false,
        error: 'village_id is required',
      });
      return;
    }

    // Check takeover status
    const takeoverStatus = await checkWebchatTakeover(session_id, village_id);

    // Get admin messages if in takeover
    let adminMessages: Array<{ message: string; admin_name?: string; timestamp: Date }> = [];
    if (takeoverStatus.is_takeover) {
      adminMessages = await getAdminMessages(session_id, since, village_id);
    }

    res.json({
      success: true,
      is_takeover: takeoverStatus.is_takeover,
      admin_name: takeoverStatus.admin_name,
      messages: adminMessages.map(m => ({
        content: m.message,
        admin_name: m.admin_name,
        timestamp: m.timestamp.toISOString(),
      })),
    });

  } catch (error: any) {
    logger.error('Poll error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to poll for messages',
    });
  }
});

router.get('/:session_id/events', async (req: Request, res: Response) => {
  const session_id = getParam(req, 'session_id');
  const village_id = getQuery(req, 'village_id') ?? getQuery(req, 'villageId');

  if (!session_id) {
    res.status(400).json({
      success: false,
      error: 'session_id is required',
    });
    return;
  }

  if (!session_id.startsWith('web_')) {
    res.status(400).json({
      success: false,
      error: 'Invalid session_id format',
    });
    return;
  }

  if (!village_id) {
    res.status(400).json({
      success: false,
      error: 'village_id is required',
    });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('connected', { sessionId: session_id, villageId: village_id, at: Date.now() });

  const takeoverStatus = await checkWebchatTakeover(session_id, String(village_id));
  send('takeover', {
    sessionId: session_id,
    is_takeover: takeoverStatus.is_takeover,
    admin_name: takeoverStatus.admin_name || null,
    at: Date.now(),
  });

  const initialStatus = getStatus(session_id);
  if (initialStatus) {
    send('processing_status', {
      sessionId: session_id,
      stage: initialStatus.stage,
      message: initialStatus.message,
      progress: initialStatus.progress,
      done: initialStatus.stage === 'completed' || initialStatus.stage === 'error',
      at: Date.now(),
    });
  }

  const statusUnsubscribe = onStatusUpdate(session_id, (status) => {
    send('processing_status', {
      sessionId: session_id,
      stage: status.stage,
      message: status.message,
      progress: status.progress,
      done: status.stage === 'completed' || status.stage === 'error',
      at: Date.now(),
    });
  });

  const channelUrl = `${config.channelServiceUrl}/internal/livechat/events`;
  const params = new URLSearchParams({
    village_id: String(village_id),
    channel: 'WEBCHAT',
    channel_identifier: session_id,
  });

  const upstream = await axios.get(`${channelUrl}?${params.toString()}`, {
    headers: {
      'x-internal-api-key': config.internalApiKey,
      'x-village-id': String(village_id),
      Accept: 'text/event-stream',
    },
    responseType: 'stream',
    timeout: 0,
  });

  let buffer = '';
  const cleanup = () => {
    statusUnsubscribe();
    upstream.data.destroy();
    clearInterval(heartbeat);
  };

  const flushEvent = (rawEvent: string) => {
    const lines = rawEvent.split(/\r?\n/);
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) return;

    try {
      const payload = JSON.parse(dataLines.join('\n'));
      if (eventName === 'message') {
        const isTakeoverMessage = payload.channel === 'WEBCHAT'
          && payload.channel_identifier === session_id
          && payload.source === 'ADMIN';
        if (!isTakeoverMessage) return;

        const timestamp = payload.timestamp || payload.sent_at || payload.at || new Date().toISOString();
        send('message', {
          sessionId: session_id,
          message_id: payload.message_id || payload.id,
          content: payload.message_text || payload.content || '',
          role: 'assistant',
          source: 'admin',
          admin_name: payload.admin_name || takeoverStatus.admin_name || null,
          timestamp,
          at: Date.now(),
        });
        return;
      }

      if (eventName === 'takeover') {
        send('takeover', {
          sessionId: session_id,
          is_takeover: true,
          admin_name: payload.admin_name || null,
          at: Date.now(),
        });
      }
    } catch (error: any) {
      logger.warn('Failed to parse webchat SSE payload', {
        session_id,
        eventName,
        error: error.message,
      });
    }
  };

  upstream.data.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const events = buffer.split(/\n\n/);
    buffer = events.pop() || '';
    for (const eventBlock of events) {
      flushEvent(eventBlock);
    }
  });

  upstream.data.on('error', (error: Error) => {
    logger.warn('Webchat SSE upstream error', { session_id, error: error.message });
    cleanup();
    if (!res.writableEnded) {
      res.end();
    }
  });

  upstream.data.on('end', () => {
    cleanup();
    if (!res.writableEnded) {
      res.end();
    }
  });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    cleanup();
  });
});

export const __test_only__ = {
  resolveWebchatAIStatusAfterReply,
};

export default router;
