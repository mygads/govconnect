/**
 * Prometheus Metrics Middleware
 *
 * Provides metrics collection for Express.js services
 * Compatible with Prometheus/Grafana monitoring stack
 */

import { Request, Response, NextFunction } from 'express';
import promClient from 'prom-client';

// Initialize default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({
  prefix: 'govconnect_',
  labels: { service: process.env.SERVICE_NAME || 'unknown' },
});

// ==================== Custom Metrics ====================

// HTTP Request Duration Histogram
const httpRequestDuration = new promClient.Histogram({
  name: 'govconnect_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'service'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// HTTP Request Total Counter
const httpRequestTotal = new promClient.Counter({
  name: 'govconnect_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'service'],
});

// HTTP Request Size
const httpRequestSize = new promClient.Histogram({
  name: 'govconnect_http_request_size_bytes',
  help: 'Size of HTTP requests in bytes',
  labelNames: ['method', 'route', 'service'],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000],
});

// HTTP Response Size
const httpResponseSize = new promClient.Histogram({
  name: 'govconnect_http_response_size_bytes',
  help: 'Size of HTTP responses in bytes',
  labelNames: ['method', 'route', 'service'],
  buckets: [100, 500, 1000, 5000, 10000, 50000, 100000],
});

// Active Connections
const activeConnections = new promClient.Gauge({
  name: 'govconnect_active_connections',
  help: 'Number of active connections',
  labelNames: ['service'],
});

// Error Rate
const errorCounter = new promClient.Counter({
  name: 'govconnect_errors_total',
  help: 'Total number of errors',
  labelNames: ['service', 'error_type', 'route'],
});

// ==================== Service-Specific Metrics ====================

// Message processing (Channel Service)
export const messageMetrics = {
  received: new promClient.Counter({
    name: 'govconnect_messages_received_total',
    help: 'Total messages received',
    labelNames: ['service', 'direction'],
  }),
  sent: new promClient.Counter({
    name: 'govconnect_messages_sent_total',
    help: 'Total messages sent',
    labelNames: ['service', 'status'],
  }),
  processingTime: new promClient.Histogram({
    name: 'govconnect_message_processing_seconds',
    help: 'Time to process a message',
    labelNames: ['service'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  }),
};

// AI Service Metrics
export const aiMetrics = {
  llmCalls: new promClient.Counter({
    name: 'govconnect_llm_calls_total',
    help: 'Total LLM API calls',
    labelNames: ['model', 'status'],
  }),
  llmLatency: new promClient.Histogram({
    name: 'govconnect_llm_latency_seconds',
    help: 'LLM API call latency',
    labelNames: ['model'],
    buckets: [0.5, 1, 2, 5, 10, 30],
  }),
  tokensUsed: new promClient.Counter({
    name: 'govconnect_tokens_used_total',
    help: 'Total tokens used',
    labelNames: ['model', 'type'],
  }),
  intentDetected: new promClient.Counter({
    name: 'govconnect_intents_detected_total',
    help: 'Number of intents detected',
    labelNames: ['intent'],
  }),
  circuitBreakerState: new promClient.Gauge({
    name: 'govconnect_circuit_breaker_state',
    help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
    labelNames: ['target_service'],
  }),
};

// Case Service Metrics
export const caseMetrics = {
  complaintsCreated: new promClient.Counter({
    name: 'govconnect_complaints_created_total',
    help: 'Total complaints created',
    labelNames: ['category'],
  }),
  serviceRequestsCreated: new promClient.Counter({
    name: 'govconnect_service_requests_created_total',
    help: 'Total service requests created',
    labelNames: ['service_id'],
  }),
  statusUpdates: new promClient.Counter({
    name: 'govconnect_status_updates_total',
    help: 'Total status updates',
    labelNames: ['from_status', 'to_status'],
  }),
};

// Notification Service Metrics
export const notificationMetrics = {
  sent: new promClient.Counter({
    name: 'govconnect_notifications_sent_total',
    help: 'Total notifications sent',
    labelNames: ['type', 'status'],
  }),
  failed: new promClient.Counter({
    name: 'govconnect_notifications_failed_total',
    help: 'Total failed notifications',
    labelNames: ['type', 'error'],
  }),
};

// RabbitMQ Metrics
export const rabbitMQMetrics = {
  messagesPublished: new promClient.Counter({
    name: 'govconnect_rabbitmq_messages_published_total',
    help: 'Total messages published to RabbitMQ',
    labelNames: ['exchange', 'routing_key'],
  }),
  messagesConsumed: new promClient.Counter({
    name: 'govconnect_rabbitmq_messages_consumed_total',
    help: 'Total messages consumed from RabbitMQ',
    labelNames: ['queue'],
  }),
  connectionStatus: new promClient.Gauge({
    name: 'govconnect_rabbitmq_connected',
    help: 'RabbitMQ connection status (1=connected, 0=disconnected)',
    labelNames: ['service'],
  }),
};

// ==================== Middleware ====================

/**
 * Express middleware to collect HTTP metrics
 */
export function metricsMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // Track active connections
    activeConnections.inc({ service: serviceName });

    // Track request size
    const requestSize = parseInt(req.headers['content-length'] || '0', 10);
    if (requestSize > 0) {
      httpRequestSize.observe(
        {
          method: req.method,
          route: getRoutePath(req),
          service: serviceName,
        },
        requestSize
      );
    }

    // On response finish
    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const route = getRoutePath(req);
      const statusCode = res.statusCode.toString();

      // Record metrics
      httpRequestDuration.observe(
        {
          method: req.method,
          route,
          status_code: statusCode,
          service: serviceName,
        },
        duration
      );

      httpRequestTotal.inc({
        method: req.method,
        route,
        status_code: statusCode,
        service: serviceName,
      });

      // Track response size
      const responseSize = parseInt(res.get('content-length') || '0', 10);
      if (responseSize > 0) {
        httpResponseSize.observe(
          {
            method: req.method,
            route,
            service: serviceName,
          },
          responseSize
        );
      }

      // Track errors
      if (res.statusCode >= 400) {
        errorCounter.inc({
          service: serviceName,
          error_type: res.statusCode >= 500 ? 'server_error' : 'client_error',
          route,
        });
      }

      // Decrease active connections
      activeConnections.dec({ service: serviceName });
    });

    next();
  };
}

