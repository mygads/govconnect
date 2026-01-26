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
 * GET /api/livechat/conversations/[wa_user_id]
 * Get a specific conversation with message history
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
    const response = await livechat.getConversation(wa_user_id, session.admin.village_id || undefined)
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
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { wa_user_id } = await params
    const response = await livechat.deleteConversation(wa_user_id, session.admin.village_id || undefined)
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
