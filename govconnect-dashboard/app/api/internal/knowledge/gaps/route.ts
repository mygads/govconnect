import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import crypto from 'crypto'

// Internal API for AI service to report knowledge gaps
// Called when RAG confidence is low/none for a knowledge-seeking query

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizeInternalApiKey(value: string | null): string | null {
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

function getProvidedInternalApiKey(request: NextRequest): string | null {
  return (
    normalizeInternalApiKey(request.headers.get('x-internal-api-key')) ||
    normalizeInternalApiKey(request.headers.get('authorization'))
  )
}

function verifyInternalApiKey(request: NextRequest): boolean {
  const expectedApiKey = normalizeInternalApiKey(
    process.env['INTERNAL_API_KEY'] || null
  )
  if (!expectedApiKey) return false
  const apiKey = getProvidedInternalApiKey(request)
  return apiKey === expectedApiKey
}

/**
 * POST — AI service reports a knowledge gap
 * Body: { query_text, intent, confidence_level, channel, village_id? }
 */
export async function POST(request: NextRequest) {
  try {
    if (!verifyInternalApiKey(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { query_text, intent, confidence_level, channel, village_id } = body

    if (!query_text || typeof query_text !== 'string' || query_text.trim().length < 3) {
      return NextResponse.json({ error: 'query_text is required (min 3 chars)' }, { status: 400 })
    }

    // Normalize and hash for deduplication
    const normalized = query_text.toLowerCase().replace(/[^a-z0-9\s]/gi, '').trim()
    const queryHash = crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 32)

    // Upsert: increment hit_count if the same query (hash + village) already exists
    const gap = await prisma.knowledge_gaps.upsert({
      where: {
        query_hash_village_id: {
          query_hash: queryHash,
          village_id: village_id || '',
        },
      },
      update: {
        hit_count: { increment: 1 },
        last_seen_at: new Date(),
        // Re-open if it was previously ignored but keeps getting asked
        status: undefined, // Don't change status on update
      },
      create: {
        query_text: query_text.substring(0, 500),
        query_hash: queryHash,
        intent: intent || 'UNKNOWN',
        confidence_level: confidence_level || 'none',
        channel: channel || 'whatsapp',
        village_id: village_id || null,
        hit_count: 1,
        status: 'open',
      },
    })

    return NextResponse.json({ id: gap.id, hit_count: gap.hit_count }, { status: 200 })
  } catch (error: any) {
    console.error('[Internal API] Failed to record knowledge gap:', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET — List knowledge gaps (for admin dashboard consumption)
 * Query params: village_id, status (open|resolved|ignored), limit, offset
 */
export async function GET(request: NextRequest) {
  try {
    if (!verifyInternalApiKey(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const villageId = searchParams.get('village_id')
    const status = searchParams.get('status') || 'open'
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')

    const where: any = {}
    if (villageId) where.village_id = villageId
    if (status !== 'all') where.status = status

    const [gaps, total] = await Promise.all([
      prisma.knowledge_gaps.findMany({
        where,
        orderBy: [{ hit_count: 'desc' }, { last_seen_at: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.knowledge_gaps.count({ where }),
    ])

    return NextResponse.json({ data: gaps, total, limit, offset })
  } catch (error: any) {
    console.error('[Internal API] Failed to list knowledge gaps:', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
