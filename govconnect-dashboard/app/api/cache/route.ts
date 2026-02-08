import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:3002'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

/**
 * GET /api/cache — Get cache stats from AI service
 */
export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/admin/cache/stats`, {
      headers: { 'x-internal-api-key': INTERNAL_API_KEY },
      cache: 'no-store',
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch cache stats' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'AI service unreachable' }, { status: 502 })
  }
}

/**
 * POST /api/cache — Cache management actions
 * Body: { action: 'clear-all' | 'set-mode', enabled?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, enabled } = body

    if (action === 'clear-all') {
      const response = await fetch(`${AI_SERVICE_URL}/admin/cache/clear-all`, {
        method: 'POST',
        headers: {
          'x-internal-api-key': INTERNAL_API_KEY,
          'Content-Type': 'application/json',
        },
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

      const response = await fetch(`${AI_SERVICE_URL}/admin/cache/mode`, {
        method: 'POST',
        headers: {
          'x-internal-api-key': INTERNAL_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled }),
      })

      if (!response.ok) {
        return NextResponse.json({ error: 'Failed to set cache mode' }, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json(data)
    }

    return NextResponse.json({ error: 'Invalid action. Use "clear-all" or "set-mode"' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'AI service unreachable' }, { status: 502 })
  }
}
