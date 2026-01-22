import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true }
  })
  if (!session || session.expires_at < new Date()) return null
  return session
}

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!session.admin.village_id) {
    return NextResponse.json({ data: null })
  }

  const village = await prisma.villages.findUnique({
    where: { id: session.admin.village_id }
  })

  return NextResponse.json({ data: village })
}

export async function PUT(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!session.admin.village_id) {
    return NextResponse.json({ error: 'Village not found' }, { status: 404 })
  }

  const body = await request.json()
  const { name, slug, is_active } = body

  const village = await prisma.villages.update({
    where: { id: session.admin.village_id },
    data: {
      name: name ?? undefined,
      slug: slug ?? undefined,
      is_active: is_active ?? undefined,
    }
  })

  return NextResponse.json({ data: village })
}
