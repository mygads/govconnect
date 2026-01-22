/**
 * Case Service Client with Circuit Breaker
 * 
 * Resilient HTTP client untuk komunikasi dengan Case Service
 */

import { createHttpClient } from '../shared/http-client';
import { config } from '../config/env';

// Create resilient HTTP client
const caseServiceClient = createHttpClient('case-service', {
  baseURL: config.CASE_SERVICE_URL,
  timeout: 10000,
  retries: 3,
  retryDelay: 1000,
  headers: {
    'X-API-Key': config.INTERNAL_API_KEY,
  },
  circuitBreakerOptions: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 10000,
    resetTimeout: 30000,
  },
});

/**
 * Create complaint case
 */
export async function createComplaint(data: {
  citizenPhone: string;
  citizenName?: string;
  category: string;
  description: string;
  location?: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  mediaUrls?: string[];
  metadata?: any;
}) {
  try {
    const response = await caseServiceClient.post('/internal/complaints', data);
    return response.data;
  } catch (error: any) {
    console.error('[CaseServiceClient] Failed to create complaint:', error.message);
    throw error;
  }
}

/**
 * Create service request
 */
export async function createServiceRequest(data: {
  service_id: string;
  wa_user_id: string;
  citizen_data_json?: Record<string, any>;
  requirement_data_json?: Record<string, any>;
}) {
  try {
    const response = await caseServiceClient.post('/service-requests', data);
    return response.data;
  } catch (error: any) {
    console.error('[CaseServiceClient] Failed to create service request:', error.message);
    throw error;
  }
}

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
 * Update case status
 */
export async function updateCaseStatus(
  caseId: string,
  status: string,
  notes?: string
) {
  try {
    const response = await caseServiceClient.patch(`/internal/cases/${caseId}/status`, {
      status,
      notes,
    });
    return response.data;
  } catch (error: any) {
    console.error('[CaseServiceClient] Failed to update case status:', error.message);
    throw error;
  }
}

/**
 * Get circuit breaker metrics
 */
export function getCaseServiceMetrics() {
  return caseServiceClient.getMetrics();
}

/**
 * Reset circuit breaker (for admin/debugging)
 */
export function resetCaseServiceCircuitBreaker() {
  caseServiceClient.resetCircuitBreaker();
}

export default {
  createComplaint,
  createServiceRequest,
  getCaseById,
  updateCaseStatus,
  getCaseServiceMetrics,
  resetCaseServiceCircuitBreaker,
};
