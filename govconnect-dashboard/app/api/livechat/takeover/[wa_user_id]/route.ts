import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { livechat } from '@/lib/api-client'

async function getSession(request: NextRequest) {
  const token =
    request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true },
  })
  if (!session || session.expires_at < new Date()) return null
  return session
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
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { wa_user_id } = await params
    const response = await livechat.getTakeoverStatus(wa_user_id, session.admin.village_id || undefined)
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
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { wa_user_id } = await params

    const response = await livechat.startTakeover(
      wa_user_id,
      {
        admin_id: session.admin.id,
        admin_name: session.admin.name,
      },
      session.admin.village_id || undefined
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
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { wa_user_id } = await params
    const response = await livechat.endTakeover(wa_user_id, session.admin.village_id || undefined)
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
