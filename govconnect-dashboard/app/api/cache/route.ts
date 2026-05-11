import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, isSuperadminRole } from '@/lib/auth'
import { buildUrl, getHeaders, apiFetch, ServicePath } from '@/lib/api-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function readUpstreamError(response: Response, fallback: string) {
  const raw = await response.text().catch(() => '')
  if (!raw) return fallback

  try {
    const payload = JSON.parse(raw)
    return payload?.error || payload?.message || payload?.detail || fallback
  } catch {
    return raw
  }
}

/**
 * GET /api/cache — Get cache stats from AI service
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session || !isSuperadminRole(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = buildUrl(ServicePath.AI, '/admin/cache/stats')
    const response = await apiFetch(url, {
      headers: getHeaders(),
      timeout: 10000,
    })

    if (!response.ok) {
      const upstreamError = await readUpstreamError(response, 'Failed to fetch cache stats')
      return NextResponse.json(
        { error: upstreamError },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Cache API error:', error.message)
    return NextResponse.json(
      { error: 'AI service unreachable', detail: error.message },
      { status: 502 }
    )
  }
}

/**
 * POST /api/cache — Cache management actions
 * Body:
 * - { action: 'clear-all' }
 * - { action: 'set-mode', enabled: boolean }
 * - { action: 'invalidate-village', villageId: string, intents?: string[], retrieval?: boolean, profile?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session || !isSuperadminRole(session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { action, enabled, villageId, intents, retrieval, profile } = body

    if (action === 'clear-all') {
      const url = buildUrl(ServicePath.AI, '/admin/cache/clear-all')
      const response = await apiFetch(url, {
        method: 'POST',
        headers: getHeaders(),
        timeout: 10000,
      })

      if (!response.ok) {
        const upstreamError = await readUpstreamError(response, 'Failed to clear caches')
        return NextResponse.json({ error: upstreamError }, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json(data)
    }

    if (action === 'set-mode') {
      if (typeof enabled !== 'boolean') {
        return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 })
      }

      const url = buildUrl(ServicePath.AI, '/admin/cache/mode')
      const response = await apiFetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ enabled }),
        timeout: 10000,
      })

      if (!response.ok) {
        const upstreamError = await readUpstreamError(response, 'Failed to set cache mode')
        return NextResponse.json({ error: upstreamError }, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json(data)
    }

    if (action === 'invalidate-village') {
      if (!villageId || typeof villageId !== 'string') {
        return NextResponse.json({ error: 'villageId is required' }, { status: 400 })
      }

      const safeIntents = Array.isArray(intents)
        ? intents.filter((intent): intent is string => typeof intent === 'string' && intent.trim().length > 0)
        : undefined

      const url = buildUrl(ServicePath.AI, '/admin/cache/invalidate-village')
      const response = await apiFetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          villageId,
          intents: safeIntents,
          retrieval: retrieval !== false,
          profile: profile !== false,
        }),
        timeout: 10000,
      })

      if (!response.ok) {
        const upstreamError = await readUpstreamError(response, 'Failed to invalidate village cache')
        return NextResponse.json({ error: upstreamError }, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json(data)
    }

    return NextResponse.json({ error: 'Invalid action. Use "clear-all", "set-mode", or "invalidate-village"' }, { status: 400 })
  } catch (error: any) {
    console.error('Cache API POST error:', error.message)
    return NextResponse.json(
      { error: 'AI service unreachable', detail: error.message },
      { status: 502 }
    )
  }
}
