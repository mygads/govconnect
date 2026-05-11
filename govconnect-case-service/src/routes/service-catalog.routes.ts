import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { body, query } from 'express-validator';
import { internalAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  handleGetServiceCategories,
  handleCreateServiceCategory,
  handleUpdateServiceCategory,
  handleDeleteServiceCategory,
  handleGetServices,
  handleSearchServices,
  handleCreateService,
  handleUpdateService,
  handleDeleteService,
  handleGetServiceById,
  handleGetServiceBySlug,
  handleGetRequirements,
  handleCreateRequirement,
  handleUpdateRequirement,
  handleDeleteRequirement,
  handleGetServiceRequests,
  handleCreateServiceRequest,
  handleGetServiceRequestById,
  handleCheckServiceRequestStatus,
  handleUpdateServiceRequestStatus,
  handleDeleteServiceRequest,
  handleGetServiceHistory,
  handleCancelServiceRequest,
  handleGenerateServiceRequestEditToken,
  handleGetServiceRequestByToken,
  handleUpdateServiceRequestByToken,
  handleSoftDeleteServiceRequest,
  handleRestoreServiceRequest,
  handleGetDeletedServiceRequests,
} from '../controllers/service-catalog.controller';

const router: ExpressRouter = Router();

// Service categories
router.get('/service-categories', handleGetServiceCategories);
router.post('/service-categories', internalAuth, handleCreateServiceCategory);
router.patch('/service-categories/:id', internalAuth, handleUpdateServiceCategory);
router.delete('/service-categories/:id', internalAuth, handleDeleteServiceCategory);

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
router.delete('/services/:id', internalAuth, handleDeleteService);

// Requirements
router.get('/services/:id/requirements', handleGetRequirements);
router.post('/services/:id/requirements', internalAuth, handleCreateRequirement);
router.put('/services/requirements/:id', internalAuth, handleUpdateRequirement);
router.delete('/services/requirements/:id', internalAuth, handleDeleteRequirement);

// Service requests
router.get(
  '/service-requests',
  internalAuth,
  [
    query('search').optional().isString().trim(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
  ],
  validate,
  handleGetServiceRequests
);
router.post(
  '/service-requests',
  [
    body('service_id').isString().trim().notEmpty().withMessage('service_id is required'),
    body('village_id').optional().isString().trim(),
    body('wa_user_id').optional().isString().trim(),
    body('session_id').optional().isString().trim(),
    body('channel_identifier').optional().isString().trim(),
    body('citizen_data_json').optional().isObject(),
    body('requirement_data_json').optional().isObject(),
  ],
  validate,
  handleCreateServiceRequest
);
router.get('/service-requests/deleted', internalAuth, handleGetDeletedServiceRequests);
router.get('/service-requests/by-token', handleGetServiceRequestByToken);
router.get('/service-requests/:id', internalAuth, handleGetServiceRequestById);
router.post(
  '/service-requests/:id/check',
  internalAuth,
  [
    body('wa_user_id').optional().matches(/^(628\d{8,12}|web_[a-z0-9_]+)$/i).withMessage('Invalid user ID format'),
  ],
  validate,
  handleCheckServiceRequestStatus
);
router.patch('/service-requests/:id/status', internalAuth, handleUpdateServiceRequestStatus);
router.patch('/service-requests/:id/soft-delete', internalAuth, handleSoftDeleteServiceRequest);
router.patch('/service-requests/:id/restore', internalAuth, handleRestoreServiceRequest);
router.post(
  '/service-requests/:id/cancel',
  internalAuth,
  [
    body('wa_user_id').optional().matches(/^(628\d{8,12}|web_[a-z0-9_]+)$/i).withMessage('Invalid user ID format'),
    body('cancel_reason').optional().isString(),
  ],
  validate,
  handleCancelServiceRequest
);
router.post('/service-requests/:id/edit-token', internalAuth, handleGenerateServiceRequestEditToken);
router.patch(
  '/service-requests/:id/by-token',
  [
    body('edit_token').isString().trim().notEmpty().withMessage('edit_token is required'),
    body('wa_user_id').optional().isString().trim(),
    body('session_id').optional().isString().trim(),
    body('channel_identifier').optional().isString().trim(),
    body('citizen_data_json').optional().isObject(),
    body('requirement_data_json').optional().isObject(),
  ],
  validate,
  handleUpdateServiceRequestByToken
);
router.delete('/service-requests/:id', internalAuth, handleDeleteServiceRequest);
router.get(
  '/service-requests/history/:wa_user_id',
  internalAuth,
  [
    query('take').optional().isInt().toInt(),
    query('skip').optional().isInt().toInt(),
  ],
  validate,
  handleGetServiceHistory
);

export default router;
