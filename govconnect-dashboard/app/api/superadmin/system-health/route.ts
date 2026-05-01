import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { CHANNEL_SERVICE_URL, AI_SERVICE_URL, CASE_SERVICE_URL, NOTIFICATION_SERVICE_URL } from '@/lib/api-client'

type HealthStatus = 'healthy' | 'unhealthy' | 'unknown'

interface HealthCheck {
  name: string
  url: string
  path?: string
  status: HealthStatus
  responseTime: number
  details?: any
  error?: string
}

interface ServiceHealth {
  name: string
  url: string
  status: HealthStatus
  responseTime: number
  checks: Record<string, HealthCheck>
  errors: string[]
}

function extractError(details: any, fallback: string) {
  if (!details) return fallback
  if (typeof details.error === 'string') return details.error
  if (typeof details.message === 'string') return details.message
  if (typeof details.detail === 'string') return details.detail
  if (typeof details.status === 'string' && details.status !== 'ok' && details.status !== 'connected') return details.status
  return fallback
}

function inferStatus(resOk: boolean, details: any): HealthStatus {
  if (!resOk) return 'unhealthy'

  const status = typeof details?.status === 'string' ? details.status.toLowerCase() : ''
  const database = typeof details?.database === 'string' ? details.database.toLowerCase() : ''
  const rabbitmq = typeof details?.rabbitmq === 'string' ? details.rabbitmq.toLowerCase() : ''
  const objectStorage = typeof details?.objectStorage === 'string' ? details.objectStorage.toLowerCase() : ''
  const waStatus = typeof details?.data?.status === 'string' ? details.data.status.toLowerCase() : ''

  if (status === 'not_configured' || objectStorage === 'not_configured' || waStatus === 'not_configured') return 'unknown'
  if ([status, database, rabbitmq, objectStorage, waStatus].some(value => value === 'error' || value === 'disconnected')) return 'unhealthy'
  return 'healthy'
}

async function checkEndpoint(input: {
  name: string
  baseUrl: string
  path: string
  required?: boolean
}): Promise<HealthCheck & { required: boolean }> {
  const start = Date.now()
  const required = input.required ?? true

  if (!input.baseUrl) {
    return {
      name: input.name,
      url: 'Not configured',
      path: input.path,
      status: 'unknown',
      responseTime: 0,
      error: 'URL not configured',
      required,
    }
  }

  const url = `${input.baseUrl.replace(/\/$/, '')}${input.path}`
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, {
      headers: { 'x-internal-api-key': process.env['INTERNAL_API_KEY'] || '' },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const responseTime = Date.now() - start
    let details: any = null
    try { details = await res.json() } catch {}

    const status = inferStatus(res.ok, details)
    return {
      name: input.name,
      url,
      path: input.path,
      status,
      responseTime,
      details,
      error: status === 'unhealthy' ? extractError(details, `HTTP ${res.status}`) : undefined,
      required,
    }
  } catch (err: any) {
    return {
      name: input.name,
      url,
      path: input.path,
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error: err.name === 'AbortError' ? 'Request timeout' : err.message || 'Connection failed',
      required,
    }
  }
}

function buildService(name: string, baseUrl: string, checks: Array<HealthCheck & { required: boolean }>): ServiceHealth {
  const checkMap = Object.fromEntries(checks.map(({ required, ...check }) => [check.name, check]))
  const requiredChecks = checks.filter(check => check.required)
  const hasUnhealthy = requiredChecks.some(check => check.status === 'unhealthy')
  const hasUnknown = requiredChecks.some(check => check.status === 'unknown')
  const status: HealthStatus = hasUnhealthy ? 'unhealthy' : hasUnknown ? 'unknown' : 'healthy'
  const responseTime = checks.length ? Math.max(...checks.map(check => check.responseTime)) : 0
  const errors = checks
    .filter(check => check.status === 'unhealthy' && check.error)
    .map(check => `${check.name}: ${check.error}`)

  return {
    name,
    url: baseUrl || 'Not configured',
    status,
    responseTime,
    checks: checkMap,
    errors,
  }
}

