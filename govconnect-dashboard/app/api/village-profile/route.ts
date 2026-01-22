import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { addKnowledgeVector, updateKnowledgeVector } from '@/lib/ai-service'

const PROFILE_CATEGORY_NAME = 'Profil Desa'

function buildOperatingHoursText(operatingHours: Record<string, { open?: string; close?: string }> | null | undefined) {
  if (!operatingHours || Object.keys(operatingHours).length === 0) return 'Belum diatur'

  const dayLabels: Record<string, string> = {
    senin: 'Senin',
    selasa: 'Selasa',
    rabu: 'Rabu',
    kamis: 'Kamis',
    jumat: 'Jumat',
    sabtu: 'Sabtu',
    minggu: 'Minggu',
  }

  return Object.keys(dayLabels)
    .map((key) => {
      const hours = operatingHours[key]
      const label = dayLabels[key]
      if (!hours?.open && !hours?.close) return `${label}: Tutup`
      return `${label}: ${hours?.open || '--:--'} - ${hours?.close || '--:--'}`
    })
    .join('\n')
}

function buildProfileKnowledgeContent(profile: { name?: string; address?: string; gmaps_url?: string | null; short_name?: string; operating_hours?: Record<string, { open?: string; close?: string }> | null }) {
  const hoursText = buildOperatingHoursText(profile.operating_hours)

  return [
    `Nama Desa/Kelurahan: ${profile.name || '-'}`,
    `Nama Singkat (Slug Form): ${profile.short_name || '-'}`,
    `Alamat: ${profile.address || '-'}`,
    `Google Maps: ${profile.gmaps_url || '-'}`,
    'Jam Operasional:',
    hoursText,
  ].join('\n')
}

function buildProfileKeywords(profile: { name?: string; short_name?: string; address?: string }) {
  const rawKeywords = [
    'profil desa',
    'profil kelurahan',
    'alamat desa',
    'jam operasional',
    'jam buka',
    profile.name || '',
    profile.short_name || '',
    profile.address || '',
  ]

  return Array.from(new Set(rawKeywords.map((k) => k.toLowerCase().trim()).filter(Boolean)))
}

async function upsertProfileKnowledge(villageId: string, adminId: string | null, profile: {
  name?: string
  address?: string
  gmaps_url?: string | null
  short_name?: string
  operating_hours?: Record<string, { open?: string; close?: string }> | null
}) {
  let category = await prisma.knowledge_categories.findFirst({
    where: { village_id: villageId, name: PROFILE_CATEGORY_NAME },
  })

  if (!category) {
    category = await prisma.knowledge_categories.create({
      data: {
        village_id: villageId,
        name: PROFILE_CATEGORY_NAME,
        is_default: true,
      },
    })
  }

  if (!category) return

  const content = buildProfileKnowledgeContent(profile)
  const keywords = buildProfileKeywords(profile)

  const existing = await prisma.knowledge_base.findFirst({
    where: {
      village_id: villageId,
      category_id: category.id,
      title: PROFILE_CATEGORY_NAME,
    },
  })

  if (existing) {
    const updated = await prisma.knowledge_base.update({
      where: { id: existing.id },
      data: {
        content,
        category: category.name,
        keywords,
        is_active: true,
        priority: 10,
        admin_id: adminId || undefined,
      },
    })

    updateKnowledgeVector(updated.id, {
      title: updated.title,
      content: updated.content,
      category: updated.category,
      keywords: updated.keywords,
    }).catch((error) => {
      console.error('Failed to sync profile knowledge update to AI Service:', error)
    })
  } else {
    const created = await prisma.knowledge_base.create({
      data: {
        title: PROFILE_CATEGORY_NAME,
        content,
        category: category.name,
        category_id: category.id,
        village_id: villageId,
        keywords,
        is_active: true,
        priority: 10,
        admin_id: adminId || undefined,
      },
    })

    addKnowledgeVector({
      id: created.id,
      title: created.title,
      content: created.content,
      category: created.category,
      keywords: created.keywords,
    }).catch((error) => {
      console.error('Failed to sync profile knowledge create to AI Service:', error)
    })
  }
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

  if (!session.admin.village_id) {
    return NextResponse.json({ data: null })
  }

  const profile = await prisma.village_profiles.findFirst({
    where: { village_id: session.admin.village_id }
  })

  return NextResponse.json({ data: profile })
}

export async function PUT(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!session.admin.village_id) {
    return NextResponse.json({ error: 'Village not found' }, { status: 404 })
  }

  const body = await request.json()
  const { name, address, gmaps_url, short_name, operating_hours } = body

  const existing = await prisma.village_profiles.findFirst({
    where: { village_id: session.admin.village_id }
  })

  const profile = existing
    ? await prisma.village_profiles.update({
        where: { id: existing.id },
        data: {
          name: name ?? undefined,
          address: address ?? undefined,
          gmaps_url: gmaps_url ?? undefined,
          short_name: short_name ?? undefined,
          operating_hours: operating_hours ?? undefined,
        }
      })
    : await prisma.village_profiles.create({
        data: {
          village_id: session.admin.village_id,
          name: name || '',
          address: address || '',
          gmaps_url: gmaps_url || null,
          short_name: short_name || '',
          operating_hours: operating_hours || {},
        }
      })

  await upsertProfileKnowledge(session.admin.village_id, session.admin_id, {
    name: profile.name,
    address: profile.address,
    gmaps_url: profile.gmaps_url,
    short_name: profile.short_name,
    operating_hours: profile.operating_hours as Record<string, { open?: string; close?: string }> | null,
  })

  return NextResponse.json({ data: profile })
}
