# Tanggapin AI Shared Libraries

Shared utilities untuk semua layanan Tanggapin AI dengan fokus pada resilience dan observability.

## 📦 Components

### 1. Circuit Breaker (`circuit-breaker.ts`)

Implementasi Circuit Breaker pattern untuk mencegah cascading failures.

**Features:**
- 3 states: CLOSED, OPEN, HALF_OPEN
- Automatic failure detection
- Configurable thresholds
- Metrics collection
- Manual reset capability

**Usage:**

```typescript
import { createCircuitBreaker } from '../shared/circuit-breaker';

const breaker = createCircuitBreaker('my-service', {
  failureThreshold: 5,      // Open after 5 failures
  successThreshold: 2,      // Close after 2 successes
  timeout: 10000,           // Request timeout 10s
  resetTimeout: 30000,      // Try again after 30s
});

// Execute with circuit breaker
try {
  const result = await breaker.execute(
    async () => {
      // Your async operation
      return await someApiCall();
    },
    async () => {
      // Optional fallback
      return defaultValue;
    }
  );
} catch (error) {
  // Handle error
}

// Get metrics
const metrics = breaker.getMetrics();
console.log(metrics.state); // CLOSED, OPEN, or HALF_OPEN
```

---

### 2. HTTP Client (`http-client.ts`)

Resilient HTTP client dengan Circuit Breaker, retry, dan timeout.

**Features:**
- Circuit breaker integration
- Automatic retries with exponential backoff
- Request/response logging
- Timeout handling
- Metrics collection

**Usage:**

```typescript
import { createHttpClient } from '../shared/http-client';

const client = createHttpClient('case-service', {
  baseURL: 'http://case-service:3003',
  timeout: 10000,
  retries: 3,
  retryDelay: 1000,
  headers: {
    'X-API-Key': process.env.INTERNAL_API_KEY,
  },
  circuitBreakerOptions: {
    failureThreshold: 5,
    resetTimeout: 30000,
  },
});

// Make requests
const response = await client.get('/api/cases/123');
const created = await client.post('/api/cases', { data });

// Get circuit breaker metrics
const metrics = client.getMetrics();
console.log(metrics);
```

---

### 3. Structured Logger (`logger.ts`)

JSON logger untuk centralized logging dengan Loki.

**Features:**
- JSON output (Loki-friendly)
- Log levels: DEBUG, INFO, WARN, ERROR
- Correlation ID support
- Request logging middleware
- Structured context

**Usage:**

```typescript
import { createLogger, requestLoggerMiddleware } from '../shared/logger';

// Create logger
const logger = createLogger('channel-service', process.env.LOG_LEVEL);

// Basic logging
logger.info('Service started', { port: 3001 });
logger.error('Database error', error, { query: 'SELECT *' });

// Child logger with context
const requestLogger = logger.child({
  correlationId: req.correlationId,
  userId: req.user?.id,
});

requestLogger.info('Processing request');

// Express middleware
app.use(requestLoggerMiddleware(logger));
```

**Log Output:**
```json
{
  "timestamp": "2024-12-08T10:30:00.000Z",
  "level": "info",
  "service": "channel-service",
  "message": "Request completed",
  "correlationId": "1733652600000-abc123",
  "method": "POST",
  "path": "/webhook/whatsapp",
  "statusCode": 200,
  "duration": 45
}
```

---

## 🚀 Integration Guide

### Step 1: Install Dependencies

```bash
npm install axios
```

### Step 2: Copy Shared Files

Copy `circuit-breaker.ts`, `http-client.ts`, dan `logger.ts` ke folder `shared/` di setiap service.

### Step 3: Update Service Code

**Example: Channel Service calling Case Service**

```typescript
// src/clients/case-service.client.ts
import { createHttpClient } from '../shared/http-client';

const caseServiceClient = createHttpClient('case-service', {
  baseURL: process.env.CASE_SERVICE_URL || 'http://case-service:3003',
  timeout: 10000,
  retries: 3,
  headers: {
    'X-API-Key': process.env.INTERNAL_API_KEY,
  },
});

export async function createCase(data: any) {
  const response = await caseServiceClient.post('/internal/cases', data);
  return response.data;
}

export async function getCaseById(id: string) {
  const response = await caseServiceClient.get(`/internal/cases/${id}`);
  return response.data;
}
```

### Step 4: Replace Logger

```typescript
// Before
import logger from './utils/logger';

// After
import { createLogger } from './shared/logger';
const logger = createLogger('channel-service', process.env.LOG_LEVEL);
```

### Step 5: Add Metrics Endpoint

```typescript
// src/routes/metrics.routes.ts
import { Router } from 'express';
import { register } from 'prom-client';

const router = Router();

router.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  const metrics = await register.metrics();
  res.send(metrics);
});

export default router;

// In app.ts
import metricsRoutes from './routes/metrics.routes';
app.use('/metrics', metricsRoutes);
```

---

## 📊 Monitoring

### Prometheus Metrics

Services akan expose metrics di `/metrics` endpoint:
- HTTP request duration
- Circuit breaker state
- Request count by status code
- Custom business metrics

### Loki Logs

Logs akan otomatis di-collect oleh Promtail dan dikirim ke Loki.

**Query di Grafana:**
```logql
# All logs from channel-service
{service="channel-service"}

# Error logs only
{service="channel-service"} |= "error"

# Logs with specific correlation ID
{service="channel-service"} | json | correlationId="1733652600000-abc123"

# Slow requests (>1s)
{service="channel-service"} | json | duration > 1000
```

---

## 🔧 Configuration

### Environment Variables

```env
# Logging
LOG_LEVEL=info  # debug, info, warn, error

# Circuit Breaker (optional, defaults provided)
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_RESET_TIMEOUT=30000

# HTTP Client
HTTP_CLIENT_TIMEOUT=10000
HTTP_CLIENT_RETRIES=3
```

---

## 📈 Best Practices

1. **Always use Circuit Breaker** untuk external service calls
2. **Use Structured Logger** untuk semua logging (jangan console.log)
3. **Include Correlation ID** di semua inter-service requests
4. **Set appropriate timeouts** sesuai SLA service
5. **Monitor circuit breaker metrics** untuk detect issues early
6. **Use fallback** untuk non-critical operations

---

## 🐛 Troubleshooting

### Circuit Breaker Stuck in OPEN State

```typescript
// Check metrics
const metrics = client.getMetrics();
console.log(metrics);

// Manual reset if needed
client.resetCircuitBreaker();
```

### Logs Not Appearing in Loki

1. Check Promtail is running: `docker ps | grep promtail`
2. Check Loki is healthy: `curl http://localhost:3101/ready`
3. Verify JSON format: logs harus valid JSON
4. Check Grafana data source configuration

### High Memory Usage

1. Reduce Loki retention: `retention_period: 168h` (7 days)
2. Reduce Prometheus retention: `--storage.tsdb.retention.time=7d`
3. Set resource limits di docker-compose.yml

---

## 📚 References

- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Grafana Loki Documentation](https://grafana.com/docs/loki/latest/)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/)
