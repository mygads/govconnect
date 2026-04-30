import { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, getInternalApiKey, ServicePath } from '@/lib/api-client'

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true },
  })
  if (!session || session.expires_at < new Date()) return null
  return session
}

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(buildUrl(ServicePath.CHANNEL, '/internal/livechat/events'))
  if (session.admin.village_id) {
    url.searchParams.set('village_id', session.admin.village_id)
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
