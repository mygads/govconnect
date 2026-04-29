import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedInternalRequest } from '@/lib/internal-api-auth'
import prisma from '@/lib/prisma'

/**
 * Internal API for AI service to fetch knowledge categories.
 * Returns the dynamic list of categories per village so
 * NLU classification, chunking, and RAG can use them instead of hardcoded lists.
 *
 * GET /api/internal/knowledge/categories?village_id=xxx
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedInternalRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const villageId = request.nextUrl.searchParams.get('village_id')
    if (!villageId) {
      return NextResponse.json({ error: 'village_id is required' }, { status: 400 })
    }

    const categories = await prisma.knowledge_categories.findMany({
      where: { village_id: villageId },
      select: { id: true, name: true, is_default: true },
      orderBy: { name: 'asc' },
    })

    // Return both human-readable names and slug versions for NLU/RAG
    const data = categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: toSlug(c.name),
      is_default: c.is_default,
    }))

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[Internal API] Error fetching knowledge categories:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Convert human-readable name to a consistent slug for matching */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\/\\]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
}
