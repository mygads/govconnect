import { Router, Request, Response, NextFunction } from 'express';
import type { Router as ExpressRouter } from 'express';
import multer from 'multer';
import { getMessages, sendMessage, setTyping, markMessagesRead, storeMessage, updateUserProfile } from '../controllers/internal.controller';
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
  handleRetryAI,
} from '../controllers/livechat.controller';
import {
  getStatus,
  connect,
  disconnect,
  logout,
  getQR,
  pair,
  getSettings,
  updateSettings,
  createSession,
  deleteSession,
  checkDuplicateWaNumber,
  forceDisconnectOtherVillage,
} from '../controllers/whatsapp.controller';
import {
  handleGetChannelAccount,
  handleListChannelAccounts,
  handleUpsertChannelAccount,
} from '../controllers/channel-account.controller';
import { handleUploadMedia } from '../controllers/media-upload.controller';
import { internalAuth } from '../middleware/auth.middleware';
import { uploadPublicMedia } from '../middleware/upload.middleware';
import {
  validateGetMessages,
  validateSendMessage,
} from '../middleware/validation.middleware';

const router: ExpressRouter = Router();

// All internal routes require authentication
router.use(internalAuth);

// Message routes
router.get('/messages', validateGetMessages, getMessages);
router.post('/messages', storeMessage);  // Store AI reply in database
router.post('/send', validateSendMessage, sendMessage);
router.post('/typing', setTyping);
router.post('/messages/read', markMessagesRead);
router.patch('/conversations/user-profile', updateUserProfile);  // Update user name/phone from AI

// WhatsApp Session Management Routes
router.get('/whatsapp/status', getStatus);
router.post('/whatsapp/connect', connect);
router.post('/whatsapp/disconnect', disconnect);
router.post('/whatsapp/logout', logout);
router.get('/whatsapp/qr', getQR);
router.post('/whatsapp/pairphone', pair);
router.get('/whatsapp/settings', getSettings);
router.patch('/whatsapp/settings', updateSettings);
router.post('/whatsapp/session', createSession);
router.delete('/whatsapp/session', deleteSession);
router.get('/whatsapp/check-duplicate', checkDuplicateWaNumber);
router.post('/whatsapp/force-disconnect', forceDisconnectOtherVillage);

// Live Chat & Takeover Routes
router.post('/takeover/:wa_user_id', handleStartTakeover);
router.delete('/takeover/:wa_user_id', handleEndTakeover);
router.get('/takeover', handleGetActiveTakeovers);
router.get('/takeover/:wa_user_id/status', handleCheckTakeover);
router.get('/conversations', handleGetConversations);
router.get('/conversations/:wa_user_id', handleGetConversation);
router.post('/conversations/:wa_user_id/send', handleAdminSendMessage);
router.post('/conversations/:wa_user_id/read', handleMarkAsRead);
router.post('/conversations/:wa_user_id/retry', handleRetryAI);
router.delete('/conversations/:wa_user_id', handleDeleteConversation);

// Channel account settings per village
router.get('/channel-accounts', handleListChannelAccounts);
router.get('/channel-accounts/:village_id', handleGetChannelAccount);
router.put('/channel-accounts/:village_id', handleUpsertChannelAccount);

// Media upload (used by Dashboard public form & admin updates)
// Wrap multer in error handler to return JSON on upload errors
router.post('/media/upload', (req: Request, res: Response, next: NextFunction): void => {
  uploadPublicMedia.single('file')(req, res, (err: any) => {
    if (err) {
      // Handle multer errors (file size, file type, etc.)
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ success: false, error: 'Ukuran file maksimal 5MB' });
          return;
        }
        res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
        return;
      }
      // Handle custom errors (from fileFilter)
      res.status(400).json({ success: false, error: err.message || 'Gagal upload file' });
      return;
    }
    next();
  });
}, handleUploadMedia);

export default router;
