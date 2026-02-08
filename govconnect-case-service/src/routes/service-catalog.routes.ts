import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { query } from 'express-validator';
import { internalAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  handleGetServiceCategories,
  handleCreateServiceCategory,
  handleGetServices,
  handleSearchServices,
  handleCreateService,
  handleUpdateService,
  handleGetServiceById,
  handleGetServiceBySlug,
  handleGetRequirements,
  handleCreateRequirement,
  handleUpdateRequirement,
  handleDeleteRequirement,
  handleGetServiceRequests,
  handleCreateServiceRequest,
  handleGetServiceRequestById,
  handleUpdateServiceRequestStatus,
  handleDeleteServiceRequest,
  handleGetServiceHistory,
  handleCancelServiceRequest,
  handleGenerateServiceRequestEditToken,
  handleGetServiceRequestByToken,
  handleUpdateServiceRequestByToken,
} from '../controllers/service-catalog.controller';

const router: ExpressRouter = Router();

// Service categories
router.get('/service-categories', handleGetServiceCategories);
router.post('/service-categories', internalAuth, handleCreateServiceCategory);

// Services
router.get(
  '/services',
  [
    query('take').optional().isInt().toInt(),
    query('skip').optional().isInt().toInt(),
  ],
  validate,
  handleGetServices
);
router.get('/services/search', handleSearchServices);
router.get('/services/by-slug', handleGetServiceBySlug);
router.post('/services', internalAuth, handleCreateService);
router.get('/services/:id', handleGetServiceById);
router.put('/services/:id', internalAuth, handleUpdateService);

// Requirements
router.get('/services/:id/requirements', handleGetRequirements);
router.post('/services/:id/requirements', internalAuth, handleCreateRequirement);
router.put('/services/requirements/:id', internalAuth, handleUpdateRequirement);
router.delete('/services/requirements/:id', internalAuth, handleDeleteRequirement);

// Service requests
router.get(
  '/service-requests',
  [
    query('take').optional().isInt().toInt(),
    query('skip').optional().isInt().toInt(),
  ],
  validate,
  handleGetServiceRequests
);
router.post('/service-requests', handleCreateServiceRequest);
router.get('/service-requests/:id', handleGetServiceRequestById);
router.get('/service-requests/by-token', handleGetServiceRequestByToken);
router.patch('/service-requests/:id/status', internalAuth, handleUpdateServiceRequestStatus);
router.post('/service-requests/:id/cancel', internalAuth, handleCancelServiceRequest);
router.post('/service-requests/:id/edit-token', internalAuth, handleGenerateServiceRequestEditToken);
router.patch('/service-requests/:id/by-token', handleUpdateServiceRequestByToken);
router.delete('/service-requests/:id', internalAuth, handleDeleteServiceRequest);
router.get(
  '/service-requests/history/:wa_user_id',
  [
    query('take').optional().isInt().toInt(),
    query('skip').optional().isInt().toInt(),
  ],
  validate,
  handleGetServiceHistory
);

export default router;
