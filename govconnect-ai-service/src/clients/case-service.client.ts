/**
 * Case Service Client with Circuit Breaker and Testing Mode Support
 */

import { createHttpClient } from '../shared/http-client';
import { config } from '../config/env';
import logger from '../utils/logger';

const originalCaseServiceClient = createHttpClient('case-service', {
  baseURL: config.caseServiceUrl,
  timeout: 10000,
  retries: 3,
  headers: {
    'x-internal-api-key': config.internalApiKey,
  },
  circuitBreakerOptions: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 10000,
    resetTimeout: 30000,
  },
});



/**
 * Wrapper client - Testing mode now saves to database normally
 * Only WhatsApp message sending is skipped (handled in rabbitmq.service.ts)
 */
const caseServiceClient = {
  // GET requests - pass through normally
  get: (url: string, config?: any) => {
    return originalCaseServiceClient.get(url, config);
  },
  
  // POST requests - pass through normally (data saved to database)
  post: async (url: string, data?: any, config?: any) => {
    // Log testing mode for debugging
    if (config?.testingMode) {
      logger.info('🧪 TESTING MODE: POST request (saving to database)', {
        url,
        wa_user_id: data?.wa_user_id,
      });
    }
    
    // Pass through to actual case service - data will be saved to database
    return originalCaseServiceClient.post(url, data, config);
  },
  
  // Other methods pass through
  put: originalCaseServiceClient.put.bind(originalCaseServiceClient),
  delete: originalCaseServiceClient.delete.bind(originalCaseServiceClient),
  patch: originalCaseServiceClient.patch.bind(originalCaseServiceClient),
  getMetrics: () => originalCaseServiceClient.getMetrics(),
};

export type ServiceInfo = {
  service_name: string;
  slug: string;
  requirements: string[];
  cost: number | null;
  estimated_duration: number | null;
  is_active: boolean;
};

export type RequestStatus = {
  status: 'PENDING' | 'DONE' | 'REJECTED';
  current_step: string;
  last_updated: string;
  notes: string | null;
} | null;

/**
 * Get case by ID
 */
export async function getCaseById(caseId: string) {
  try {
    const response = await caseServiceClient.get(`/internal/cases/${caseId}`);
    return response.data;
  } catch (error: any) {
    console.error('[CaseServiceClient] Failed to get case:', error.message);
    throw error;
  }
}

/**
 * Search services for AI context (compact)
 */
export async function searchServices(query: string, villageId: string): Promise<ServiceInfo[]> {
  try {
    const response = await caseServiceClient.get('/internal/services/search', {
      params: {
        q: query,
        village_id: villageId,
      },
    });

    const data = response?.data?.data;
    return Array.isArray(data) ? (data as ServiceInfo[]) : [];
  } catch (error: any) {
    logger.warn('[CaseServiceClient] Failed to search services (graceful fallback)', {
      error: error?.message,
    });
    return [];
  }
}

/**
 * Check service request status for citizen (ownership validated in Case Service)
 */
export async function checkRequestStatus(code: string, phone: string): Promise<RequestStatus> {
  try {
    const response = await caseServiceClient.get('/internal/service-requests/status', {
      params: {
        request_code: code,
        phone_number: phone,
      },
    });

    return (response?.data as Exclude<RequestStatus, null>) ?? null;
  } catch (error: any) {
    logger.warn('[CaseServiceClient] Failed to check request status (graceful fallback)', {
      error: error?.message,
    });
    return null;
  }
}

/**
 * Get circuit breaker metrics
 */
export function getCaseServiceMetrics() {
  return caseServiceClient.getMetrics();
}

/**
 * Reset circuit breaker manually
 */
export function resetCaseServiceCircuitBreaker() {
  logger.info('🔄 Resetting Case Service circuit breaker manually');
  originalCaseServiceClient.resetCircuitBreaker();
  return { success: true, message: 'Circuit breaker reset successfully' };
}

// Export the wrapper client
export { caseServiceClient };

export default {
  getCaseById,
  searchServices,
  checkRequestStatus,
  getCaseServiceMetrics,
  resetCaseServiceCircuitBreaker,
};
