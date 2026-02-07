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
import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { processUnifiedMessage, ProcessMessageResult } from '../services/unified-message-processor.service';
import {
  saveWebchatMessage,
  updateWebchatConversation,
  checkWebchatTakeover,
  getAdminMessages,
} from '../services/webchat-sync.service';
import {
  addWebchatMessageToBatch,
  cancelWebchatBatch,
} from '../services/webchat-batcher.service';
import { getParam, getQuery } from '../utils/http';

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
  });
}

const router = Router();

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
router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { session_id, message, channel } = req.body;
    const village_id: string | undefined = req.body.village_id || req.body.villageId;
    
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
    
    // Save incoming message to Channel Service (for Live Chat dashboard)
    saveWebchatMessage({
      session_id,
      village_id,
      message,
      direction: 'IN',
      source: 'USER',
    }).catch(() => {}); // Don't block on sync failure
    
    // Use message batching - wait for more messages within 3 seconds
    // This combines multiple rapid messages into one AI request
    const batchResult = await addWebchatMessageToBatch(session_id, message);
    
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
    
    // Process batched message using selected architecture
    // This ensures consistent NLU, intent detection, RAG, prompts, etc.
    const result = await processWebchatMessage({
      userId: session_id,
      message: batchResult.combinedMessage, // Use combined message from batch
      conversationHistory: [...historyMessages, { role: 'user', content: batchResult.combinedMessage, timestamp: new Date() }].map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      village_id,
    });
    
    // Save AI response to Channel Service (for Live Chat dashboard)
    saveWebchatMessage({
      session_id,
      village_id,
      message: result.response,
      direction: 'OUT',
      source: 'AI',
    }).catch(() => {}); // Don't block on sync failure

    if (result.guidanceText && result.guidanceText.trim()) {
      saveWebchatMessage({
        session_id,
        village_id,
        message: result.guidanceText,
        direction: 'OUT',
        source: 'AI',
      }).catch(() => {});
    }
    
    // Update conversation in Channel Service
    const latestMessage = result.guidanceText && result.guidanceText.trim()
      ? result.guidanceText
      : result.response;
    updateWebchatConversation({
      session_id,
      last_message: latestMessage.substring(0, 100),
      unread_count: 0,
    }).catch(() => {}); // Don't block on sync failure
    
    const processingTime = Date.now() - startTime;
    
    logger.info('✅ Web chat response sent', {
      session_id,
      intent: result.intent,
      responseLength: result.response.length,
      processingTimeMs: processingTime,
    });
    
    res.json({
      success: true,
      response: result.response,
      guidanceText: result.guidanceText,
      intent: result.intent,
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
    
    res.status(500).json({
      success: false,
      error: 'Terjadi kesalahan saat memproses pesan',
      response: 'Maaf, terjadi kesalahan. Silakan coba lagi atau hubungi kami via WhatsApp.',
    });
  }
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
 * Get session stats
 * GET /api/webchat/stats
 */
router.get('/stats', (_req: Request, res: Response) => {
  res.json({
    success: true,
    activeSessions: 0,
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

export default router;
