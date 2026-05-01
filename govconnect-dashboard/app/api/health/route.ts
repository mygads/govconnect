import { NextResponse } from 'next/server'
import { buildUrl, ServicePath } from '@/lib/api-client'

type ServiceHealth = {
  name: 'ai' | 'case' | 'channel'
  ok: boolean
  status: number | null
  error?: string
}

async function checkService(name: ServiceHealth['name'], service: (typeof ServicePath)[keyof typeof ServicePath], path: string): Promise<ServiceHealth> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const response = await fetch(buildUrl(service, path), {
      cache: 'no-store',
      signal: controller.signal,
    })
    return { name, ok: response.ok, status: response.status }
  } catch (error: any) {
    return { name, ok: false, status: null, error: error?.name === 'AbortError' ? 'timeout' : 'unreachable' }
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET() {
  const services = await Promise.all([
    checkService('ai', ServicePath.AI, '/health'),
    checkService('case', ServicePath.CASE, '/health'),
    checkService('channel', ServicePath.CHANNEL, '/health'),
  ])
  const degraded = services.some((service) => !service.ok)

  return NextResponse.json({
    status: degraded ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    service: 'govconnect-dashboard',
    services,
  }, { status: degraded ? 503 : 200 })
}
