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
  put: originalCaseServiceClient.put,
  delete: originalCaseServiceClient.delete,
  patch: originalCaseServiceClient.patch,
  getMetrics: originalCaseServiceClient.getMetrics,
};

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
 * Get circuit breaker metrics
 */
export function getCaseServiceMetrics() {
  return caseServiceClient.getMetrics();
}

// Export the wrapper client
export { caseServiceClient };

export default {
  getCaseById,
  getCaseServiceMetrics,
};
