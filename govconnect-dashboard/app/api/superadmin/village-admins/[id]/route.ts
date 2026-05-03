import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole } from '@/lib/auth'

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  const { id } = await context.params
  const body = await request.json().catch(() => ({}))

  const data: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name tidak boleh kosong' }, { status: 400 })
    data.name = name
  }

  if (body.username !== undefined) {
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    if (!username) return NextResponse.json({ error: 'username tidak boleh kosong' }, { status: 400 })
    if (/\s/.test(username)) return NextResponse.json({ error: 'Username tidak boleh mengandung spasi' }, { status: 400 })

    const existing = await prisma.admin_users.findUnique({ where: { username }, select: { id: true } })
    if (existing && existing.id !== id) {
      return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 409 })
    }

    data.username = username
  }

  if (body.role !== undefined) {
    const role = typeof body.role === 'string' ? body.role.trim() : ''
    if (role !== 'village_admin' && role !== 'admin') {
      return NextResponse.json({ error: 'Role tidak valid' }, { status: 400 })
    }
    data.role = role
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') {
      return NextResponse.json({ error: 'is_active harus boolean' }, { status: 400 })
    }
    data.is_active = body.is_active
  }

  const existingAdmin = await prisma.admin_users.findUnique({ where: { id }, select: { id: true, role: true } })
  if (!existingAdmin) return NextResponse.json({ error: 'Admin tidak ditemukan' }, { status: 404 })
  if (existingAdmin.role === 'superadmin') {
    return NextResponse.json({ error: 'Akun superadmin tidak boleh diubah dari endpoint ini' }, { status: 400 })
  }

  const updated = await prisma.$transaction(async (tx) => {
    const admin = await tx.admin_users.update({
      where: { id },
      data,
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

    if (body.is_active === false) {
      await tx.admin_sessions.deleteMany({ where: { admin_id: id } })
    }

    return admin
  })

  return NextResponse.json({ data: updated })
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  const { id } = await context.params

  const existingAdmin = await prisma.admin_users.findUnique({ where: { id }, select: { id: true, role: true } })
  if (!existingAdmin) return NextResponse.json({ error: 'Admin tidak ditemukan' }, { status: 404 })
  if (existingAdmin.role === 'superadmin') {
    return NextResponse.json({ error: 'Akun superadmin tidak boleh dihapus dari endpoint ini' }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.admin_sessions.deleteMany({ where: { admin_id: id } })
    await tx.admin_users.delete({ where: { id } })
  })

  return NextResponse.json({ success: true })
}
