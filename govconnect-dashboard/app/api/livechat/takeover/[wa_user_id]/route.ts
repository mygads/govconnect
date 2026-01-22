import { NextRequest, NextResponse } from 'next/server'
import { verifyUserToken, UserJWTPayload } from '@/lib/auth'
import { livechat } from '@/lib/api-client'

async function getAuthUser(request: NextRequest): Promise<UserJWTPayload | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  const token = authHeader.split(' ')[1]
  return await verifyUserToken(token)
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
    const response = await livechat.getTakeoverStatus(wa_user_id)
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

    const response = await livechat.startTakeover(wa_user_id, {
      admin_id: user.userId,
      admin_name: user.name,
    })
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
    const response = await livechat.endTakeover(wa_user_id)
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
