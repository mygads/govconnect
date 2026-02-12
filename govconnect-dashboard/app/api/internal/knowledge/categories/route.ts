import { NextRequest, NextResponse } from 'next/server'
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

function getInternalApiKey(): string | null {
  return process.env['INTERNAL_API_KEY'] || null
}

function normalizeKey(value: string | null): string | null {
  if (!value) return null
  let key = value.trim()
  if (key.toLowerCase().startsWith('bearer ')) {
    key = key.slice('bearer '.length).trim()
  }
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim()
  }
  return key.length > 0 ? key : null
}

export async function GET(request: NextRequest) {
  try {
    const expectedApiKey = normalizeKey(getInternalApiKey())
    const apiKey =
      normalizeKey(request.headers.get('x-internal-api-key')) ||
      normalizeKey(request.headers.get('authorization'))

    if (!expectedApiKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }
    if (!apiKey || apiKey !== expectedApiKey) {
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
