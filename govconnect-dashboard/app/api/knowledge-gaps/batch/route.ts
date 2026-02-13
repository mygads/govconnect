import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import prisma from '@/lib/prisma'

/**
 * DELETE /api/knowledge-gaps/batch
 * Delete all knowledge gap entries for the admin's village.
 * Resets the "Pertanyaan Belum Terjawab" table.
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const where: any = {}
    if (session.villageId) {
      where.village_id = session.villageId
    }

    const result = await prisma.knowledge_gaps.deleteMany({ where })

    return NextResponse.json({
      success: true,
      deleted: result.count,
    })
  } catch (error) {
    console.error('Error deleting all knowledge gaps:', error)
    return NextResponse.json(
      { error: 'Failed to delete knowledge gaps' },
      { status: 500 }
    )
  }
}
