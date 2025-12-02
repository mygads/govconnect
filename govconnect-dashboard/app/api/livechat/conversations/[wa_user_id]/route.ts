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
 * GET /api/livechat/conversations/[wa_user_id]
 * Get a specific conversation with message history
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
      `${CHANNEL_SERVICE_URL}/internal/conversations/${encodeURIComponent(wa_user_id)}`,
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
    console.error('Error fetching conversation:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch conversation' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/livechat/conversations/[wa_user_id]
 * Delete conversation and all messages for a user
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
      `${CHANNEL_SERVICE_URL}/internal/conversations/${encodeURIComponent(wa_user_id)}`,
      {
        method: 'DELETE',
        headers: {
          'X-Internal-API-Key': INTERNAL_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    )

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error deleting conversation:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete conversation' },
      { status: 500 }
    )
  }
}
