import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { invalidateVillageAiCacheSafely } from '@/lib/ai-cache-invalidation'
import { findVillageImportantContactCategoryById } from '@/lib/important-contact-categories'

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

const contactSelect = {
  id: true,
  category_id: true,
  name: true,
  phone: true,
  description: true,
  created_at: true,
  updated_at: true,
  category: {
    select: {
      id: true,
      village_id: true,
      name: true,
      created_at: true,
      updated_at: true,
    },
  },
} as const

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.admin.village_id) return NextResponse.json({ data: [] })

  const contacts = await prisma.important_contacts.findMany({
    where: {
      category: { village_id: session.admin.village_id }
    },
    select: contactSelect,
    orderBy: { created_at: 'asc' }
  })

  return NextResponse.json({ data: contacts })
}

export async function POST(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.admin.village_id) return NextResponse.json({ error: 'Village not found' }, { status: 404 })

  const body = await request.json()
  const { category_id, name, phone, description } = body
  if (!category_id || !name || !phone) {
    return NextResponse.json({ error: 'category_id, name, phone are required' }, { status: 400 })
  }

  const category = await findVillageImportantContactCategoryById(session.admin.village_id, category_id)
  if (!category) {
    return NextResponse.json({ error: 'Kategori tidak ditemukan atau bukan milik desa Anda' }, { status: 403 })
  }

  const contact = await prisma.important_contacts.create({
    data: {
      category_id,
      name,
      phone,
      description: description || null,
    }
  })

  await invalidateVillageAiCacheSafely(session.admin.village_id)
  return NextResponse.json({ data: contact })
}
