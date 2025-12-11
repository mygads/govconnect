import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { resilientHttp } from './circuit-breaker.service';

interface ComplaintData {
  wa_user_id: string;
  kategori: string;
  deskripsi: string;
  alamat?: string;
  rt_rw?: string;
  foto_url?: string;
}

interface ComplaintResponse {
  status: string;
  data: {
    complaint_id: string;
    status: string;
  };
}

/**
 * Create complaint in Case Service (SYNC call with Circuit Breaker)
 * 
 * TESTING MODE: Data is still saved to database for dashboard visibility.
 * Only WhatsApp message sending is skipped (handled in rabbitmq.service.ts).
 */
export async function createComplaint(data: ComplaintData): Promise<string | null> {
  logger.info('Creating complaint in Case Service', {
    wa_user_id: data.wa_user_id,
    kategori: data.kategori,
    testingMode: config.testingMode,
  });
  
  try {
    const url = `${config.caseServiceUrl}/laporan/create`;
    const response = await resilientHttp.post<ComplaintResponse>(
      url,
      data,
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 seconds
      }
    );
    
    // Check if circuit breaker returned fallback
    if (resilientHttp.isFallbackResponse(response)) {
      logger.error('❌ Case Service unavailable (circuit breaker open)', {
        wa_user_id: data.wa_user_id,
      });
      return null;
    }
    
    const complaintId = response.data.data.complaint_id;
    
    if (config.testingMode) {
      logger.info('🧪 TESTING MODE: Complaint created in database', {
        wa_user_id: data.wa_user_id,
        complaint_id: complaintId,
        kategori: data.kategori,
        alamat: data.alamat,
      });
    } else {
      logger.info('✅ Complaint created successfully', {
        wa_user_id: data.wa_user_id,
        complaint_id: complaintId,
      });
    }
    
    return complaintId;
  } catch (error: any) {
    logger.error('❌ Failed to create complaint', {
      wa_user_id: data.wa_user_id,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    
    return null;
  }
}

/**
 * Check if Case Service is available
 */
export async function checkCaseServiceHealth(): Promise<boolean> {
  try {
    const url = `${config.caseServiceUrl}/health`;
    const response = await axios.get(url, { timeout: 3000 });
    return response.status === 200;
  } catch (error) {
    logger.warn('Case Service health check failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

export interface ComplaintStatusResponse {
  data: {
    complaint_id: string;
    kategori: string;
    alamat: string | null;
    status: string;
    admin_notes: string | null;
    created_at: string;
    updated_at: string;
  } | null;
}

export interface CancelResponse {
  status: string;
  data?: {
    complaint_id?: string;
    message: string;
  };
  error?: string;
  message?: string;
}

export interface CancelResult {
  success: boolean;
  error?: 'NOT_FOUND' | 'NOT_OWNER' | 'ALREADY_COMPLETED' | 'INTERNAL_ERROR';
  message: string;
  complaint_id?: string;
}

/**
 * Get complaint status by complaint_id (e.g., LAP-20251201-001)
 * NOTE: This is for admin/internal use without ownership check
 */
export async function getComplaintStatus(complaintId: string): Promise<ComplaintStatusResponse['data']> {
  logger.info('Fetching complaint status from Case Service', {
    complaint_id: complaintId,
  });
  
  try {
    const url = `${config.caseServiceUrl}/laporan/${complaintId}`;
    const response = await axios.get<ComplaintStatusResponse>(
      url,
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    
    logger.info('✅ Complaint status fetched successfully', {
      complaint_id: complaintId,
      status: response.data.data?.status,
    });
    
    return response.data.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      logger.info('Complaint not found', { complaint_id: complaintId });
      return null;
    }
    
    logger.error('❌ Failed to fetch complaint status', {
      complaint_id: complaintId,
      error: error.message,
      status: error.response?.status,
    });
    
    return null;
  }
}

/**
 * Get complaint status with ownership validation
 * Only returns complaint if the user is the owner
 */
export async function getComplaintStatusWithOwnership(
  complaintId: string,
  wa_user_id: string
): Promise<{ success: boolean; error?: string; message?: string; data?: ComplaintStatusResponse['data'] }> {
  logger.info('Fetching complaint status with ownership check', {
    complaint_id: complaintId,
    wa_user_id,
  });
  
  try {
    const url = `${config.caseServiceUrl}/laporan/${complaintId}/check`;
    const response = await axios.post(
      url,
      { wa_user_id },
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    
    logger.info('✅ Complaint status fetched successfully with ownership', {
      complaint_id: complaintId,
      status: response.data.data?.status,
    });
    
    return { success: true, data: response.data.data };
  } catch (error: any) {
    const errorData = error.response?.data;
    
    if (error.response?.status === 404) {
      return { success: false, error: 'NOT_FOUND', message: 'Laporan tidak ditemukan' };
    }
    
    if (error.response?.status === 403) {
      return { 
        success: false, 
        error: 'NOT_OWNER', 
        message: errorData?.message || 'Anda tidak memiliki akses untuk melihat laporan ini' 
      };
    }
    
    logger.error('❌ Failed to fetch complaint status with ownership', {
      complaint_id: complaintId,
      error: error.message,
      status: error.response?.status,
    });
    
    return { success: false, error: 'INTERNAL_ERROR', message: 'Terjadi kesalahan saat mengecek status' };
  }
}

/**
 * Get reservation status with ownership validation
 * Only returns reservation if the user is the owner
 */
export async function getReservationStatusWithOwnership(
  reservationId: string,
  wa_user_id: string
): Promise<{ success: boolean; error?: string; message?: string; data?: any }> {
  logger.info('Fetching reservation status with ownership check', {
    reservation_id: reservationId,
    wa_user_id,
  });
  
  try {
    const url = `${config.caseServiceUrl}/reservasi/${reservationId}/check`;
    const response = await axios.post(
      url,
      { wa_user_id },
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    
    logger.info('✅ Reservation status fetched successfully with ownership', {
      reservation_id: reservationId,
      status: response.data.data?.status,
    });
    
    return { success: true, data: response.data.data };
  } catch (error: any) {
    const errorData = error.response?.data;
    
    if (error.response?.status === 404) {
      return { success: false, error: 'NOT_FOUND', message: 'Reservasi tidak ditemukan' };
    }
    
    if (error.response?.status === 403) {
      return { 
        success: false, 
        error: 'NOT_OWNER', 
        message: errorData?.message || 'Anda tidak memiliki akses untuk melihat reservasi ini' 
      };
    }
    
    logger.error('❌ Failed to fetch reservation status with ownership', {
      reservation_id: reservationId,
      error: error.message,
      status: error.response?.status,
    });
    
    return { success: false, error: 'INTERNAL_ERROR', message: 'Terjadi kesalahan saat mengecek status' };
  }
}

/**
 * Cancel complaint by user (with owner validation)
 */
export async function cancelComplaint(
  complaintId: string,
  wa_user_id: string,
  cancel_reason?: string
): Promise<CancelResult> {
  logger.info('Cancelling complaint in Case Service', {
    complaint_id: complaintId,
    wa_user_id,
  });
  
  try {
    const url = `${config.caseServiceUrl}/laporan/${complaintId}/cancel`;
    const response = await axios.post<CancelResponse>(
      url,
      {
        wa_user_id,
        cancel_reason,
      },
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    
    logger.info('✅ Complaint cancelled successfully', {
      complaint_id: complaintId,
      message: response.data.data?.message,
    });
    
    return {
      success: true,
      complaint_id: response.data.data?.complaint_id,
      message: response.data.data?.message || 'Dibatalkan oleh pelapor',
    };
  } catch (error: any) {
    const errorCode = error.response?.data?.error as CancelResult['error'];
    const errorMessage = error.response?.data?.message || 'Gagal membatalkan laporan';
    
    logger.error('❌ Failed to cancel complaint', {
      complaint_id: complaintId,
      error: error.message,
      status: error.response?.status,
      errorCode,
    });
    
    return {
      success: false,
      error: errorCode || 'INTERNAL_ERROR',
      message: errorMessage,
    };
  }
}

export interface HistoryItem {
  type: 'complaint' | 'reservation';
  id: string;
  display_id: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface UserHistoryResponse {
  status: string;
  data: {
    complaints: any[];
    reservations: any[];
    combined: HistoryItem[];
    total: number;
  };
}

/**
 * Get user's complaint and ticket history
 */
export async function getUserHistory(wa_user_id: string): Promise<UserHistoryResponse['data'] | null> {
  logger.info('Fetching user history from Case Service', {
    wa_user_id,
  });
  
  try {
    const url = `${config.caseServiceUrl}/user/${wa_user_id}/history`;
    const response = await axios.get<UserHistoryResponse>(
      url,
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    
    logger.info('✅ User history fetched successfully', {
      wa_user_id,
      total: response.data.data.total,
    });
    
    return response.data.data;
  } catch (error: any) {
    logger.error('❌ Failed to fetch user history', {
      wa_user_id,
      error: error.message,
      status: error.response?.status,
    });
    
    return null;
  }
}


