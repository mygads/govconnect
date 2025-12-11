import { Request, Response } from 'express';
import {
  getAllServices,
  getActiveServices,
  getServiceByCodeFromDb,
  toggleServiceActive,
  toggleServiceOnline,
  updateServiceSettings,
  getAvailableSlots,
  createReservation,
  getReservationById,
  getReservationsList,
  updateReservationStatus,
  cancelReservation,
  getReservationStatistics,
  getUserReservationHistory,
} from '../services/reservation.service';
import { getQuestionsForService } from '../config/services';
import logger from '../utils/logger';

// ==================== SERVICE ENDPOINTS ====================

/**
 * GET /reservasi/services
 * Get all services (for admin)
 */
export async function handleGetAllServices(req: Request, res: Response) {
  try {
    const services = await getAllServices();
    return res.json({ data: services });
  } catch (error: any) {
    logger.error('Get all services error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /reservasi/services/active
 * Get active services only (for public/WhatsApp)
 */
export async function handleGetActiveServices(req: Request, res: Response) {
  try {
    const services = await getActiveServices();
    return res.json({ data: services });
  } catch (error: any) {
    logger.error('Get active services error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /reservasi/services/:code
 * Get service detail by code
 */
export async function handleGetServiceByCode(req: Request, res: Response) {
  try {
    const { code } = req.params;
    const service = await getServiceByCodeFromDb(code);
    
    if (!service) {
      return res.status(404).json({ error: 'Layanan tidak ditemukan' });
    }
    
    // Include questions for this service
    const questions = getQuestionsForService(code);
    
    return res.json({ 
      data: {
        ...service,
        questions,
      }
    });
  } catch (error: any) {
    logger.error('Get service error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /reservasi/services/:code/toggle-active
 * Toggle service active status (admin only)
 */
export async function handleToggleServiceActive(req: Request, res: Response) {
  try {
    const { code } = req.params;
    const { is_active } = req.body;
    
    const service = await toggleServiceActive(code, is_active);
    
    logger.info('Service active status toggled', { code, is_active });
    
    return res.json({
      status: 'success',
      data: service,
    });
  } catch (error: any) {
    logger.error('Toggle service active error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /reservasi/services/:code/toggle-online
 * Toggle service online availability (admin only)
 */
export async function handleToggleServiceOnline(req: Request, res: Response) {
  try {
    const { code } = req.params;
    const { is_online_available } = req.body;
    
    const service = await toggleServiceOnline(code, is_online_available);
    
    logger.info('Service online status toggled', { code, is_online_available });
    
    return res.json({
      status: 'success',
      data: service,
    });
  } catch (error: any) {
    logger.error('Toggle service online error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /reservasi/services/:code/settings
 * Update service settings (admin only)
 */
export async function handleUpdateServiceSettings(req: Request, res: Response) {
  try {
    const { code } = req.params;
    const { daily_quota, operating_hours } = req.body;
    
    const service = await updateServiceSettings(code, { daily_quota, operating_hours });
    
    logger.info('Service settings updated', { code });
    
    return res.json({
      status: 'success',
      data: service,
    });
  } catch (error: any) {
    logger.error('Update service settings error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ==================== SLOT AVAILABILITY ====================

/**
 * GET /reservasi/slots/:code/:date
 * Get available slots for a service on a specific date
 */
export async function handleGetAvailableSlots(req: Request, res: Response) {
  try {
    const { code, date } = req.params;
    const reservationDate = new Date(date);
    
    if (isNaN(reservationDate.getTime())) {
      return res.status(400).json({ error: 'Format tanggal tidak valid' });
    }
    
    const availability = await getAvailableSlots(code, reservationDate);
    
    return res.json({ data: availability });
  } catch (error: any) {
    logger.error('Get available slots error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ==================== RESERVATION ENDPOINTS ====================

/**
 * POST /reservasi/create
 * Create new reservation (from AI Service)
 */
export async function handleCreateReservation(req: Request, res: Response) {
  try {
    const { wa_user_id, service_code, citizen_data, reservation_date, reservation_time } = req.body;
    
    const reservation = await createReservation({
      wa_user_id,
      service_code,
      citizen_data,
      reservation_date: new Date(reservation_date),
      reservation_time,
    });
    
    return res.status(201).json({
      status: 'success',
      data: {
        reservation_id: reservation.reservation_id,
        service_name: reservation.service.name,
        reservation_date: reservation.reservation_date,
        reservation_time: reservation.reservation_time,
        queue_number: reservation.queue_number,
        status: reservation.status,
      },
    });
  } catch (error: any) {
    logger.error('Create reservation error', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
}

/**
 * GET /reservasi
 * Get reservations list (for Dashboard)
 */
export async function handleGetReservations(req: Request, res: Response) {
  try {
    const filters = {
      status: req.query.status as string,
      service_id: req.query.service_id as string,
      wa_user_id: req.query.wa_user_id as string,
      date_from: req.query.date_from ? new Date(req.query.date_from as string) : undefined,
      date_to: req.query.date_to ? new Date(req.query.date_to as string) : undefined,
      limit: parseInt(req.query.limit as string) || 20,
      offset: parseInt(req.query.offset as string) || 0,
    };
    
    const result = await getReservationsList(filters);
    
    return res.json({
      data: result.data,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (error: any) {
    logger.error('Get reservations error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /reservasi/:id
 * Get reservation by ID (for admin/dashboard - no ownership check)
 */
export async function handleGetReservationById(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const reservation = await getReservationById(id);
    
    if (!reservation) {
      return res.status(404).json({ error: 'Reservasi tidak ditemukan' });
    }
    
    return res.json({ data: reservation });
  } catch (error: any) {
    logger.error('Get reservation error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /reservasi/:id/check
 * Get reservation by ID with ownership validation (for user via AI)
 */
export async function handleCheckReservationStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { wa_user_id } = req.body;
    
    if (!wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }
    
    const { getReservationByIdWithOwnership } = await import('../services/reservation.service');
    const result = await getReservationByIdWithOwnership(id, wa_user_id);
    
    if (!result.success) {
      const statusCode = result.error === 'NOT_FOUND' ? 404 : 403;
      return res.status(statusCode).json({
        status: 'error',
        error: result.error,
        message: result.message,
      });
    }
    
    return res.json({ data: result.data });
  } catch (error: any) {
    logger.error('Check reservation status error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /reservasi/:id/status
 * Update reservation status (from Dashboard)
 */
export async function handleUpdateReservationStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;
    
    const reservation = await updateReservationStatus(id, { status, admin_notes });
    
    return res.json({
      status: 'success',
      data: reservation,
    });
  } catch (error: any) {
    logger.error('Update reservation status error', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
}

/**
 * POST /reservasi/:id/cancel
 * Cancel reservation by user
 */
export async function handleCancelReservation(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { wa_user_id, cancel_reason } = req.body;
    
    if (!wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }
    
    const result = await cancelReservation(id, wa_user_id, cancel_reason);
    
    if (!result.success) {
      const statusCode = result.error === 'NOT_FOUND' ? 404 
        : result.error === 'NOT_OWNER' ? 403 
        : ['CANNOT_CANCEL', 'ALREADY_COMPLETED'].includes(result.error || '') ? 400 
        : 500;
      
      return res.status(statusCode).json({
        status: 'error',
        error: result.error,
        message: result.message,
        current_status: (result as any).current_status,
      });
    }
    
    return res.json({
      status: 'success',
      data: {
        reservation_id: result.reservation_id,
      },
    });
  } catch (error: any) {
    logger.error('Cancel reservation error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /reservasi/:id/time
 * Update reservation time by user
 */
export async function handleUpdateReservationTime(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { wa_user_id, reservation_date, reservation_time } = req.body;
    
    if (!wa_user_id) {
      return res.status(400).json({ error: 'wa_user_id is required' });
    }
    
    if (!reservation_date || !reservation_time) {
      return res.status(400).json({ error: 'reservation_date dan reservation_time diperlukan' });
    }
    
    const { updateReservationTime } = await import('../services/reservation.service');
    const result = await updateReservationTime(id, wa_user_id, new Date(reservation_date), reservation_time);
    
    if (!result.success) {
      const statusCode = result.error === 'NOT_FOUND' ? 404 
        : result.error === 'NOT_OWNER' ? 403 
        : ['CANNOT_MODIFY', 'SLOT_UNAVAILABLE', 'TIME_UNAVAILABLE'].includes(result.error || '') ? 400 
        : 500;
      
      return res.status(statusCode).json({
        status: 'error',
        error: result.error,
        message: result.message,
        current_status: (result as any).current_status,
      });
    }
    
    return res.json({
      status: 'success',
      data: {
        reservation_id: result.reservation_id,
        reservation_date: result.reservation_date,
        reservation_time: result.reservation_time,
      },
    });
  } catch (error: any) {
    logger.error('Update reservation time error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /reservasi/statistics
 * Get reservation statistics
 */
export async function handleGetReservationStatistics(req: Request, res: Response) {
  try {
    const stats = await getReservationStatistics();
    return res.json({ data: stats });
  } catch (error: any) {
    logger.error('Get statistics error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /reservasi/history/:wa_user_id
 * Get user reservation history
 */
export async function handleGetUserHistory(req: Request, res: Response) {
  try {
    const { wa_user_id } = req.params;
    const history = await getUserReservationHistory(wa_user_id);
    return res.json({ data: history });
  } catch (error: any) {
    logger.error('Get user history error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}
