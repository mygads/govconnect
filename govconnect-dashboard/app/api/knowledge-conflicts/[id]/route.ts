import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import prisma from '@/lib/prisma'

/**
 * PATCH /api/knowledge-conflicts/:id
 * Update a knowledge conflict entry status without deleting evidence.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.villageId) {
      return NextResponse.json({ error: 'Village-scoped admin session required' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const { status, resolution_note } = body || {}

    if (!['open', 'resolved', 'ignored', 'auto_resolved'].includes(status)) {
      return NextResponse.json({ error: 'status must be open, resolved, auto_resolved, or ignored' }, { status: 400 })
    }

    const conflict = await prisma.knowledge_conflicts.findUnique({ where: { id } })
    if (!conflict) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (conflict.village_id !== session.villageId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updated = await prisma.knowledge_conflicts.update({
      where: { id },
      data: {
        status,
        resolution_note: resolution_note || null,
        resolved_by: status === 'open' ? null : session.adminId,
        resolved_at: status === 'resolved' || status === 'ignored' ? new Date() : null,
      },
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('Error updating knowledge conflict:', error)
    return NextResponse.json({ error: 'Failed to update knowledge conflict' }, { status: 500 })
  }
}

/**
 * DELETE /api/knowledge-conflicts/:id
 * Hard delete a knowledge conflict entry.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.villageId) {
      return NextResponse.json({ error: 'Village-scoped admin session required' }, { status: 403 })
    }

    const { id } = await params
    const conflict = await prisma.knowledge_conflicts.findUnique({ where: { id } })
    if (!conflict) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (conflict.village_id !== session.villageId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma.knowledge_conflicts.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting knowledge conflict:', error)
    return NextResponse.json({ error: 'Failed to delete knowledge conflict' }, { status: 500 })
  }
}
