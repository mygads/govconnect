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

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request) as any
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { query } = body

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query wajib diisi' }, { status: 400 })
    }

    const response = await fetch(buildUrl(ServicePath.AI, '/api/testing/chat'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        message: query,
        village_id: session.admin?.village_id || undefined,
        user_id: session.admin?.id ? `admin_test_${session.admin.id}` : undefined,
      }),
    })

    let result: any = null
    try {
      result = await response.json()
    } catch {
      result = null
    }

    if (!response.ok) {
      if (response.status >= 500) {
        return NextResponse.json({
          success: false,
          error: result?.error || 'AI service unavailable',
        })
      }

      return NextResponse.json({ error: result?.error || 'Gagal memproses pertanyaan' }, { status: response.status })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Testing knowledge error:', error)
    return NextResponse.json({
      success: false,
      error: 'AI service unavailable',
    })
  }
}
