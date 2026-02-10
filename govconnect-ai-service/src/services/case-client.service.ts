import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { resilientHttp } from './circuit-breaker.service';

function normalizeTo628(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

interface ComplaintData {
  wa_user_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier?: string;
  kategori: string;
  deskripsi: string;
  village_id?: string;
  alamat?: string;
  rt_rw?: string;
  foto_url?: string;
  category_id?: string;
  type_id?: string;
  is_urgent?: boolean;
  require_address?: boolean;
  // Reporter identity
  reporter_name?: string;
  reporter_phone?: string;
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
  const channel = data.channel || 'WHATSAPP';
  const normalizedWaUserId = data.wa_user_id ? normalizeTo628(data.wa_user_id) : '';
  logger.info('Creating complaint in Case Service', {
    wa_user_id: normalizedWaUserId || data.wa_user_id,
    channel,
    channel_identifier: data.channel_identifier,
    kategori: data.kategori,
    testingMode: config.testingMode,
  });
  
  try {
    const url = `${config.caseServiceUrl}/laporan/create`;
    const response = await resilientHttp.post<ComplaintResponse>(
      url,
      {
        ...data,
        wa_user_id: channel === 'WHATSAPP' ? (normalizedWaUserId || data.wa_user_id) : undefined,
        channel,
        channel_identifier: data.channel_identifier,
      },
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
        channel,
        channel_identifier: data.channel_identifier,
      });
      return null;
    }
    
    const complaintId = response.data.data.complaint_id;
    
    if (config.testingMode) {
      logger.info('🧪 TESTING MODE: Complaint created in database', {
        wa_user_id: data.wa_user_id,
        channel,
        channel_identifier: data.channel_identifier,
        complaint_id: complaintId,
        kategori: data.kategori,
        alamat: data.alamat,
      });
    } else {
      logger.info('✅ Complaint created successfully', {
        wa_user_id: data.wa_user_id,
        channel,
        channel_identifier: data.channel_identifier,
        complaint_id: complaintId,
      });
    }
    
    return complaintId;
  } catch (error: any) {
    logger.error('❌ Failed to create complaint', {
      wa_user_id: data.wa_user_id,
      channel,
      channel_identifier: data.channel_identifier,
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
  error?: 'NOT_FOUND' | 'NOT_OWNER' | 'ALREADY_COMPLETED' | 'LOCKED' | 'INTERNAL_ERROR';
  message: string;
  complaint_id?: string;
}

export interface UpdateComplaintResult {
  success: boolean;
  error?: 'NOT_FOUND' | 'NOT_OWNER' | 'LOCKED' | 'INTERNAL_ERROR';
  message: string;
  data?: any;
}

export interface EditTokenResult {
  success: boolean;
  error?: 'NOT_FOUND' | 'NOT_OWNER' | 'LOCKED' | 'INTERNAL_ERROR';
  message?: string;
  request_number?: string;
  edit_token?: string;
  edit_token_expires_at?: string;
}

export interface ComplaintTypeInfo {
  id: string;
  name: string;
  category_id: string;
  is_urgent: boolean;
  require_address: boolean;
  send_important_contacts: boolean;
  important_contact_category: string | null;
  category?: {
    id: string;
    name: string;
    village_id: string;
  };
}

export async function getComplaintTypes(villageId?: string): Promise<ComplaintTypeInfo[]> {
  try {
    const url = `${config.caseServiceUrl}/complaints/types`;
    const response = await resilientHttp.get<{ data: ComplaintTypeInfo[] }>(url, {
      headers: {
        'x-internal-api-key': config.internalApiKey,
        'Content-Type': 'application/json',
      },
      params: villageId ? { village_id: villageId } : undefined,
      timeout: 10000,
    });

    if (resilientHttp.isFallbackResponse(response)) return [];
    return response.data.data || [];
  } catch (error: any) {
    logger.warn('Failed to fetch complaint types', {
      error: error.message,
      status: error.response?.status,
    });
    return [];
  }
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
    const response = await resilientHttp.get<ComplaintStatusResponse>(
      url,
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (resilientHttp.isFallbackResponse(response)) return null;
    
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
  params: { wa_user_id?: string; channel?: 'WHATSAPP' | 'WEBCHAT'; channel_identifier?: string }
): Promise<{ success: boolean; error?: string; message?: string; data?: ComplaintStatusResponse['data'] }> {
  const channel = params.channel || 'WHATSAPP';
  logger.info('Fetching complaint status with ownership check', {
    complaint_id: complaintId,
    wa_user_id: params.wa_user_id,
    channel,
    channel_identifier: params.channel_identifier,
  });
  
  try {
    const url = `${config.caseServiceUrl}/laporan/${complaintId}/check`;
    const response = await resilientHttp.post<{ data: ComplaintStatusResponse['data'] }>(
      url,
      {
        wa_user_id: channel === 'WHATSAPP' ? params.wa_user_id : undefined,
        channel,
        channel_identifier: params.channel_identifier,
      },
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (resilientHttp.isFallbackResponse(response)) {
      return { success: false, error: 'INTERNAL_ERROR', message: 'Layanan sedang tidak tersedia, coba lagi nanti' };
    }
    
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
 * Get service request status with ownership validation
 */
export async function getServiceRequestStatusWithOwnership(
  requestNumber: string,
  params: { wa_user_id?: string; channel?: 'WHATSAPP' | 'WEBCHAT'; channel_identifier?: string }
): Promise<{ success: boolean; error?: string; message?: string; data?: any }> {
  const channel = params.channel || 'WHATSAPP';
  const normalizedWaUserId = params.wa_user_id ? (normalizeTo628(params.wa_user_id) || params.wa_user_id) : '';
  logger.info('Fetching service request status with ownership check', {
    request_number: requestNumber,
    wa_user_id: normalizedWaUserId,
    channel,
    channel_identifier: params.channel_identifier,
  });

  try {
    const url = `${config.caseServiceUrl}/service-requests`;
    const response = await resilientHttp.get<{ data: any[] }>(
      url,
      {
        params: {
          request_number: requestNumber,
          ...(channel === 'WHATSAPP' ? { wa_user_id: normalizedWaUserId } : { channel, channel_identifier: params.channel_identifier }),
        },
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (resilientHttp.isFallbackResponse(response)) {
      return { success: false, error: 'INTERNAL_ERROR', message: 'Layanan sedang tidak tersedia, coba lagi nanti' };
    }

    const data = (response.data as any)?.data?.[0];

    if (!data) {
      return { success: false, error: 'NOT_FOUND', message: 'Permohonan layanan tidak ditemukan' };
    }

    return { success: true, data };
  } catch (error: any) {
    logger.error('❌ Failed to fetch service request status', {
      request_number: requestNumber,
      error: error.message,
      status: error.response?.status,
    });

    return { success: false, error: 'INTERNAL_ERROR', message: 'Terjadi kesalahan saat mengecek status layanan' };
  }
}

/**
 * Cancel complaint by user (with owner validation)
 */
export async function cancelComplaint(
  complaintId: string,
  params: { wa_user_id?: string; channel?: 'WHATSAPP' | 'WEBCHAT'; channel_identifier?: string },
  cancel_reason?: string
): Promise<CancelResult> {
  const channel = params.channel || 'WHATSAPP';
  const normalizedWaUserId = params.wa_user_id ? (normalizeTo628(params.wa_user_id) || params.wa_user_id) : '';
  logger.info('Cancelling complaint in Case Service', {
    complaint_id: complaintId,
    wa_user_id: normalizedWaUserId,
    channel,
    channel_identifier: params.channel_identifier,
  });
  
  try {
    const url = `${config.caseServiceUrl}/laporan/${complaintId}/cancel`;
    const response = await resilientHttp.post<CancelResponse>(
      url,
      {
        wa_user_id: channel === 'WHATSAPP' ? normalizedWaUserId : undefined,
        channel,
        channel_identifier: params.channel_identifier,
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

    if (resilientHttp.isFallbackResponse(response)) {
      return { success: false, error: 'INTERNAL_ERROR', message: 'Layanan sedang tidak tersedia, coba lagi nanti' };
    }
    
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

/**
 * Cancel service request by user (with owner validation)
 */
export async function cancelServiceRequest(
  requestNumber: string,
  params: { wa_user_id?: string; channel?: 'WHATSAPP' | 'WEBCHAT'; channel_identifier?: string },
  cancel_reason?: string
): Promise<CancelResult> {
  const channel = params.channel || 'WHATSAPP';
  const normalizedWaUserId = params.wa_user_id ? (normalizeTo628(params.wa_user_id) || params.wa_user_id) : '';
  logger.info('Cancelling service request in Case Service', {
    request_number: requestNumber,
    wa_user_id: normalizedWaUserId,
    channel,
    channel_identifier: params.channel_identifier,
  });

  try {
    const url = `${config.caseServiceUrl}/service-requests/${requestNumber}/cancel`;
    const response = await resilientHttp.post<CancelResponse>(
      url,
      {
        wa_user_id: channel === 'WHATSAPP' ? normalizedWaUserId : undefined,
        channel,
        channel_identifier: params.channel_identifier,
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

    if (resilientHttp.isFallbackResponse(response)) {
      return { success: false, error: 'INTERNAL_ERROR', message: 'Layanan sedang tidak tersedia, coba lagi nanti' };
    }

    return {
      success: true,
      complaint_id: response.data.data?.complaint_id,
      message: response.data.message || response.data.data?.message || 'Dibatalkan oleh pemohon',
    };
  } catch (error: any) {
    const status = error.response?.status;
    const errorData = error.response?.data;

    if (status === 404) {
      return { success: false, error: 'NOT_FOUND', message: 'Permohonan layanan tidak ditemukan' };
    }

    if (status === 403) {
      return { success: false, error: 'NOT_OWNER', message: errorData?.message || 'Anda tidak memiliki akses' };
    }

    if (status === 400 && errorData?.error === 'LOCKED') {
      return { success: false, error: 'LOCKED', message: errorData?.message || 'Permohonan tidak bisa dibatalkan' };
    }

    logger.error('❌ Failed to cancel service request', {
      request_number: requestNumber,
      error: error.message,
      status,
    });

    return { success: false, error: 'INTERNAL_ERROR', message: 'Terjadi kesalahan saat membatalkan layanan' };
  }
}

/**
 * Request edit token for service request (owner validation)
 */
export async function requestServiceRequestEditToken(
  requestNumber: string,
  params: { wa_user_id?: string; channel?: 'WHATSAPP' | 'WEBCHAT'; channel_identifier?: string }
): Promise<EditTokenResult> {
  const channel = params.channel || 'WHATSAPP';
  const normalizedWaUserId = params.wa_user_id ? (normalizeTo628(params.wa_user_id) || params.wa_user_id) : '';
  logger.info('Requesting service request edit token', {
    request_number: requestNumber,
    wa_user_id: normalizedWaUserId,
    channel,
    channel_identifier: params.channel_identifier,
  });

  try {
    const url = `${config.caseServiceUrl}/service-requests/${requestNumber}/edit-token`;
    const response = await resilientHttp.post<{ data: { request_number?: string; edit_token?: string; edit_token_expires_at?: string } }>(
      url,
      {
        wa_user_id: channel === 'WHATSAPP' ? normalizedWaUserId : undefined,
        channel,
        channel_identifier: params.channel_identifier,
      },
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (resilientHttp.isFallbackResponse(response)) {
      return { success: false, error: 'INTERNAL_ERROR', message: 'Layanan sedang tidak tersedia, coba lagi nanti' };
    }

    return {
      success: true,
      request_number: response.data?.data?.request_number,
      edit_token: response.data?.data?.edit_token,
      edit_token_expires_at: response.data?.data?.edit_token_expires_at,
    };
  } catch (error: any) {
    const status = error.response?.status;
    const errorData = error.response?.data;

    if (status === 404) {
      return { success: false, error: 'NOT_FOUND', message: 'Permohonan layanan tidak ditemukan' };
    }

    if (status === 403) {
      return { success: false, error: 'NOT_OWNER', message: errorData?.message || 'Anda tidak memiliki akses' };
    }

    if (status === 400 && errorData?.error === 'LOCKED') {
      return { success: false, error: 'LOCKED', message: errorData?.message || 'Permohonan tidak bisa diubah' };
    }

    logger.error('❌ Failed to request edit token', {
      request_number: requestNumber,
      error: error.message,
      status,
    });

    return { success: false, error: 'INTERNAL_ERROR', message: 'Terjadi kesalahan saat menyiapkan link edit' };
  }
}

/**
 * Update complaint by user (owner validation)
 */
export async function updateComplaintByUser(
  complaintId: string,
  params: { wa_user_id?: string; channel?: 'WHATSAPP' | 'WEBCHAT'; channel_identifier?: string },
  data: { alamat?: string; deskripsi?: string; rt_rw?: string }
): Promise<UpdateComplaintResult> {
  const channel = params.channel || 'WHATSAPP';
  logger.info('Updating complaint by user', {
    complaint_id: complaintId,
    wa_user_id: params.wa_user_id,
    channel,
    channel_identifier: params.channel_identifier,
  });

  try {
    const url = `${config.caseServiceUrl}/laporan/${complaintId}/update`;
    const response = await resilientHttp.patch<{ data: any }>(
      url,
      {
        wa_user_id: channel === 'WHATSAPP' ? params.wa_user_id : undefined,
        channel,
        channel_identifier: params.channel_identifier,
        ...data,
      },
      {
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (resilientHttp.isFallbackResponse(response)) {
      return { success: false, error: 'INTERNAL_ERROR', message: 'Layanan sedang tidak tersedia, coba lagi nanti' };
    }

    return {
      success: true,
      message: 'Laporan berhasil diperbarui',
      data: response.data.data,
    };
  } catch (error: any) {
    const errorCode = error.response?.data?.error as UpdateComplaintResult['error'];
    const errorMessage = error.response?.data?.message || 'Gagal memperbarui laporan';

    logger.error('❌ Failed to update complaint by user', {
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
  type: 'complaint' | 'service';
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
    services: any[];
    combined: HistoryItem[];
    total: number;
  };
}

// ==================== SERVICE CATALOG ====================

export interface ServiceCatalogItem {
  id: string;
  name: string;
  slug: string;
  code?: string;
  description?: string;
  is_active: boolean;
  category?: {
    id: string;
    name: string;
  };
}

let serviceCatalogCache: ServiceCatalogItem[] | null = null;
let serviceCatalogCacheTime = 0;
const SERVICE_CATALOG_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Get all available services from case-service DB.
 * Results are cached for 15 minutes.
 */
export async function getServiceCatalog(villageId?: string): Promise<ServiceCatalogItem[]> {
  const now = Date.now();
  if (serviceCatalogCache && (now - serviceCatalogCacheTime) < SERVICE_CATALOG_TTL) {
    return serviceCatalogCache;
  }

  try {
    const url = `${config.caseServiceUrl}/services`;
    const response = await resilientHttp.get<{ data: ServiceCatalogItem[] }>(url, {
      params: villageId ? { village_id: villageId } : undefined,
      headers: {
        'x-internal-api-key': config.internalApiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    if (resilientHttp.isFallbackResponse(response)) {
      return serviceCatalogCache || [];
    }

    const services = Array.isArray(response.data?.data) ? response.data.data : [];
    serviceCatalogCache = services;
    serviceCatalogCacheTime = now;

    logger.info('✅ Service catalog fetched from DB', { count: services.length });
    return services;
  } catch (error: any) {
    logger.warn('❌ Failed to fetch service catalog, using cache or empty', {
      error: error.message,
      status: error.response?.status,
      hasCachedData: !!serviceCatalogCache,
    });
    return serviceCatalogCache || [];
  }
}

/**
 * Clear the service catalog cache (called from periodic cleanup)
 */
export function clearServiceCatalogCache(): void {
  serviceCatalogCache = null;
  serviceCatalogCacheTime = 0;
}

export interface ServiceRequirementDefinition {
  id: string;
  label: string;
  field_type: string;
  is_required: boolean;
  help_text?: string | null;
  order_index?: number | null;
}

export async function getServiceRequirements(serviceId: string): Promise<ServiceRequirementDefinition[]> {
  if (!serviceId) return [];

  try {
    const url = `${config.caseServiceUrl}/services/${serviceId}/requirements`;
    const response = await resilientHttp.get<{ data: ServiceRequirementDefinition[] }>(url, {
      headers: {
        'x-internal-api-key': config.internalApiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    if (resilientHttp.isFallbackResponse(response)) return [];

    return Array.isArray(response.data?.data) ? response.data.data : [];
  } catch (error: any) {
    logger.warn('Failed to fetch service requirements', {
      service_id: serviceId,
      error: error.message,
      status: error.response?.status,
    });
    return [];
  }
}

/**
 * Get user's complaint and service request history
 */
export async function getUserHistory(params: { wa_user_id?: string; channel?: 'WHATSAPP' | 'WEBCHAT'; channel_identifier?: string }): Promise<UserHistoryResponse['data'] | null> {
  const channel = params.channel || 'WHATSAPP';
  const identifier = channel === 'WEBCHAT' ? params.channel_identifier : params.wa_user_id;
  logger.info('Fetching user history from Case Service', {
    wa_user_id: params.wa_user_id,
    channel,
    channel_identifier: params.channel_identifier,
  });
  
  try {
    const url = `${config.caseServiceUrl}/user/${encodeURIComponent(identifier || '')}/history`;
    const response = await resilientHttp.get<UserHistoryResponse>(
      url,
      {
        params: {
          channel,
          ...(channel === 'WEBCHAT' ? { session_id: params.channel_identifier } : {}),
        },
        headers: {
          'x-internal-api-key': config.internalApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (resilientHttp.isFallbackResponse(response)) return null;
    
    logger.info('✅ User history fetched successfully', {
      wa_user_id: params.wa_user_id,
      channel,
      channel_identifier: params.channel_identifier,
      total: response.data.data.total,
    });
    
    return response.data.data;
  } catch (error: any) {
    logger.error('❌ Failed to fetch user history', {
      wa_user_id: params.wa_user_id,
      channel,
      channel_identifier: params.channel_identifier,
      error: error.message,
      status: error.response?.status,
    });
    
    return null;
  }
}


