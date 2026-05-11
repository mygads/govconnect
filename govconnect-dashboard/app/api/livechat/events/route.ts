import { NextRequest } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getInternalApiKey, ServicePath } from '@/lib/api-client'

export async function GET(request: NextRequest) {
  const session = await getAdminSession(request)
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(buildUrl(ServicePath.CHANNEL, '/internal/livechat/events'))
  if (session.villageId) {
    url.searchParams.set('village_id', session.villageId)
  }

  const upstream = await fetch(url.toString(), {
    headers: {
      'x-internal-api-key': getInternalApiKey(),
      Accept: 'text/event-stream',
    },
    signal: request.signal,
  })

  if (!upstream.ok || !upstream.body) {
    return new Response('Livechat realtime unavailable', { status: upstream.status || 502 })
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
