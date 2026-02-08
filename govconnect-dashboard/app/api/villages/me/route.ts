import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const payload = await getAuthUser(request)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await prisma.admin_users.findUnique({
    where: { id: payload.adminId }
  })

  // Ensure admin exists and has a village_id
  if (!admin || !admin.village_id) {
    return NextResponse.json({ data: null })
  }

  const village = await prisma.villages.findUnique({
    where: { id: admin.village_id }
  })

  return NextResponse.json({ data: village })
}

export async function PUT(request: NextRequest) {
  const payload = await getAuthUser(request)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await prisma.admin_users.findUnique({
    where: { id: payload.adminId }
  })

  if (!admin || !admin.village_id) {
    return NextResponse.json({ error: 'Village not found' }, { status: 404 })
  }

  const body = await request.json()
  const { name, slug, is_active } = body

  const village = await prisma.villages.update({
    where: { id: admin.village_id },
    data: {
      name: name ?? undefined,
      slug: slug ?? undefined,
      is_active: is_active ?? undefined,
    }
  })

  return NextResponse.json({ data: village })
}
