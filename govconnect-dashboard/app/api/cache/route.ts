import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getHeaders, apiFetch, ServicePath } from '@/lib/api-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/cache — Get cache stats from AI service
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session || session.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = buildUrl(ServicePath.AI, '/admin/cache/stats')
    const response = await apiFetch(url, {
      headers: getHeaders(),
      timeout: 10000,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error')
      return NextResponse.json(
        { error: 'Failed to fetch cache stats', detail: errText },
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
 * Body: { action: 'clear-all' | 'set-mode', enabled?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session || session.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { action, enabled } = body

    if (action === 'clear-all') {
      const url = buildUrl(ServicePath.AI, '/admin/cache/clear-all')
      const response = await apiFetch(url, {
        method: 'POST',
        headers: getHeaders(),
        timeout: 10000,
      })

      if (!response.ok) {
        return NextResponse.json({ error: 'Failed to clear caches' }, { status: response.status })
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
        return NextResponse.json({ error: 'Failed to set cache mode' }, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json(data)
    }

    return NextResponse.json({ error: 'Invalid action. Use "clear-all" or "set-mode"' }, { status: 400 })
  } catch (error: any) {
    console.error('Cache API POST error:', error.message)
    return NextResponse.json(
      { error: 'AI service unreachable', detail: error.message },
      { status: 502 }
    )
  }
}
