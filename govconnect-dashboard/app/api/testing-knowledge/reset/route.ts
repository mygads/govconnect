import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getInternalApiKey } from '@/lib/api-client'

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const prismaClient = prisma as any
  const session = await prismaClient.admin_sessions.findUnique({
    where: { token },
    include: { admin: true },
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

    const userId = session.admin?.id ? `admin_test_${session.admin.id}` : null
    if (!userId) {
      return NextResponse.json({ error: 'Admin session tidak valid' }, { status: 400 })
    }

    const response = await fetch(buildUrl(ServicePath.AI, '/admin/cache/clear-user'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': getInternalApiKey(),
      },
      body: JSON.stringify({ userId }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => 'Unknown error')
      return NextResponse.json(
        { error: 'Failed to clear testing knowledge context', detail },
        { status: response.status },
      )
    }

    return NextResponse.json({ success: true, userId })
  } catch (error: any) {
    console.error('Testing knowledge reset error:', error)
    return NextResponse.json(
      { error: 'AI service unavailable', detail: error.message },
      { status: 502 },
    )
  }
}
