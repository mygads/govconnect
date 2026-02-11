import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import crypto from 'crypto'

// Internal API for AI service to report knowledge conflicts
// Called when RAG detects conflicting data from different sources

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
 * POST — AI service reports a knowledge conflict
 * Body: { source1_title, source2_title, content_summary, similarity_score, query_text?, channel?, village_id?, auto_resolved? }
 */
export async function POST(request: NextRequest) {
  try {
    if (!verifyInternalApiKey(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      source1_title,
      source2_title,
      content_summary,
      similarity_score,
      query_text,
      channel,
      village_id,
      auto_resolved,
    } = body

    if (!source1_title || !source2_title || !content_summary) {
      return NextResponse.json(
        { error: 'source1_title, source2_title, and content_summary are required' },
        { status: 400 }
      )
    }

    // Build a stable hash from source pair (order-independent) for dedup
    const sortedSources = [source1_title, source2_title].sort()
    const normalized = sortedSources
      .map(s => s.toLowerCase().replace(/[^a-z0-9\s]/gi, '').trim())
      .join('|')
    const conflictHash = crypto
      .createHash('sha256')
      .update(normalized)
      .digest('hex')
      .substring(0, 32)

    const villageIdValue = village_id || ''

    // Upsert: increment hit_count if the same conflict pair already exists
    const conflict = await prisma.knowledge_conflicts.upsert({
      where: {
        conflict_hash_village_id: {
          conflict_hash: conflictHash,
          village_id: villageIdValue,
        },
      },
      update: {
        hit_count: { increment: 1 },
        last_seen_at: new Date(),
        // Update content summary with the latest detection
        content_summary: content_summary.substring(0, 2000),
        similarity_score: similarity_score || 0,
        // If previously resolved but detected again, re-open
        ...(auto_resolved
          ? { status: 'auto_resolved', auto_resolved: true }
          : {}),
      },
      create: {
        conflict_hash: conflictHash,
        village_id: villageIdValue,
        source1_title: source1_title.substring(0, 255),
        source2_title: source2_title.substring(0, 255),
        content_summary: content_summary.substring(0, 2000),
        similarity_score: similarity_score || 0,
        query_text: query_text?.substring(0, 500) || null,
        channel: channel || 'system',
        hit_count: 1,
        status: auto_resolved ? 'auto_resolved' : 'open',
        auto_resolved: !!auto_resolved,
      },
    })

    return NextResponse.json(
      { id: conflict.id, hit_count: conflict.hit_count, status: conflict.status },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('[Internal API] Failed to record knowledge conflict:', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET — List knowledge conflicts (for admin dashboard consumption)
 * Query params: village_id, status (open|resolved|auto_resolved|ignored|all), limit, offset
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

    const [conflicts, total] = await Promise.all([
      prisma.knowledge_conflicts.findMany({
        where,
        orderBy: [{ hit_count: 'desc' }, { last_seen_at: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.knowledge_conflicts.count({ where }),
    ])

    return NextResponse.json({ data: conflicts, total, limit, offset })
  } catch (error: any) {
    console.error('[Internal API] Failed to list knowledge conflicts:', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH — Update conflict status (resolve/ignore)
 * Body: { id, status, resolution_note?, resolved_by? }
 */
export async function PATCH(request: NextRequest) {
  try {
    if (!verifyInternalApiKey(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id, status, resolution_note, resolved_by } = body

    if (!id || !status) {
      return NextResponse.json({ error: 'id and status are required' }, { status: 400 })
    }

    const validStatuses = ['open', 'resolved', 'auto_resolved', 'ignored']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    const conflict = await prisma.knowledge_conflicts.update({
      where: { id },
      data: {
        status,
        resolution_note: resolution_note || null,
        resolved_by: resolved_by || null,
        resolved_at: status === 'resolved' || status === 'ignored' ? new Date() : null,
      },
    })

    return NextResponse.json(conflict)
  } catch (error: any) {
    console.error('[Internal API] Failed to update knowledge conflict:', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
