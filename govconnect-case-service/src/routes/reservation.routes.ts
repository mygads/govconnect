import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  handleGetAllServices,
  handleGetActiveServices,
  handleGetServiceByCode,
  handleToggleServiceActive,
  handleToggleServiceOnline,
  handleUpdateServiceSettings,
  handleGetAvailableSlots,
  handleCreateReservation,
  handleGetReservations,
  handleGetReservationById,
  handleCheckReservationStatus,
  handleUpdateReservationStatus,
  handleCancelReservation,
  handleUpdateReservationTime,
  handleGetReservationStatistics,
  handleGetUserHistory,
} from '../controllers/reservation.controller';
import { internalAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';

const router: Router = Router();

// ==================== SERVICE ROUTES ====================

// Get all services (admin)
router.get('/services', handleGetAllServices);

// Get active services only (public)
router.get('/services/active', handleGetActiveServices);

// Get service by code
router.get('/services/:code', handleGetServiceByCode);

// Toggle service active (admin)
router.patch(
  '/services/:code/toggle-active',
  [
    param('code').isString(),
    body('is_active').isBoolean(),
  ],
  validate,
  handleToggleServiceActive
);

// Toggle service online availability (admin)
router.patch(
  '/services/:code/toggle-online',
  [
    param('code').isString(),
    body('is_online_available').isBoolean(),
  ],
  validate,
  handleToggleServiceOnline
);

// Update service settings (admin)
router.patch(
  '/services/:code/settings',
  [
    param('code').isString(),
    body('daily_quota').optional().isInt({ min: 1 }),
    body('operating_hours').optional().isObject(),
  ],
  validate,
  handleUpdateServiceSettings
);

// ==================== SLOT AVAILABILITY ====================

// Get available slots for a date
router.get(
  '/slots/:code/:date',
  [
    param('code').isString(),
    param('date').isISO8601(),
  ],
  validate,
  handleGetAvailableSlots
);

// ==================== RESERVATION ROUTES ====================

// Create reservation (from AI Service)
router.post(
  '/create',
  internalAuth,
  [
    // Accept WhatsApp phone (628xxx) or webchat session (web_xxx)
    body('wa_user_id').matches(/^(628\d{8,12}|web_[a-z0-9_]+)$/i).withMessage('Invalid user ID format'),
    body('service_code').isString().withMessage('service_code is required'),
    body('citizen_data').isObject().withMessage('citizen_data must be an object'),
    body('citizen_data.nama_lengkap').isString().withMessage('nama_lengkap is required'),
    body('citizen_data.nik').isString().isLength({ min: 16, max: 16 }).withMessage('NIK must be 16 digits'),
    body('citizen_data.alamat').isString().withMessage('alamat is required'),
    body('citizen_data.no_hp').isString().withMessage('no_hp is required'),
    body('reservation_date').isISO8601().withMessage('Invalid date format'),
    body('reservation_time').matches(/^\d{2}:\d{2}$/).withMessage('Invalid time format (HH:MM)'),
  ],
  validate,
  handleCreateReservation
);

// Get reservations list (dashboard)
router.get('/', handleGetReservations);

// Get statistics
router.get('/statistics', handleGetReservationStatistics);

// Get user history
router.get('/history/:wa_user_id', handleGetUserHistory);

// Get reservation by ID (admin/dashboard - no ownership check)
router.get('/:id', handleGetReservationById);

// Check reservation status with ownership validation (user via AI)
router.post(
  '/:id/check',
  internalAuth,
  [
    // Accept WhatsApp phone (628xxx) or webchat session (web_xxx)
    body('wa_user_id').matches(/^(628\d{8,12}|web_[a-z0-9_]+)$/i).withMessage('Invalid user ID format'),
  ],
  validate,
  handleCheckReservationStatus
);

// Update reservation status (dashboard)
router.patch(
  '/:id/status',
  [
    body('status')
      .isIn(['pending', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show'])
      .withMessage('Invalid status'),
    body('admin_notes').optional().isString(),
  ],
  validate,
  handleUpdateReservationStatus
);

// Cancel reservation (user)
router.post(
  '/:id/cancel',
  internalAuth,
  [
    // Accept WhatsApp phone (628xxx) or webchat session (web_xxx)
    body('wa_user_id').matches(/^(628\d{8,12}|web_[a-z0-9_]+)$/i).withMessage('Invalid user ID format'),
    body('cancel_reason').optional().isString(),
  ],
  validate,
  handleCancelReservation
);

// Update reservation time (user)
router.patch(
  '/:id/time',
  internalAuth,
  [
    // Accept WhatsApp phone (628xxx) or webchat session (web_xxx)
    body('wa_user_id').matches(/^(628\d{8,12}|web_[a-z0-9_]+)$/i).withMessage('Invalid user ID format'),
    body('reservation_date').isISO8601().withMessage('Invalid date format'),
    body('reservation_time').matches(/^\d{2}:\d{2}$/).withMessage('Invalid time format (HH:MM)'),
  ],
  validate,
  handleUpdateReservationTime
);

export default router;
