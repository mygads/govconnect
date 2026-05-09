import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole } from '@/lib/auth'
import { isSupportedVillageTimezone, resolveVillageTimezone } from '@/lib/utils'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const nextData: { is_active?: boolean; timezone?: string } = {}

  if (typeof body.is_active === 'boolean') {
    nextData.is_active = body.is_active
  }

  if (typeof body.timezone === 'string' && body.timezone.trim()) {
    if (!isSupportedVillageTimezone(body.timezone.trim())) {
      return NextResponse.json({ error: 'Timezone desa tidak valid' }, { status: 400 })
    }
    nextData.timezone = resolveVillageTimezone(body.timezone.trim())
  }

  if (Object.keys(nextData).length === 0) {
    return NextResponse.json({ error: 'Tidak ada perubahan yang dikirim' }, { status: 400 })
  }

  try {
    const village = await prisma.villages.update({
      where: { id },
      data: nextData,
    })

    if (nextData.is_active === false) {
      const admins = await prisma.admin_users.findMany({
        where: { village_id: id },
        select: { id: true },
      })
      const adminIds = admins.map((admin) => admin.id)
      if (adminIds.length > 0) {
        await prisma.admin_sessions.deleteMany({ where: { admin_id: { in: adminIds } } })
      }
    }

    return NextResponse.json({ data: { ...village, timezone: resolveVillageTimezone(village.timezone) } })
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Village not found' }, { status: 404 })
    }
    console.error('Update village status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
