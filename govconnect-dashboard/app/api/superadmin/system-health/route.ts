import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getHeaders, ServicePath, CHANNEL_SERVICE_URL, AI_SERVICE_URL, CASE_SERVICE_URL, NOTIFICATION_SERVICE_URL } from '@/lib/api-client'

interface ServiceHealth {
  name: string
  url: string
  status: 'healthy' | 'unhealthy' | 'unknown'
  responseTime: number
  details?: any
  error?: string
}

async function checkService(name: string, serviceUrl: string, healthPath: string = '/health'): Promise<ServiceHealth> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const url = serviceUrl ? `${serviceUrl}${healthPath}` : ''
    if (!url) {
      return { name, url: 'Not configured', status: 'unknown', responseTime: 0, error: 'URL not configured' }
    }

    const res = await fetch(url, {
      headers: { 'x-internal-api-key': process.env['INTERNAL_API_KEY'] || '' },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const responseTime = Date.now() - start
    let details = null
    try { details = await res.json() } catch {}

    return {
      name,
      url: serviceUrl,
      status: res.ok ? 'healthy' : 'unhealthy',
      responseTime,
      details,
    }
  } catch (err: any) {
    return {
      name,
      url: serviceUrl || 'Not configured',
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error: err.message || 'Connection failed',
    }
  }
}

// GET - Check health of all microservices
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session || session.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check all services in parallel
    const [channelHealth, aiHealth, caseHealth, notificationHealth] = await Promise.all([
      checkService('Channel Service', CHANNEL_SERVICE_URL, '/health'),
      checkService('AI Service', AI_SERVICE_URL, '/health'),
      checkService('Case Service', CASE_SERVICE_URL, '/health'),
      checkService('Notification Service', NOTIFICATION_SERVICE_URL, '/health'),
    ])

    // Dashboard self-health
    const dashboardHealth: ServiceHealth = {
      name: 'Dashboard',
      url: 'localhost',
      status: 'healthy',
      responseTime: 0,
      details: { status: 'ok', timestamp: new Date().toISOString() },
    }

    const services = [dashboardHealth, channelHealth, aiHealth, caseHealth, notificationHealth]
    const healthyCount = services.filter(s => s.status === 'healthy').length

    return NextResponse.json({
      overall: healthyCount === services.length ? 'healthy' : healthyCount > 0 ? 'degraded' : 'down',
      timestamp: new Date().toISOString(),
      services,
      summary: {
        total: services.length,
        healthy: healthyCount,
        unhealthy: services.filter(s => s.status === 'unhealthy').length,
        unknown: services.filter(s => s.status === 'unknown').length,
      },
    })
  } catch (error) {
    console.error('Error checking system health:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
