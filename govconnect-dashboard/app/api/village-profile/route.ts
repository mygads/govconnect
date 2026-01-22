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

  const profile = await prisma.village_profiles.findFirst({
    where: { village_id: session.admin.village_id }
  })

  return NextResponse.json({ data: profile })
}

export async function PUT(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!session.admin.village_id) {
    return NextResponse.json({ error: 'Village not found' }, { status: 404 })
  }

  const body = await request.json()
  const { name, address, gmaps_url, short_name, operating_hours } = body

  const existing = await prisma.village_profiles.findFirst({
    where: { village_id: session.admin.village_id }
  })

  const profile = existing
    ? await prisma.village_profiles.update({
        where: { id: existing.id },
        data: {
          name: name ?? undefined,
          address: address ?? undefined,
          gmaps_url: gmaps_url ?? undefined,
          short_name: short_name ?? undefined,
          operating_hours: operating_hours ?? undefined,
        }
      })
    : await prisma.village_profiles.create({
        data: {
          village_id: session.admin.village_id,
          name: name || '',
          address: address || '',
          gmaps_url: gmaps_url || null,
          short_name: short_name || '',
          operating_hours: operating_hours || {},
        }
      })

  return NextResponse.json({ data: profile })
}
