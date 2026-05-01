import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole } from '@/lib/auth'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  const { id } = await params
  const body = await request.json().catch(() => ({}))

  if (typeof body.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active must be boolean' }, { status: 400 })
  }

  try {
    const village = await prisma.villages.update({
      where: { id },
      data: { is_active: body.is_active },
    })

    if (!body.is_active) {
      const admins = await prisma.admin_users.findMany({
        where: { village_id: id },
        select: { id: true },
      })
      const adminIds = admins.map((admin) => admin.id)
      if (adminIds.length > 0) {
        await prisma.admin_sessions.deleteMany({ where: { admin_id: { in: adminIds } } })
      }
    }

    return NextResponse.json({ data: village })
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Village not found' }, { status: 404 })
    }
    console.error('Update village status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