/**
 * Express handler for /metrics endpoint
 */
export async function metricsHandler(req: Request, res: Response) {
  try {
    res.set('Content-Type', promClient.register.contentType);
    const metrics = await promClient.register.metrics();
    res.send(metrics);
  } catch (error) {
    res.status(500).send('Error collecting metrics');
  }
}

/**
 * Get normalized route path for metrics
 */
function getRoutePath(req: Request): string {
  // Use route path if available (from express router)
  if (req.route && req.route.path) {
    return req.baseUrl + req.route.path;
  }

  // Normalize path by replacing IDs with placeholders
  let path = req.path;

  // Replace common ID patterns
  path = path
    .replace(/\/[0-9a-fA-F]{24}/g, '/:id') // MongoDB ObjectId
    .replace(/\/[0-9a-fA-F-]{36}/g, '/:uuid') // UUID
    .replace(/\/\d+/g, '/:id') // Numeric ID
    .replace(/\/LAP-\d{8}-\d{3}/g, '/:complaint_id') // Complaint ID
    .replace(/\/LAY-\d{8}-\d{3}/g, '/:request_number') // Service Request ID
    .replace(/\/628\d{8,12}/g, '/:wa_user_id'); // WhatsApp ID

  return path || '/';
}

/**
 * Export the Prometheus registry for custom usage
 */
export const register = promClient.register;

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics() {
  promClient.register.resetMetrics();
}

export default {
  metricsMiddleware,
  metricsHandler,
  messageMetrics,
  aiMetrics,
  caseMetrics,
  notificationMetrics,
  rabbitMQMetrics,
  register,
  resetMetrics,
};
