import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import prisma from '@/lib/prisma'

/**
 * PATCH /api/knowledge-gaps/:id
 * Update a knowledge gap entry status without deleting evidence.
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
    const { status, resolution_kb_id } = body || {}

    if (!['open', 'resolved', 'ignored'].includes(status)) {
      return NextResponse.json({ error: 'status must be open, resolved, or ignored' }, { status: 400 })
    }

    const gap = await prisma.knowledge_gaps.findUnique({ where: { id } })
    if (!gap) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (gap.village_id !== session.villageId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updated = await prisma.knowledge_gaps.update({
      where: { id },
      data: {
        status,
        resolved_by: status === 'open' ? null : session.adminId,
        resolved_at: status === 'open' ? null : new Date(),
        resolution_kb_id: resolution_kb_id || null,
      },
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('Error updating knowledge gap:', error)
    return NextResponse.json({ error: 'Failed to update knowledge gap' }, { status: 500 })
  }
}

/**
 * DELETE /api/knowledge-gaps/:id
 * Hard delete a knowledge gap entry.
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

    // Verify the gap belongs to the admin's village
    const gap = await prisma.knowledge_gaps.findUnique({ where: { id } })
    if (!gap) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (gap.village_id !== session.villageId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma.knowledge_gaps.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting knowledge gap:', error)
    return NextResponse.json({ error: 'Failed to delete knowledge gap' }, { status: 500 })
  }
}
