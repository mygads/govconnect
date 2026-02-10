import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'

// Admin-facing API: View & manage knowledge gaps
// Shows what questions citizens frequently ask that the AI cannot answer

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
 * GET — List knowledge gaps for the admin's village
 * Query: status, limit, offset, sort (hit_count|last_seen_at)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const villageId = session.admin.village_id || ''
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') || 'open'
    const sortField = searchParams.get('sort') === 'last_seen_at' ? 'last_seen_at' : 'hit_count'
    const rawLimit = parseInt(searchParams.get('limit') || '50')
    const rawOffset = parseInt(searchParams.get('offset') || '0')
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200)
    const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0)

    const where: any = { village_id: villageId }
    if (status !== 'all') where.status = status

    const [gaps, total, statusCounts] = await Promise.all([
      prisma.knowledge_gaps.findMany({
        where,
        orderBy: { [sortField]: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.knowledge_gaps.count({ where }),
      prisma.knowledge_gaps.groupBy({
        by: ['status'],
        where: { village_id: villageId },
        _count: true,
      }),
    ])

    // Transform status counts into a map
    const counts: Record<string, number> = { open: 0, resolved: 0, ignored: 0 }
    for (const sc of statusCounts) {
      counts[sc.status] = sc._count
    }

    return NextResponse.json({
      data: gaps,
      total,
      limit,
      offset,
      status_counts: counts,
    })
  } catch (error: any) {
    console.error('[Knowledge Gaps API] GET error:', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH — Update a knowledge gap's status
 * Body: { id, status: 'resolved'|'ignored', resolution_kb_id? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id, status, resolution_kb_id } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    if (!['resolved', 'ignored', 'open'].includes(status)) {
      return NextResponse.json({ error: 'status must be open, resolved, or ignored' }, { status: 400 })
    }

    // Ensure the gap belongs to the admin's village
    const existing = await prisma.knowledge_gaps.findUnique({ where: { id } })
    if (!existing || existing.village_id !== (session.admin.village_id || '')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const updateData: any = {
      status,
      resolved_by: status === 'open' ? null : session.admin.id,
      resolved_at: status === 'open' ? null : new Date(),
    }
    if (resolution_kb_id) {
      updateData.resolution_kb_id = resolution_kb_id
    }

    const updated = await prisma.knowledge_gaps.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ data: updated })
  } catch (error: any) {
    console.error('[Knowledge Gaps API] PATCH error:', error.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
