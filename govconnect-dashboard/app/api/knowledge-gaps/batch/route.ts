import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import prisma from '@/lib/prisma'

/**
 * PATCH /api/knowledge-gaps/batch
 * Bulk update knowledge gap statuses for the admin's village.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.villageId) {
      return NextResponse.json({ error: 'Village-scoped admin session required' }, { status: 403 })
    }

    const body = await request.json()
    const { status, ids } = body || {}

    if (!['open', 'resolved', 'ignored'].includes(status)) {
      return NextResponse.json({ error: 'status must be open, resolved, or ignored' }, { status: 400 })
    }

    const where: any = {
      village_id: session.villageId,
    }

    const safeIds = Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []

    if (safeIds.length > 0) {
      where.id = { in: safeIds }
    } else {
      where.status = 'open'
    }

    const result = await prisma.knowledge_gaps.updateMany({
      where,
      data: {
        status,
        resolved_by: status === 'open' ? null : session.adminId,
        resolved_at: status === 'open' ? null : new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      updated: result.count,
      status,
    })
  } catch (error) {
    console.error('Error updating all knowledge gaps:', error)
    return NextResponse.json(
      { error: 'Failed to update knowledge gaps' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/knowledge-gaps/batch
 * Delete archived knowledge gap entries for the admin's village by default.
 * Use ?scope=all only for an explicit full reset.
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.villageId) {
      return NextResponse.json({ error: 'Village-scoped admin session required' }, { status: 403 })
    }

    const scope = request.nextUrl.searchParams.get('scope') || 'closed'
    const where: any = {
      village_id: session.villageId,
    }
    if (scope !== 'all') {
      where.status = { in: ['resolved', 'ignored'] }
    }

    const result = await prisma.knowledge_gaps.deleteMany({ where })

    return NextResponse.json({
      success: true,
      deleted: result.count,
      scope,
    })
  } catch (error) {
    console.error('Error deleting knowledge gaps:', error)
    return NextResponse.json(
      { error: 'Failed to delete knowledge gaps' },
      { status: 500 }
    )
  }
}
