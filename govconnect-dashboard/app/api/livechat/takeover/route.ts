import { NextRequest, NextResponse } from 'next/server'
import { verifyUserToken } from '@/lib/auth'
import { livechat } from '@/lib/api-client'

async function getAuthUser(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  const token = authHeader.split(' ')[1]
  return await verifyUserToken(token)
}

/**
 * GET /api/livechat/takeover
 * Get all active takeover sessions
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const response = await livechat.getTakeovers()
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching takeovers:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch takeovers' },
      { status: 500 }
    )
  }
}
