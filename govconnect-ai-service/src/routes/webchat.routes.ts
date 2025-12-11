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
 */

import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import { processUnifiedMessage } from '../services/unified-message-processor.service';
import {
  saveWebchatMessage,
  updateWebchatConversation,
  checkWebchatTakeover,
} from '../services/webchat-sync.service';
import {
  addWebchatMessageToBatch,
  cancelWebchatBatch,
} from '../services/webchat-batcher.service';

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
    
    if (!session_id || !message) {
      res.status(400).json({
        success: false,
        error: 'session_id dan message diperlukan',
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
    
    logger.info('📱 Web chat message received', {
      session_id,
      messageLength: message.length,
      channel: channel || 'webchat',
    });

    // Check if admin has taken over this conversation
    const takeoverStatus = await checkWebchatTakeover(session_id);
    if (takeoverStatus.is_takeover) {
      // Cancel any pending batch when takeover is active
      cancelWebchatBatch(session_id);
      
      // Save user message to database but don't process with AI
      await saveWebchatMessage({
        session_id,
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
      messageCount: batchResult.messageCount,
      combinedLength: batchResult.combinedMessage.length,
    });
    
    // Process batched message using UNIFIED processor (same as WhatsApp)
    // This ensures consistent NLU, intent detection, RAG, prompts, etc.
    const result = await processUnifiedMessage({
      userId: session_id,
      message: batchResult.combinedMessage, // Use combined message from batch
      channel: 'webchat',
      conversationHistory: session.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
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
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    
    if (!session_id.startsWith('web_')) {
      res.status(400).json({
        success: false,
        error: 'Invalid session_id format',
      });
      return;
    }
    
    // Check takeover status
    const takeoverStatus = await checkWebchatTakeover(session_id);
    
    // Get admin messages if in takeover
    let adminMessages: Array<{ message: string; admin_name?: string; timestamp: Date }> = [];
    if (takeoverStatus.is_takeover) {
      const { getAdminMessages } = await import('../services/webchat-sync.service');
      adminMessages = await getAdminMessages(session_id, since);
      
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
