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
 * ARCHITECTURE OPTIONS:
 * - Single-Layer: Uses unified-message-processor (default)
 * - 2-Layer: Uses two-layer-orchestrator (set USE_2_LAYER_ARCHITECTURE=true)
 * 
 * NOTE: USE_2_LAYER_ARCHITECTURE controls BOTH WhatsApp AND Webchat channels
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { processUnifiedMessage, ProcessMessageResult } from '../services/unified-message-processor.service';
import { processTwoLayerWebchat } from '../services/two-layer-webchat.service';
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
import { firstQuery } from '../utils/http';

// Unified architecture flag - controls BOTH WhatsApp AND Webchat
const USE_2_LAYER_ARCHITECTURE = process.env.USE_2_LAYER_ARCHITECTURE === 'true';

logger.info('🏗️ Webchat architecture selected', {
  architecture: USE_2_LAYER_ARCHITECTURE ? '2-Layer LLM' : 'Single Layer',
  envVar: 'USE_2_LAYER_ARCHITECTURE',
  note: 'Same architecture as WhatsApp channel',
});

const DEFAULT_VILLAGE_ID = process.env.DEFAULT_VILLAGE_ID || '';

async function isWebchatEnabled(villageId?: string): Promise<boolean> {
  const resolvedVillageId = villageId || DEFAULT_VILLAGE_ID;
  if (!resolvedVillageId) return true;

  try {
    const response = await axios.get(
      `${config.channelServiceUrl}/internal/channel-accounts/${resolvedVillageId}`,
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
 * Process webchat message with selected architecture
 * Supports both Single-Layer and 2-Layer architectures
 * Architecture is controlled by USE_2_LAYER_ARCHITECTURE env var (same as WhatsApp)
 */
async function processWebchatMessage(params: {
  userId: string;
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  village_id?: string;
}): Promise<ProcessMessageResult> {
  if (USE_2_LAYER_ARCHITECTURE) {
    // Use 2-Layer architecture (same as WhatsApp)
    logger.debug('Processing webchat with 2-Layer architecture', {
      userId: params.userId,
    });
    
    return processTwoLayerWebchat({
      userId: params.userId,
      message: params.message,
      conversationHistory: params.conversationHistory,
      village_id: params.village_id,
    });
  }
  
  // Use unified processor (single-layer) for webchat
  return processUnifiedMessage({
    userId: params.userId,
    message: params.message,
    channel: 'webchat',
    conversationHistory: params.conversationHistory,
    villageId: params.village_id,
  });
}

const router = Router();

// In-memory store untuk web chat sessions
// Dalam production, gunakan Redis atau database
const webChatSessions = new Map<string, {
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>;
  createdAt: Date;
  lastActivity: Date;
}>();

// Cleanup old sessions (older than 24 hours)
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [sessionId, session] of webChatSessions.entries()) {
    if (now - session.lastActivity.getTime() > maxAge) {
      webChatSessions.delete(sessionId);
      logger.info('Cleaned up old web chat session', { sessionId });
    }
  }
}, 60 * 60 * 1000); // Run every hour

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
    
    // Get or create session
    let session = webChatSessions.get(session_id);
    if (!session) {
      session = {
        messages: [],
        createdAt: new Date(),
        lastActivity: new Date(),
      };
      webChatSessions.set(session_id, session);
    }
    
    // Add user message to session immediately (for history)
    session.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });
    session.lastActivity = new Date();
    
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
      conversationHistory: session.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      village_id,
    });
    
    // Add assistant response to session
    session.messages.push({
      role: 'assistant',
      content: result.response,
      timestamp: new Date(),
    });
    
    // Save AI response to Channel Service (for Live Chat dashboard)
    saveWebchatMessage({
      session_id,
      village_id,
      message: result.response,
      direction: 'OUT',
      source: 'AI',
    }).catch(() => {}); // Don't block on sync failure
    
    // Update conversation in Channel Service
    updateWebchatConversation({
      session_id,
      last_message: result.response.substring(0, 100),
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
        messageCount: session.messages.length,
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
  const { session_id } = req.params;
  
  const session = webChatSessions.get(session_id);
  
  if (!session) {
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
      messages: session.messages,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
    },
  });
});

/**
 * Clear session
 * DELETE /api/webchat/:session_id
 */
router.delete('/:session_id', (req: Request, res: Response) => {
  const { session_id } = req.params;
  
  const deleted = webChatSessions.delete(session_id);
  
  res.json({
    success: true,
    deleted,
  });
});

/**
 * Get session stats
 * GET /api/webchat/stats
 */
router.get('/stats', (_req: Request, res: Response) => {
  res.json({
    success: true,
    activeSessions: webChatSessions.size,
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
    const { session_id } = req.params;
    const sinceRaw = firstQuery((req.query as any)?.since);
    const since = sinceRaw ? new Date(sinceRaw) : undefined;

    const village_id = firstQuery((req.query as any)?.village_id ?? (req.query as any)?.villageId);
    
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
      
      // Add admin messages to local session for consistency
      const session = webChatSessions.get(session_id);
      if (session && adminMessages.length > 0) {
        for (const msg of adminMessages) {
          // Check if message already exists in session
          const exists = session.messages.some(
            m => m.role === 'assistant' && m.content === msg.message && 
                 Math.abs(m.timestamp.getTime() - msg.timestamp.getTime()) < 1000
          );
          if (!exists) {
            session.messages.push({
              role: 'assistant',
              content: msg.message,
              timestamp: msg.timestamp,
            });
          }
        }
        session.lastActivity = new Date();
      }
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
