import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { hashPassword, requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  const villageId = new URL(request.url).searchParams.get('village_id')?.trim() || null

  if (!villageId) {
    return NextResponse.json({ error: 'village_id is required' }, { status: 400 })
  }

  const village = await prisma.villages.findUnique({ where: { id: villageId }, select: { id: true } })
  if (!village) {
    return NextResponse.json({ error: 'Village not found' }, { status: 404 })
  }

  const admins = await prisma.admin_users.findMany({
    where: { village_id: villageId },
    orderBy: [{ created_at: 'desc' }],
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      is_active: true,
      village_id: true,
      created_at: true,
      village: {
        select: { id: true, name: true, slug: true },
      },
    },
  })

  return NextResponse.json({ data: admins })
}

export async function POST(request: NextRequest) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  const body = await request.json().catch(() => ({}))
  const village_id = typeof body.village_id === 'string' ? body.village_id.trim() : ''
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const role = typeof body.role === 'string' ? body.role.trim() : 'village_admin'

  if (!village_id || !username || !password || !name) {
    return NextResponse.json({ error: 'village_id, username, password, dan name wajib diisi' }, { status: 400 })
  }

  if (/\s/.test(username)) {
    return NextResponse.json({ error: 'Username tidak boleh mengandung spasi' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password minimal 8 karakter' }, { status: 400 })
  }

  if (role !== 'village_admin' && role !== 'admin') {
    return NextResponse.json({ error: 'Role tidak valid' }, { status: 400 })
  }

  const village = await prisma.villages.findUnique({ where: { id: village_id }, select: { id: true } })
  if (!village) {
    return NextResponse.json({ error: 'Village not found' }, { status: 404 })
  }

  const existing = await prisma.admin_users.findUnique({ where: { username } })
  if (existing) {
    return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 409 })
  }

  const password_hash = await hashPassword(password)
  const admin = await prisma.admin_users.create({
    data: {
      village_id,
      username,
      password_hash,
      name,
      role,
      is_active: true,
    },
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      is_active: true,
      village_id: true,
      created_at: true,
      village: {
        select: { id: true, name: true, slug: true },
      },
    },
  })

  return NextResponse.json({ data: admin }, { status: 201 })
}