async function buildChannelHealth() {
  const checks = await Promise.all([
    checkEndpoint({ name: 'api', baseUrl: CHANNEL_SERVICE_URL, path: '/health' }),
    checkEndpoint({ name: 'database', baseUrl: CHANNEL_SERVICE_URL, path: '/health/db' }),
    checkEndpoint({ name: 'rabbitmq', baseUrl: CHANNEL_SERVICE_URL, path: '/health/rabbitmq' }),
    checkEndpoint({ name: 'objectStorage', baseUrl: CHANNEL_SERVICE_URL, path: '/health/object-storage', required: false }),
    checkEndpoint({ name: 'genfityWa', baseUrl: CHANNEL_SERVICE_URL, path: '/internal/wa-support/health' }),
  ])
  return buildService('Channel Service', CHANNEL_SERVICE_URL, checks)
}

async function buildAIHealth() {
  const checks = await Promise.all([
    checkEndpoint({ name: 'api', baseUrl: AI_SERVICE_URL, path: '/health' }),
    checkEndpoint({ name: 'database', baseUrl: AI_SERVICE_URL, path: '/admin/health/database' }),
    checkEndpoint({ name: 'rabbitmq', baseUrl: AI_SERVICE_URL, path: '/admin/health/rabbitmq' }),
  ])
  return buildService('AI Service', AI_SERVICE_URL, checks)
}

async function buildCaseHealth() {
  const checks = await Promise.all([
    checkEndpoint({ name: 'api', baseUrl: CASE_SERVICE_URL, path: '/health' }),
    checkEndpoint({ name: 'database', baseUrl: CASE_SERVICE_URL, path: '/health/database' }),
    checkEndpoint({ name: 'rabbitmq', baseUrl: CASE_SERVICE_URL, path: '/health/rabbitmq' }),
  ])
  return buildService('Case Service', CASE_SERVICE_URL, checks)
}

async function buildNotificationHealth() {
  const checks = await Promise.all([
    checkEndpoint({ name: 'api', baseUrl: NOTIFICATION_SERVICE_URL, path: '/health' }),
    checkEndpoint({ name: 'database', baseUrl: NOTIFICATION_SERVICE_URL, path: '/health/database' }),
    checkEndpoint({ name: 'rabbitmq', baseUrl: NOTIFICATION_SERVICE_URL, path: '/health/rabbitmq' }),
  ])
  return buildService('Notification Service', NOTIFICATION_SERVICE_URL, checks)
}

// GET - Check health of all microservices
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session || session.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const dashboardHealth: ServiceHealth = {
      name: 'Dashboard',
      url: 'localhost',
      status: 'healthy',
      responseTime: 0,
      checks: {
        api: {
          name: 'api',
          url: 'localhost',
          path: '/dashboard',
          status: 'healthy',
          responseTime: 0,
          details: { status: 'ok', timestamp: new Date().toISOString() },
        },
      },
      errors: [],
    }

    const [channelHealth, aiHealth, caseHealth, notificationHealth] = await Promise.all([
      buildChannelHealth(),
      buildAIHealth(),
      buildCaseHealth(),
      buildNotificationHealth(),
    ])

    const services = [dashboardHealth, channelHealth, aiHealth, caseHealth, notificationHealth]
    const healthyCount = services.filter(s => s.status === 'healthy').length
    const unhealthyCount = services.filter(s => s.status === 'unhealthy').length
    const unknownCount = services.filter(s => s.status === 'unknown').length

    return NextResponse.json({
      overall: unhealthyCount > 0 ? 'degraded' : unknownCount > 0 ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      services,
      summary: {
        total: services.length,
        healthy: healthyCount,
        unhealthy: unhealthyCount,
        unknown: unknownCount,
      },
    })
  } catch (error) {
    console.error('Error checking system health:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
