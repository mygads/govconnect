import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { hashPassword, requireRole } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  const { id } = await context.params
  const body = await request.json().catch(() => ({}))
  const new_password = typeof body.new_password === 'string' ? body.new_password : ''

  if (!new_password || new_password.length < 8) {
    return NextResponse.json({ error: 'new_password minimal 8 karakter' }, { status: 400 })
  }

  const existingAdmin = await prisma.admin_users.findUnique({ where: { id }, select: { id: true, role: true } })
  if (!existingAdmin) return NextResponse.json({ error: 'Admin tidak ditemukan' }, { status: 404 })
  if (existingAdmin.role === 'superadmin') {
    return NextResponse.json({ error: 'Password superadmin tidak bisa direset dari endpoint ini' }, { status: 400 })
  }

  const password_hash = await hashPassword(new_password)

  await prisma.$transaction(async (tx) => {
    await tx.admin_users.update({
      where: { id },
      data: { password_hash },
    })
    await tx.admin_sessions.deleteMany({ where: { admin_id: id } })
  })

  return NextResponse.json({ success: true })
}
