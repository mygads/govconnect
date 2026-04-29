import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedInternalRequest } from '@/lib/internal-api-auth'
import prisma from '@/lib/prisma'

// Internal API for AI service to get single knowledge item

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/internal/knowledge/[id]
 * Get a single knowledge item by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isAuthorizedInternalRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const knowledge = await prisma.knowledge_base.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        keywords: true,
        is_active: true,
        priority: true,
      },
    })

    if (!knowledge) {
      return NextResponse.json({ error: 'Knowledge not found' }, { status: 404 })
    }

    return NextResponse.json({ data: knowledge })
  } catch (error) {
    console.error('Error fetching knowledge:', error)
    return NextResponse.json(
      { error: 'Failed to fetch knowledge' },
      { status: 500 }
    )
  }
}
