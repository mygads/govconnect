import { Router } from 'express';
import { getMessages, sendMessage, setTyping } from '../controllers/internal.controller';
import {
  getStatus,
  connect,
  disconnect,
  logout,
  getQR,
  pair,
  getSettings,
  updateSettings,
} from '../controllers/whatsapp.controller';
import {
  handleStartTakeover,
  handleEndTakeover,
  handleGetActiveTakeovers,
  handleCheckTakeover,
  handleGetConversations,
  handleGetConversation,
  handleAdminSendMessage,
  handleMarkAsRead,
  handleDeleteConversation,
} from '../controllers/livechat.controller';
import { internalAuth } from '../middleware/auth.middleware';
import {
  validateGetMessages,
  validateSendMessage,
} from '../middleware/validation.middleware';

const router = Router();

// All internal routes require authentication
router.use(internalAuth);

/**
 * GET /internal/messages?wa_user_id=xxx&limit=30
 * Get message history for a user
 */
router.get('/messages', validateGetMessages, getMessages);

/**
 * POST /internal/send
 * Send a message via WhatsApp
 */
router.post('/send', validateSendMessage, sendMessage);

/**
 * POST /internal/typing
 * Send typing indicator
 * Body: { wa_user_id: "628xxx", state: "composing" | "paused" | "stop" }
 */
router.post('/typing', setTyping);

// =====================================================
// WhatsApp Session Management Routes
// =====================================================

/**
 * GET /internal/whatsapp/status
 * Get WhatsApp session status
 */
router.get('/whatsapp/status', getStatus);

/**
 * POST /internal/whatsapp/connect
 * Connect WhatsApp session
 */
router.post('/whatsapp/connect', connect);

/**
 * POST /internal/whatsapp/disconnect
 * Disconnect WhatsApp session (keeps session data)
 */
router.post('/whatsapp/disconnect', disconnect);

/**
 * POST /internal/whatsapp/logout
 * Logout WhatsApp session (requires QR rescan)
 */
router.post('/whatsapp/logout', logout);

/**
 * GET /internal/whatsapp/qr
 * Get QR code for authentication
 */
router.get('/whatsapp/qr', getQR);

/**
 * POST /internal/whatsapp/pairphone
 * Pair phone for authentication
 */
router.post('/whatsapp/pairphone', pair);

/**
 * GET /internal/whatsapp/settings
 * Get session settings
 */
router.get('/whatsapp/settings', getSettings);

/**
 * PATCH /internal/whatsapp/settings
 * Update session settings
 */
router.patch('/whatsapp/settings', updateSettings);

// =====================================================
// Live Chat & Takeover Routes
// =====================================================

/**
 * POST /internal/takeover/:wa_user_id
 * Start takeover for a user (admin takes control from AI)
 * Body: { admin_id: string, admin_name: string, reason?: string }
 */
router.post('/takeover/:wa_user_id', handleStartTakeover);

/**
 * DELETE /internal/takeover/:wa_user_id
 * End takeover for a user (return control to AI)
 */
router.delete('/takeover/:wa_user_id', handleEndTakeover);

/**
 * GET /internal/takeover
 * Get all active takeover sessions
 */
router.get('/takeover', handleGetActiveTakeovers);

/**
 * GET /internal/takeover/:wa_user_id/status
 * Check if a user is in takeover mode
 */
router.get('/takeover/:wa_user_id/status', handleCheckTakeover);

/**
 * GET /internal/conversations
 * Get all conversations
 * Query: { status?: 'all' | 'ai' | 'takeover' }
 */
router.get('/conversations', handleGetConversations);

/**
 * GET /internal/conversations/:wa_user_id
 * Get a specific conversation with message history
 */
router.get('/conversations/:wa_user_id', handleGetConversation);

/**
 * POST /internal/conversations/:wa_user_id/send
 * Send a message to a user (admin sending)
 * Body: { message: string }
 */
router.post('/conversations/:wa_user_id/send', handleAdminSendMessage);

/**
 * POST /internal/conversations/:wa_user_id/read
 * Mark a conversation as read
 */
router.post('/conversations/:wa_user_id/read', handleMarkAsRead);

/**
 * DELETE /internal/conversations/:wa_user_id
 * Delete conversation and all message history for a user
 */
router.delete('/conversations/:wa_user_id', handleDeleteConversation);

export default router;
