import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, JWTPayload } from '@/lib/auth'

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://localhost:3001'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

async function getAuthUser(request: NextRequest): Promise<JWTPayload | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  const token = authHeader.split(' ')[1]
  return await verifyToken(token)
}

/**
 * GET /api/livechat/takeover/[wa_user_id]
 * Check if user is in takeover mode
 */
export async function GET(
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
      `${CHANNEL_SERVICE_URL}/internal/takeover/${encodeURIComponent(wa_user_id)}/status`,
      {
        headers: {
          'X-Internal-API-Key': INTERNAL_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    )

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error checking takeover status:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to check takeover status' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/livechat/takeover/[wa_user_id]
 * Start takeover for a user
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
    const body = await request.json()

    const response = await fetch(
      `${CHANNEL_SERVICE_URL}/internal/takeover/${encodeURIComponent(wa_user_id)}`,
      {
        method: 'POST',
        headers: {
          'X-Internal-API-Key': INTERNAL_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          admin_id: user.adminId,
          admin_name: user.name,
          reason: body.reason,
        }),
      }
    )

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error starting takeover:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to start takeover' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/livechat/takeover/[wa_user_id]
 * End takeover for a user
 */
export async function DELETE(
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
      `${CHANNEL_SERVICE_URL}/internal/takeover/${encodeURIComponent(wa_user_id)}`,
      {
        method: 'DELETE',
        headers: {
          'X-Internal-API-Key': INTERNAL_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    )

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error ending takeover:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to end takeover' },
      { status: 500 }
    )
  }
}
