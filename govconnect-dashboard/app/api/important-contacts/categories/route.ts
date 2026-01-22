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
  if (!session.admin.village_id) return NextResponse.json({ data: [] })

  const categories = await prisma.important_contact_categories.findMany({
    where: { village_id: session.admin.village_id },
    orderBy: { created_at: 'asc' }
  })

  return NextResponse.json({ data: categories })
}

export async function POST(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.admin.village_id) return NextResponse.json({ error: 'Village not found' }, { status: 404 })

  const body = await request.json()
  const { name } = body
  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const category = await prisma.important_contact_categories.create({
    data: {
      village_id: session.admin.village_id,
      name,
    }
  })

  return NextResponse.json({ data: category })
}
