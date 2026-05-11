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
    'x-internal-api-key': config.INTERNAL_API_KEY,
  },
  circuitBreakerOptions: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 10000,
    resetTimeout: 30000,
  },
});

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
  getCaseServiceMetrics,
  resetCaseServiceCircuitBreaker,
};
