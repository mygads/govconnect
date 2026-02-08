import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { internalAuth } from '../middleware/auth.middleware';
import {
  handleGetComplaintCategories,
  handleCreateComplaintCategory,
  handleUpdateComplaintCategory,
  handleDeleteComplaintCategory,
  handleGetComplaintTypes,
  handleCreateComplaintType,
  handleUpdateComplaintType,
  handleDeleteComplaintType,
  handleCreateComplaintUpdate,
} from '../controllers/complaint-meta.controller';

const router: ExpressRouter = Router();

router.get('/complaints/categories', handleGetComplaintCategories);
router.post('/complaints/categories', internalAuth, handleCreateComplaintCategory);
router.patch('/complaints/categories/:id', internalAuth, handleUpdateComplaintCategory);
router.delete('/complaints/categories/:id', internalAuth, handleDeleteComplaintCategory);
router.get('/complaints/types', handleGetComplaintTypes);
router.post('/complaints/types', internalAuth, handleCreateComplaintType);
router.patch('/complaints/types/:id', internalAuth, handleUpdateComplaintType);
router.delete('/complaints/types/:id', internalAuth, handleDeleteComplaintType);
router.post('/complaints/:id/updates', internalAuth, handleCreateComplaintUpdate);

export default router;
