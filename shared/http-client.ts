/**
 * HTTP Client with Circuit Breaker
 * 
 * Provides resilient HTTP requests with:
 * - Circuit breaker pattern
 * - Automatic retries with exponential backoff
 * - Request timeout
 * - Fallback support
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { CircuitBreaker, createCircuitBreaker } from './circuit-breaker';

export interface HttpClientOptions {
  baseURL: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  circuitBreakerOptions?: {
    failureThreshold?: number;
    successThreshold?: number;
    timeout?: number;
    resetTimeout?: number;
  };
  headers?: Record<string, string>;
}

export class ResilientHttpClient {
  private axiosInstance: AxiosInstance;
  private circuitBreaker: CircuitBreaker;
  private retries: number;
  private retryDelay: number;

  constructor(private serviceName: string, options: HttpClientOptions) {
    this.retries = options.retries || 3;
    this.retryDelay = options.retryDelay || 1000;

    // Create axios instance
    this.axiosInstance = axios.create({
      baseURL: options.baseURL,
      timeout: options.timeout || 10000,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Create circuit breaker
    this.circuitBreaker = createCircuitBreaker(serviceName, {
      timeout: options.timeout || 10000,
      ...options.circuitBreakerOptions,
    });

    // Add request interceptor for logging
    this.axiosInstance.interceptors.request.use(
      (config) => {
        console.debug(`[HttpClient:${serviceName}] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor for logging
    this.axiosInstance.interceptors.response.use(
      (response) => {
        console.debug(
          `[HttpClient:${serviceName}] Response ${response.status} from ${response.config.url}`
        );
        return response;
      },
      (error) => {
        console.error(
          `[HttpClient:${serviceName}] Error ${error.response?.status || 'NETWORK'} from ${error.config?.url}`
        );
        return Promise.reject(error);
      }
    );
  }

  /**
   * GET request with circuit breaker
   */
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.axiosInstance.get<T>(url, config));
  }

  /**
   * POST request with circuit breaker
   */
  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.axiosInstance.post<T>(url, data, config));
  }

  /**
   * PUT request with circuit breaker
   */
  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.axiosInstance.put<T>(url, data, config));
  }

  /**
   * PATCH request with circuit breaker
   */
  async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.axiosInstance.patch<T>(url, data, config));
  }

  /**
   * DELETE request with circuit breaker
   */
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(() => this.axiosInstance.delete<T>(url, config));
  }

  /**
   * Execute request with retry logic and circuit breaker
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await this.circuitBreaker.execute(fn);
    } catch (error: any) {
      // Don't retry on client errors (4xx)
      if (error.response?.status >= 400 && error.response?.status < 500) {
        throw error;
      }

      // Retry on network errors or 5xx errors
      if (attempt < this.retries) {
        const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
        console.warn(
          `[HttpClient:${this.serviceName}] Retry ${attempt}/${this.retries} after ${delay}ms`
        );
        
        await this.sleep(delay);
        return this.executeWithRetry(fn, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get circuit breaker metrics
   */
  getMetrics() {
    return this.circuitBreaker.getMetrics();
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker() {
    this.circuitBreaker.reset();
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState() {
    return this.circuitBreaker.getState();
  }
}

/**
 * Create HTTP client with circuit breaker
 */
export function createHttpClient(
  serviceName: string,
  options: HttpClientOptions
): ResilientHttpClient {
  return new ResilientHttpClient(serviceName, options);
}
