import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { resilientHttp } from './circuit-breaker.service';
import { getVillageProfileSummary } from './knowledge.service';

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
  description?: string | null;
  category_id: string;
  is_urgent: boolean;
  require_address: boolean;
  send_important_contacts: boolean;
  important_contact_category: string | null;
  important_contact_category_id?: string | null;
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
        ...(villageId ? { 'x-admin-role': 'village_admin', 'x-village-id': villageId } : {}),
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
        validateStatus: (status) => status < 500,
        timeout: 10000,
      }
    );

    if (resilientHttp.isFallbackResponse(response)) {
      return { success: false, error: 'INTERNAL_ERROR', message: 'Layanan sedang tidak tersedia, coba lagi nanti' };
    }

    if (response.status === 404) {
      return { success: false, error: 'NOT_FOUND', message: 'Laporan tidak ditemukan' };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: 'NOT_OWNER',
        message: (response.data as any)?.message || 'Anda tidak memiliki akses untuk melihat laporan ini',
      };
    }

    if (response.status >= 400) {
      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: (response.data as any)?.message || 'Terjadi kesalahan saat mengecek status',
      };
    }
    
    logger.info('✅ Complaint status fetched successfully with ownership', {
      complaint_id: complaintId,
      status: response.data.data?.status,
    });

    return { success: true, data: response.data.data };
  } catch (error: any) {
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
    const url = `${config.caseServiceUrl}/service-requests/${encodeURIComponent(requestNumber)}/check`;
    const response = await resilientHttp.post<{ data: any }>(
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
        validateStatus: (status) => status < 500,
        timeout: 10000,
      }
    );

    if (resilientHttp.isFallbackResponse(response)) {
      return { success: false, error: 'INTERNAL_ERROR', message: 'Layanan sedang tidak tersedia, coba lagi nanti' };
    }

    if (response.status === 404) {
      return { success: false, error: 'NOT_FOUND', message: 'Permohonan layanan tidak ditemukan' };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: 'NOT_OWNER',
        message: (response.data as any)?.message || 'Permohonan layanan ini tidak terdaftar atas nomor Anda',
      };
    }

    if (response.status >= 400) {
      return {
        success: false,
        error: 'INTERNAL_ERROR',
        message: (response.data as any)?.message || 'Terjadi kesalahan saat mengecek status layanan',
      };
    }

    return { success: true, data: response.data.data };
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
 * Uses direct axios (bypasses circuit breaker) — cancel is a critical user action
 * and a breaker fallback would show a false failure even when the cancel succeeded.
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
    const response = await axios.post<CancelResponse>(
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
        timeout: 15000,
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

/**
 * Cancel service request by user (with owner validation)
 * Uses direct axios (bypasses circuit breaker) — cancel is a critical user action
 * and a breaker fallback would show a false failure even when the cancel succeeded.
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
    const response = await axios.post<CancelResponse>(
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
        timeout: 15000,
      }
    );

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
  village_id?: string;
  villageId?: string;
  code?: string;
  description?: string;
  mode?: string | null;
  estimated_cost?: string | null;
  estimated_processing_time?: string | null;
  is_active: boolean;
  requirements?: ServiceRequirementDefinition[];
  category?: {
    id: string;
    name: string;
  };
}

// Per-village cache to prevent multi-tenant data leakage (TENANT-01 fix)
const serviceCatalogCacheMap = new Map<string, { data: ServiceCatalogItem[]; time: number }>();
const serviceRequirementsCacheMap = new Map<string, { data: ServiceRequirementDefinition[]; time: number }>();
const SERVICE_CATALOG_TTL = 15 * 60 * 1000; // 15 minutes
const SERVICE_REQUIREMENTS_TTL = 15 * 60 * 1000; // 15 minutes
const SERVICE_CATALOG_CACHE_MAX_ENTRIES = 50; // Prevent unbounded growth
const SERVICE_REQUIREMENTS_CACHE_MAX_ENTRIES = 200;

function mergeServiceCatalogItem(
  existing: ServiceCatalogItem,
  incoming: ServiceCatalogItem,
): ServiceCatalogItem {
  return {
    ...incoming,
    ...existing,
    requirements: Array.isArray(existing.requirements) && existing.requirements.length > 0
      ? existing.requirements
      : incoming.requirements,
    category: existing.category || incoming.category,
    description: existing.description || incoming.description,
    estimated_cost: existing.estimated_cost || incoming.estimated_cost,
    estimated_processing_time: existing.estimated_processing_time || incoming.estimated_processing_time,
    mode: existing.mode || incoming.mode,
  };
}

function dedupeServiceCatalog(items: ServiceCatalogItem[]): ServiceCatalogItem[] {
  const byKey = new Map<string, ServiceCatalogItem>();

  for (const item of items) {
    const key = item.id || item.slug || item.name;
    if (!key) continue;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    byKey.set(key, mergeServiceCatalogItem(existing, item));
  }

  return Array.from(byKey.values());
}

async function getServiceVillageCandidates(villageId?: string): Promise<string[]> {
  if (!villageId) return [];

  const candidates = new Set<string>([villageId]);

  try {
    const profile = await getVillageProfileSummary(villageId);
    const alias = profile?.short_name?.trim();
    if (alias && alias !== villageId) {
      candidates.add(alias);
    }
  } catch (error: any) {
    logger.debug('Failed to resolve village service alias, using primary village ID only', {
      villageId,
      error: error.message,
    });
  }

  return Array.from(candidates);
}

async function fetchServiceCatalogFromCaseService(villageId?: string): Promise<ServiceCatalogItem[]> {
  const url = `${config.caseServiceUrl}/services`;
  const response = await resilientHttp.get<{ data: ServiceCatalogItem[] }>(url, {
    params: villageId ? { village_id: villageId } : undefined,
    headers: {
      'x-internal-api-key': config.internalApiKey,
      'Content-Type': 'application/json',
      ...(villageId ? { 'x-admin-role': 'village_admin', 'x-village-id': villageId } : {}),
    },
    timeout: 10000,
  });

  if (resilientHttp.isFallbackResponse(response)) {
    return [];
  }

  return Array.isArray(response.data?.data) ? response.data.data : [];
}

/**
 * Get all available services from case-service DB.
 * Results are cached per villageId for 15 minutes.
 */
export async function getServiceCatalog(villageId?: string): Promise<ServiceCatalogItem[]> {
  const cacheKey = villageId || '__global__';
  const now = Date.now();
  const cached = serviceCatalogCacheMap.get(cacheKey);
  if (cached && (now - cached.time) < SERVICE_CATALOG_TTL) {
    return cached.data;
  }

  try {
    const villageCandidates = villageId
      ? await getServiceVillageCandidates(villageId)
      : [];
    const candidateIds = villageCandidates.length > 0 ? villageCandidates : [undefined];
    const serviceGroups = await Promise.all(
      candidateIds.map((candidateVillageId) => fetchServiceCatalogFromCaseService(candidateVillageId))
    );
    const services = dedupeServiceCatalog(serviceGroups.flat())
      .filter((service) => service.is_active !== false);

    // Evict oldest entry if cache is full
    if (serviceCatalogCacheMap.size >= SERVICE_CATALOG_CACHE_MAX_ENTRIES) {
      const oldestKey = serviceCatalogCacheMap.keys().next().value;
      if (oldestKey) serviceCatalogCacheMap.delete(oldestKey);
    }

    serviceCatalogCacheMap.set(cacheKey, { data: services, time: now });

    logger.info('✅ Service catalog fetched from DB', {
      count: services.length,
      villageId: cacheKey,
      candidateIds: candidateIds.filter(Boolean),
    });
    return services;
  } catch (error: any) {
    logger.warn('❌ Failed to fetch service catalog, using cache or empty', {
      error: error.message,
      status: error.response?.status,
      hasCachedData: !!cached,
      villageId: cacheKey,
    });
    return cached?.data || [];
  }
}

/**
 * Clear the service catalog cache (called from periodic cleanup)
 */
export function clearServiceCatalogCache(): { serviceCatalogCleared: number; serviceRequirementsCleared: number } {
  const serviceCatalogCleared = serviceCatalogCacheMap.size;
  const serviceRequirementsCleared = serviceRequirementsCacheMap.size;
  serviceCatalogCacheMap.clear();
  serviceRequirementsCacheMap.clear();
  return { serviceCatalogCleared, serviceRequirementsCleared };
}

export interface ServiceRequirementDefinition {
  id: string;
  label: string;
  field_type: string;
  is_required: boolean;
  help_text?: string | null;
  order_index?: number | null;
}

export interface FormattedServiceRequirement {
  label: string;
  type: string;
  required: boolean;
  help_text: string | null;
}

export interface BuiltServiceInfoContext {
  service: ServiceCatalogItem;
  requirements: ServiceRequirementDefinition[];
  formattedRequirements: FormattedServiceRequirement[];
  requirementsText: string;
  replyText: string;
  guidanceText?: string;
  suggestedResponse: string;
  isOnline: boolean;
  canOfferFormLink: boolean;
  activeService: {
    service_slug: string;
    service_name: string;
    village_id?: string;
    mode?: string | null;
    is_online: boolean;
    can_send_form_link: boolean;
    estimated_cost?: string | null;
    estimated_processing_time?: string | null;
    requirements: FormattedServiceRequirement[];
    requirements_count: number;
    suggested_response: string;
    timestamp: number;
  };
}

function formatServiceRequirements(requirements: ServiceRequirementDefinition[]): string {
  return requirements
    .map((requirement, index) => {
      const suffix = requirement.is_required ? ' (wajib)' : ' (opsional)';
      return `${index + 1}. ${requirement.label}${suffix}`;
    })
    .join('\n');
}

export async function getServiceRequirements(serviceId: string, villageId?: string): Promise<ServiceRequirementDefinition[]> {
  if (!serviceId) return [];

  const cacheKey = `${villageId || '__unknown__'}:${serviceId.trim()}`;
  const now = Date.now();
  const cached = serviceRequirementsCacheMap.get(cacheKey);
  if (cached && (now - cached.time) < SERVICE_REQUIREMENTS_TTL) {
    return cached.data;
  }

  try {
    const url = `${config.caseServiceUrl}/services/${serviceId}/requirements`;
    const response = await resilientHttp.get<{ data: ServiceRequirementDefinition[] }>(url, {
      headers: {
        'x-internal-api-key': config.internalApiKey,
        'Content-Type': 'application/json',
        ...(villageId ? { 'x-admin-role': 'village_admin', 'x-village-id': villageId } : {}),
      },
      timeout: 10000,
    });

    if (resilientHttp.isFallbackResponse(response)) {
      return cached?.data || [];
    }

    const requirements = Array.isArray(response.data?.data) ? response.data.data : [];

    if (serviceRequirementsCacheMap.size >= SERVICE_REQUIREMENTS_CACHE_MAX_ENTRIES) {
      const oldestKey = serviceRequirementsCacheMap.keys().next().value;
      if (oldestKey) serviceRequirementsCacheMap.delete(oldestKey);
    }

    serviceRequirementsCacheMap.set(cacheKey, { data: requirements, time: now });
    return requirements;
  } catch (error: any) {
    logger.warn('Failed to fetch service requirements', {
      service_id: serviceId,
      error: error.message,
      status: error.response?.status,
      hasCachedData: !!cached,
    });
    return cached?.data || [];
  }
}

export async function buildServiceInfoContext(
  service: ServiceCatalogItem,
  options: {
    villageId?: string;
    allowFormLinkOffer?: boolean;
  } = {},
): Promise<BuiltServiceInfoContext> {
  const requirements = Array.isArray(service.requirements) && service.requirements.length > 0
    ? [...service.requirements]
    : await getServiceRequirements(service.id || service.slug, options.villageId || service.village_id || service.villageId);
  const sortedRequirements = requirements
    .slice()
    .sort((left, right) => (left.order_index || 0) - (right.order_index || 0));
  const formattedRequirements = sortedRequirements.map((requirement) => ({
    label: requirement.label,
    type: requirement.field_type,
    required: requirement.is_required,
    help_text: requirement.help_text || null,
  }));
  const requirementsText = sortedRequirements.length > 0
    ? formatServiceRequirements(sortedRequirements)
    : '';
  const isOnline = service.mode === 'online' || service.mode === 'both';
  const canOfferFormLink = isOnline && options.allowFormLinkOffer !== false;
  const resolvedVillageId = options.villageId || service.village_id || service.villageId || undefined;

  let replyText = `Baik, untuk layanan *${service.name}* persyaratannya seperti ini:\n\n`;
  if (requirementsText) {
    replyText += `${requirementsText}\n\n`;
  } else if (service.description) {
    replyText += `${service.description}\n\n`;
  }

  // Surface processing time and cost when present so facet questions
  // ("berapa lama?", "berapa biaya?") are answered by the same grounded reply
  // that the service-info stop-guard emits verbatim. The structured columns are
  // frequently empty on real data, with the estimate baked into the description
  // prose ("... Estimasi: ±15 menit."), so fall back to parsing it from there.
  const description = typeof service.description === 'string' ? service.description : '';
  let processingTime = typeof service.estimated_processing_time === 'string'
    ? service.estimated_processing_time.trim()
    : '';
  if (!processingTime && description) {
    const m = description.match(/estimasi[:\s]+([^\n.]+)/i);
    if (m) processingTime = m[1].trim();
  }
  if (processingTime) {
    replyText += `Estimasi proses: ${processingTime}.\n`;
  }
  const estimatedCost = typeof service.estimated_cost === 'string'
    ? service.estimated_cost.trim()
    : '';
  if (estimatedCost) {
    replyText += `Biaya: ${estimatedCost}.\n`;
  }
  if (processingTime || estimatedCost) {
    replyText += '\n';
  }

  let guidanceText: string | undefined;
  if (isOnline) {
    // Surface the channel facet so "online atau ke kantor?" is answered directly.
    replyText += service.mode === 'both'
      ? 'Layanan ini bisa diurus online maupun langsung di kantor desa.\n\n'
      : 'Layanan ini bisa diurus secara online.\n\n';
    if (canOfferFormLink) {
      guidanceText = `Kalau Bapak/Ibu mau lanjut, saya bisa kirimkan link formulir terkait *${service.name}*.`;
    }
  } else {
    replyText += 'Layanan ini diproses langsung di kantor desa. Silakan datang dengan membawa persyaratan di atas ya.';
  }

  const suggestedResponse = guidanceText ? `${replyText}\n\n${guidanceText}` : replyText;

  return {
    service,
    requirements: sortedRequirements,
    formattedRequirements,
    requirementsText,
    replyText,
    guidanceText,
    suggestedResponse,
    isOnline,
    canOfferFormLink,
    activeService: {
      service_slug: service.slug,
      service_name: service.name,
      village_id: resolvedVillageId,
      mode: service.mode || null,
      is_online: isOnline,
      can_send_form_link: canOfferFormLink,
      estimated_cost: service.estimated_cost || null,
      estimated_processing_time: service.estimated_processing_time || null,
      requirements: formattedRequirements,
      requirements_count: sortedRequirements.length,
      suggested_response: suggestedResponse,
      timestamp: Date.now(),
    },
  };
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


