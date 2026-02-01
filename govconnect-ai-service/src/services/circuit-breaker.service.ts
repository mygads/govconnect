/**
 * Circuit Breaker Service
 *
 * Implements the Circuit Breaker resilience pattern using Opossum
 * to handle service failures gracefully and prevent cascade failures.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is down, fail fast without calling
 * - HALF-OPEN: Testing if service has recovered
 */

import CircuitBreaker from 'opossum';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import logger from '../utils/logger';

// Circuit breaker configuration
const circuitBreakerOptions: CircuitBreaker.Options = {
  timeout: 10000, // 10 seconds timeout (increased for AI calls)
  errorThresholdPercentage: 50, // Open if 50% failures
  resetTimeout: 30000, // Try again after 30 seconds
  volumeThreshold: 5, // Minimum 5 requests before opening
  rollingCountTimeout: 10000, // Rolling window of 10 seconds
  rollingCountBuckets: 10, // Number of buckets in rolling window
};

// Fallback response when circuit is open
interface FallbackResponse {
  status: number;
  data: {
    error: string;
    message: string;
    circuit_breaker: boolean;
  };
  headers?: Record<string, string>;
}

const fallback = (
  error: Error,
  config: AxiosRequestConfig
): FallbackResponse => {
  logger.warn('Circuit breaker fallback triggered', {
    url: config?.url,
    method: config?.method,
    errorName: error?.name,
    errorMessage: error?.message,
    errorStack: error?.stack?.split('\n').slice(0, 3).join(' | '),
  });

  return {
    status: 503,
    data: {
      error: 'Service Unavailable',
      message:
        'The service is temporarily unavailable. Please try again later.',
      circuit_breaker: true,
    },
  };
};

// HTTP request function to be wrapped
const httpRequest = async (
  config: AxiosRequestConfig
): Promise<AxiosResponse> => {
  logger.debug('Circuit breaker httpRequest called', {
    url: config.url,
    method: config.method,
    headers: config.headers,
    dataKeys: config.data ? Object.keys(config.data) : [],
  });
  
  try {
    const response = await axios(config);
    logger.debug('Circuit breaker httpRequest success', {
      url: config.url,
      status: response.status,
    });
    return response;
  } catch (error: any) {
    logger.error('Circuit breaker httpRequest error', {
      url: config.url,
      errorName: error.name,
      errorMessage: error.message,
      responseStatus: error.response?.status,
      responseData: error.response?.data,
    });
    throw error;
  }
};

// Create circuit breaker instance
const breaker = new CircuitBreaker(httpRequest, circuitBreakerOptions);

// Event listeners for monitoring
breaker.on('success', () => {
  logger.debug('Circuit breaker: request succeeded');
});

breaker.on('timeout', () => {
  logger.warn('Circuit breaker: request timed out');
});

breaker.on('reject', () => {
  logger.warn('Circuit breaker: request rejected (circuit open)');
});

breaker.on('open', () => {
  logger.error('🔴 Circuit breaker OPENED - failing fast', {
    stats: breaker.stats,
  });
});

breaker.on('halfOpen', () => {
  logger.info('🟡 Circuit breaker HALF-OPEN - testing recovery', {
    stats: breaker.stats,
  });
});

breaker.on('close', () => {
  logger.info('🟢 Circuit breaker CLOSED - service recovered', {
    stats: breaker.stats,
  });
});

breaker.on('fallback', (result) => {
  logger.warn('Circuit breaker: using fallback response', { result });
});

// Set fallback function
breaker.fallback(fallback);

// Circuit breaker state type
type CircuitState = 'OPEN' | 'HALF-OPEN' | 'CLOSED';

// Export resilient HTTP client
export const resilientHttp = {
  /**
   * Make a GET request with circuit breaker protection
   */
  async get<T = unknown>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T> | FallbackResponse> {
    return breaker.fire({ ...config, method: 'GET', url }) as Promise<
      AxiosResponse<T> | FallbackResponse
    >;
  },

  /**
   * Make a POST request with circuit breaker protection
   */
  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T> | FallbackResponse> {
    return breaker.fire({ ...config, method: 'POST', url, data }) as Promise<
      AxiosResponse<T> | FallbackResponse
    >;
  },

  /**
   * Make a PATCH request with circuit breaker protection
   */
  async patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T> | FallbackResponse> {
    return breaker.fire({ ...config, method: 'PATCH', url, data }) as Promise<
      AxiosResponse<T> | FallbackResponse
    >;
  },

  /**
   * Make a PUT request with circuit breaker protection
   */
  async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T> | FallbackResponse> {
    return breaker.fire({ ...config, method: 'PUT', url, data }) as Promise<
      AxiosResponse<T> | FallbackResponse
    >;
  },

  /**
   * Make a DELETE request with circuit breaker protection
   */
  async delete<T = unknown>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T> | FallbackResponse> {
    return breaker.fire({ ...config, method: 'DELETE', url }) as Promise<
      AxiosResponse<T> | FallbackResponse
    >;
  },

  /**
   * Get current circuit breaker statistics
   */
  getStats(): {
    state: CircuitState;
    stats: CircuitBreaker.Stats;
  } {
    let state: CircuitState = 'CLOSED';
    if (breaker.opened) {
      state = 'OPEN';
    } else if (breaker.halfOpen) {
      state = 'HALF-OPEN';
    }

    return {
      state,
      stats: breaker.stats,
    };
  },

  /**
   * Check if a response is a fallback response
   */
  isFallbackResponse(response: unknown): response is FallbackResponse {
    return (
      typeof response === 'object' &&
      response !== null &&
      'data' in response &&
      typeof (response as FallbackResponse).data === 'object' &&
      'circuit_breaker' in (response as FallbackResponse).data &&
      (response as FallbackResponse).data.circuit_breaker === true
    );
  },

  /**
   * Reset circuit breaker (close it manually)
   */
  reset(): void {
    breaker.close();
    logger.info('🔄 Circuit breaker manually reset (closed)');
  },
};

// Export the breaker instance for advanced usage
export default breaker;
