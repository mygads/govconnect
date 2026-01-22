import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
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
router.post('/complaints/categories', handleCreateComplaintCategory);
router.patch('/complaints/categories/:id', handleUpdateComplaintCategory);
router.delete('/complaints/categories/:id', handleDeleteComplaintCategory);
router.get('/complaints/types', handleGetComplaintTypes);
router.post('/complaints/types', handleCreateComplaintType);
router.patch('/complaints/types/:id', handleUpdateComplaintType);
router.delete('/complaints/types/:id', handleDeleteComplaintType);
router.post('/complaints/:id/updates', handleCreateComplaintUpdate);

export default router;
