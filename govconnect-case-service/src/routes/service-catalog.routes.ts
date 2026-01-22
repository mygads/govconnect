import { Router } from 'express';
import {
  handleGetServiceCategories,
  handleCreateServiceCategory,
  handleGetServices,
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

const router = Router();

// Service categories
router.get('/service-categories', handleGetServiceCategories);
router.post('/service-categories', handleCreateServiceCategory);

// Services
router.get('/services', handleGetServices);
router.get('/services/by-slug', handleGetServiceBySlug);
router.post('/services', handleCreateService);
router.get('/services/:id', handleGetServiceById);
router.put('/services/:id', handleUpdateService);

// Requirements
router.get('/services/:id/requirements', handleGetRequirements);
router.post('/services/:id/requirements', handleCreateRequirement);
router.put('/services/requirements/:id', handleUpdateRequirement);
router.delete('/services/requirements/:id', handleDeleteRequirement);

// Service requests
router.get('/service-requests', handleGetServiceRequests);
router.post('/service-requests', handleCreateServiceRequest);
router.get('/service-requests/:id', handleGetServiceRequestById);
router.get('/service-requests/by-token', handleGetServiceRequestByToken);
router.patch('/service-requests/:id/status', handleUpdateServiceRequestStatus);
router.post('/service-requests/:id/cancel', handleCancelServiceRequest);
router.post('/service-requests/:id/edit-token', handleGenerateServiceRequestEditToken);
router.patch('/service-requests/:id/by-token', handleUpdateServiceRequestByToken);
router.delete('/service-requests/:id', handleDeleteServiceRequest);
router.get('/service-requests/history/:wa_user_id', handleGetServiceHistory);

export default router;
