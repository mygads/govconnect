import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders } from '@/lib/api-client'

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const prismaClient = prisma as any
  const session = await prismaClient.admin_sessions.findUnique({
    where: { token },
    include: { admin: true }
  })
  if (!session || session.expires_at < new Date()) return null
  return session
}

function getTestingChatFailureStatus(result: any) {
  const intent = result?.data?.intent

  if (intent === 'WALLET_EXHAUSTED') {
    return 503
  }

  if (intent === 'ERROR') {
    return 502
  }

  return 422
}

function getTestingChatFailureMessage(result: any) {
  const responseText = typeof result?.data?.response === 'string'
    ? result.data.response.trim()
    : ''

  return responseText || result?.data?.error || result?.error || 'Gagal memproses pertanyaan'
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request) as any
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { query, conversationHistory } = body

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query wajib diisi' }, { status: 400 })
    }

    const safeConversationHistory = Array.isArray(conversationHistory)
      ? conversationHistory
          .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
          .map((item) => ({ role: item.role, content: item.content }))
          .slice(-30)
      : []

    const response = await fetch(buildUrl(ServicePath.AI, '/api/testing/chat'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        message: query,
        village_id: session.admin?.village_id || undefined,
        user_id: session.admin?.id ? `admin_test_${session.admin.id}` : undefined,
        conversationHistory: safeConversationHistory,
      }),
    })

    let result: any = null
    try {
      result = await response.json()
    } catch {
      result = null
    }

    if (!response.ok) {
      const upstreamError = result?.error || result?.message || 'Gagal memproses pertanyaan'
      return NextResponse.json(
        {
          success: false,
          error: response.status >= 500 ? `AI service error: ${upstreamError}` : upstreamError,
        },
        { status: response.status }
      )
    }

    if (result?.success === false) {
      return NextResponse.json(
        {
          success: false,
          error: getTestingChatFailureMessage(result),
          data: result?.data,
        },
        { status: getTestingChatFailureStatus(result) }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Testing knowledge error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'AI service unavailable',
      },
      { status: 502 }
    )
  }
}
