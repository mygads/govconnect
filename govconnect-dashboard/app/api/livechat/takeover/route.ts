import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { livechat } from '@/lib/api-client'

/**
 * GET /api/livechat/takeover
 * Get all active takeover sessions
 */
export async function GET(request: NextRequest) {
  try {
    const [session, authError] = await requireAuth(request)
    if (authError) return authError

    const response = await livechat.getTakeovers(session.villageId || undefined)
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error fetching takeovers:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch takeovers' },
      { status: 500 }
    )
  }
}
