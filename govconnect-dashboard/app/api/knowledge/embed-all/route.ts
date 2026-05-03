import { NextRequest, NextResponse } from 'next/server'
import { ai, API_BASE_URL } from '@/lib/api-client'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true }
  })
  if (!session || session.expires_at < new Date()) return null
  return session
}

/**
 * POST /api/knowledge/embed-all
 * Trigger embedding generation for all knowledge items
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const villageId = session.admin.village_id
    if (!villageId) {
      return NextResponse.json({ error: 'Admin belum terhubung ke desa.' }, { status: 400 })
    }

    const attemptedKnowledge = await prisma.knowledge_base.findMany({
      where: { is_active: true, village_id: villageId },
      orderBy: [
        { priority: 'desc' },
        { updated_at: 'desc' },
      ],
      take: 500,
      select: { id: true },
    })
    const attemptedIds = attemptedKnowledge.map((item) => item.id)

    const response = await ai.embedAllKnowledge(villageId)

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'AI service error')
    }

    const result = await response.json()
    const failedIds = Array.isArray(result.failed_ids) ? result.failed_ids.filter((id: unknown): id is string => typeof id === 'string') : []
    const failedIdSet = new Set(failedIds)
    const successfulIds = attemptedIds.filter((id) => !failedIdSet.has(id))
    const embeddedAt = new Date()

    await Promise.all([
      successfulIds.length > 0
        ? prisma.knowledge_base.updateMany({
            where: { id: { in: successfulIds }, village_id: villageId },
            data: {
              embedding_status: 'completed',
              last_embedded_at: embeddedAt,
              embedding_error: null,
            },
          })
        : Promise.resolve(),
      failedIds.length > 0
        ? prisma.knowledge_base.updateMany({
            where: { id: { in: failedIds }, village_id: villageId },
            data: {
              embedding_status: 'failed',
              embedding_error: 'Bulk embedding failed in AI service',
            },
          })
        : Promise.resolve(),
    ])

    return NextResponse.json({
      success: true,
      message: `Processed ${result.processed} knowledge items`,
      processed: result.processed,
      failed: result.failed,
      total: result.total,
      status_updated: successfulIds.length,
      failed_ids: failedIds,
    })
  } catch (error: any) {
    console.error('Error triggering embedding:', error)

    // Better error message for connection refused
    if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      return NextResponse.json(
        {
          error: 'AI Service is not running',
          details: `Cannot connect to AI Service at ${API_BASE_URL}/ai. Please start the AI Service first.`,
          hint: 'Run: cd govconnect-ai-service && pnpm run dev'
        },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to trigger embedding', details: error.message },
      { status: 500 }
    )
  }
}
