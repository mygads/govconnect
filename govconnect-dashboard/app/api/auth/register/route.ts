import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { hashPassword, generateToken, getAuthUser } from '@/lib/auth'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

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
    // Security check: Only superadmin can create new villages/admins
    const user = await getAuthUser(request)
    if (!user || user.role !== 'superadmin') {
      return NextResponse.json(
        { error: 'Forbidden: Only superadmin can register new villages' },
        { status: 403 }
      )
    }

    const body = await request.json()
    // Trim whitespace from all string inputs
    const username = (body.username || '').trim()
    const password = body.password // Don't trim password
    const name = (body.name || '').trim()
    const village_name = (body.village_name || '').trim()
    const village_slug = (body.village_slug || '').trim().toLowerCase().replace(/\s+/g, '-')
    const short_name = (body.short_name || '').trim()

    if (!username || !password || !name || !village_name || !village_slug) {
      return NextResponse.json(
        { error: 'Username, password, name, village_name, village_slug wajib diisi' },
        { status: 400 }
      )
    }

    // Validate no spaces in username
    if (/\s/.test(username)) {
      return NextResponse.json(
        { error: 'Username tidak boleh mengandung spasi' },
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

    // Create channel_account with webchat and WA disabled by default
    try {
      await apiFetch(buildUrl(ServicePath.CHANNEL, `/internal/channel-accounts/${village.id}`), {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          wa_number: '',
          enabled_wa: false,
          enabled_webchat: false,
        }),
      })
    } catch (channelError) {
      console.warn('Failed to create channel account (non-fatal):', channelError)
      // Non-fatal - village can still be created without channel account
    }

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
