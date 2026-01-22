import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { hashPassword, generateToken } from '@/lib/auth'

const DEFAULT_KB_CATEGORIES = [
  'Profil Desa',
  'FAQ',
  'Struktur Desa',
  'Data RT/RW',
  'Layanan Administrasi',
  'Panduan/SOP',
]

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, password, name, village_name, village_slug, short_name } = body

    if (!username || !password || !name || !village_name || !village_slug) {
      return NextResponse.json(
        { error: 'Username, password, name, village_name, village_slug wajib diisi' },
        { status: 400 }
      )
    }

    const existing = await prisma.admin_users.findUnique({ where: { username } })
    if (existing) {
      return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 409 })
    }

    const village = await prisma.villages.create({
      data: {
        name: village_name,
        slug: village_slug,
        is_active: true,
      }
    })

    await prisma.village_profiles.create({
      data: {
        village_id: village.id,
        name: village_name,
        address: '',
        gmaps_url: null,
        short_name: short_name || village_slug,
        operating_hours: {},
      }
    })

    await prisma.knowledge_categories.createMany({
      data: DEFAULT_KB_CATEGORIES.map((c) => ({
        village_id: village.id,
        name: c,
        is_default: true,
      })),
      skipDuplicates: true,
    })

    const password_hash = await hashPassword(password)
    const admin = await prisma.admin_users.create({
      data: {
        username,
        password_hash,
        name,
        role: 'village_admin',
        village_id: village.id,
      }
    })

    const token = await generateToken({
      adminId: admin.id,
      username: admin.username,
      name: admin.name,
      role: admin.role,
    })

    return NextResponse.json({
      success: true,
      token,
      user: {
        id: admin.id,
        username: admin.username,
        name: admin.name,
        role: admin.role,
      },
      village: {
        id: village.id,
        name: village.name,
        slug: village.slug,
      }
    })
  } catch (error) {
    console.error('Register error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
