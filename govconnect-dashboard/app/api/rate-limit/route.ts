import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { ai } from '@/lib/api-client'

// GET - Get rate limit config and stats
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Allow superadmin and village_admin
    if (payload.role !== 'superadmin' && payload.role !== 'village_admin' && payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const response = await ai.getRateLimit()
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      return NextResponse.json(
        data || { error: 'Failed to fetch rate limit config', code: 'UPSTREAM_UNAVAILABLE' },
        { status: response.status },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching rate limit:', error)
    return NextResponse.json(
      { error: 'Failed to fetch rate limit' },
      { status: 500 }
    )
  }
}
