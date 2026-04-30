import { NextRequest, NextResponse } from 'next/server'
import { ai, API_BASE_URL } from '@/lib/api-client'
import prisma from '@/lib/prisma'

/**
 * POST /api/knowledge/embed-all
 * Trigger embedding generation for all knowledge items
 */
export async function POST(request: NextRequest) {
  try {
    const attemptedKnowledge = await prisma.knowledge_base.findMany({
      where: { is_active: true },
      orderBy: [
        { priority: 'desc' },
        { updated_at: 'desc' },
      ],
      take: 500,
      select: { id: true },
    })
    const attemptedIds = attemptedKnowledge.map((item) => item.id)

    const response = await ai.embedAllKnowledge()

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
            where: { id: { in: successfulIds } },
            data: {
              embedding_status: 'completed',
              last_embedded_at: embeddedAt,
              embedding_error: null,
            },
          })
        : Promise.resolve(),
      failedIds.length > 0
        ? prisma.knowledge_base.updateMany({
            where: { id: { in: failedIds } },
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
