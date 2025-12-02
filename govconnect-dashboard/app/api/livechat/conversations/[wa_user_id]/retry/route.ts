import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://localhost:3001'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

async function getAuthUser(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  const token = authHeader.split(' ')[1]
  return await verifyToken(token)
}

/**
 * POST /api/livechat/conversations/[wa_user_id]/retry
 * Retry AI processing for a failed message
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ wa_user_id: string }> }
) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { wa_user_id } = await params

    const response = await fetch(
      `${CHANNEL_SERVICE_URL}/internal/conversations/${encodeURIComponent(wa_user_id)}/retry`,
      {
        method: 'POST',
        headers: {
          'X-Internal-API-Key': INTERNAL_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    )

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error retrying AI:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to retry AI processing' },
      { status: 500 }
    )
  }
}
