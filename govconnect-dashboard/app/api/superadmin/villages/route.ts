import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

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
  return { session, payload }
}

export async function GET(request: NextRequest) {
  try {
    const result = await getSession(request)
    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (result.payload.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden - Superadmin only' }, { status: 403 })
    }

    const villages = await prisma.villages.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        admins: {
          select: { id: true, name: true, username: true, role: true, is_active: true },
        },
        profiles: {
          select: { short_name: true, address: true },
        },
      }
    })

    const data = villages.map((v: any) => ({
      id: v.id,
      name: v.name,
      slug: v.slug,
      is_active: v.is_active,
      created_at: v.created_at,
      admins: v.admins,
      admin_count: v.admins.length,
      profile: v.profiles?.[0] || null,
    }))

    return NextResponse.json({ data })
  } catch (error) {
    console.error('Superadmin villages error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
