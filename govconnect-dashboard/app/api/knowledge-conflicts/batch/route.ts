import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import prisma from '@/lib/prisma'

/**
 * DELETE /api/knowledge-conflicts/batch
 * Delete all knowledge conflict entries for the admin's village.
 * Resets the "Data Berkonflik" table.
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

    const result = await prisma.knowledge_conflicts.deleteMany({ where })

    return NextResponse.json({
      success: true,
      deleted: result.count,
    })
  } catch (error) {
    console.error('Error deleting all knowledge conflicts:', error)
    return NextResponse.json(
      { error: 'Failed to delete knowledge conflicts' },
      { status: 500 }
    )
  }
}
