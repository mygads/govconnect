import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import prisma from '@/lib/prisma'

/**
 * DELETE /api/knowledge-gaps/:id
 * Delete a knowledge gap entry (hard delete — it's just analytics data)
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

    const { id } = await params

    // Verify the gap belongs to the admin's village
    const gap = await prisma.knowledge_gaps.findUnique({ where: { id } })
    if (!gap) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (session.villageId && gap.village_id !== session.villageId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma.knowledge_gaps.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting knowledge gap:', error)
    return NextResponse.json({ error: 'Failed to delete knowledge gap' }, { status: 500 })
  }
}
