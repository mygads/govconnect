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

    const admins = await prisma.admin_users.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        village: {
          select: { id: true, name: true, slug: true },
        },
      },
    })

    const data = admins.map((admin: any) => ({
      id: admin.id,
      name: admin.name,
      username: admin.username,
      role: admin.role,
      is_active: admin.is_active,
      created_at: admin.created_at,
      village: admin.village,
    }))

    return NextResponse.json({ data })
  } catch (error) {
    console.error('Superadmin admins error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
