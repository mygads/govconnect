import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const [session, authError] = await requireAuth(request)
  if (authError) return authError

  if (!session.villageId) {
    return NextResponse.json({ data: null })
  }

  const village = await prisma.villages.findUnique({
    where: { id: session.villageId },
  })

  return NextResponse.json({ data: village })
}

export async function PUT(request: NextRequest) {
  const [session, authError] = await requireAuth(request)
  if (authError) return authError

  if (!session.villageId) {
    return NextResponse.json({ error: 'Village not found' }, { status: 404 })
  }

  const body = await request.json()
  const { name, slug, is_active } = body

  const village = await prisma.villages.update({
    where: { id: session.villageId },
    data: {
      name: name ?? undefined,
      slug: slug ?? undefined,
      is_active: is_active ?? undefined,
    },
  })

  return NextResponse.json({ data: village })
}
