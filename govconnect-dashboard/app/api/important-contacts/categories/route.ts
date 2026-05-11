import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { invalidateVillageAiCacheSafely } from '@/lib/ai-cache-invalidation'
import { buildScopedNameKey, normalizeScopedName } from '@/lib/utils'

function isDuplicateCategoryError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

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
  const normalizedName = normalizeScopedName(body?.name)
  if (!normalizedName) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const nameKey = buildScopedNameKey(normalizedName)
  const existing = await prisma.important_contact_categories.findFirst({
    where: {
      village_id: session.admin.village_id,
      name_key: nameKey,
    },
    select: { id: true },
  })

  if (existing) {
    return NextResponse.json({ error: 'Nama kategori kontak penting sudah dipakai di desa ini.' }, { status: 409 })
  }

  try {
    const category = await prisma.important_contact_categories.create({
      data: {
        village_id: session.admin.village_id,
        name: normalizedName,
        name_key: nameKey,
      }
    })

    await invalidateVillageAiCacheSafely(session.admin.village_id)
    return NextResponse.json({ data: category })
  } catch (error) {
    if (isDuplicateCategoryError(error)) {
      return NextResponse.json({ error: 'Nama kategori kontak penting sudah dipakai di desa ini.' }, { status: 409 })
    }
    throw error
  }
}
