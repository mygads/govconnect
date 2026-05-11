import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { addKnowledgeVector, updateKnowledgeVector } from '@/lib/ai-service'
import { findVillageKnowledgeCategoryByName, resolveVillageKnowledgeCategory } from '@/lib/knowledge-categories'
import { getVillageTimezoneLabel, resolveVillageTimezone } from '@/lib/utils'

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
      // Check if it's a holiday (marked with '-')
      if (hours?.open === '-' || hours?.close === '-') return `${label}: Libur`
      // Empty/null means no data yet
      if (!hours?.open && !hours?.close) return `${label}: Belum diatur`
      return `${label}: ${hours?.open} - ${hours?.close}`
    })
    .join('\n')
}

function buildProfileKnowledgeContent(profile: { name?: string; slug?: string; address?: string; gmaps_url?: string | null; latitude?: number | null; longitude?: number | null; short_name?: string; timezone?: string | null; operating_hours?: Record<string, { open?: string; close?: string }> | null }) {
  const hoursText = buildOperatingHoursText(profile.operating_hours)

  const lines = [
    `Nama Desa/Kelurahan: ${profile.name || '-'}`,
    `Slug Form/Webchat: ${profile.slug || '-'}`,
    `Nama Singkat/Alias: ${profile.short_name || '-'}`,
    `Zona Waktu Desa: ${getVillageTimezoneLabel(profile.timezone)}`,
  ]
  lines.push(
    `Alamat Kantor: ${profile.address || '-'}`,
    `Google Maps: ${profile.gmaps_url || '-'}`,
    `Koordinat Kantor: ${profile.latitude != null && profile.longitude != null ? `${profile.latitude}, ${profile.longitude}` : '-'}`,
    'Jam Operasional Kantor:',
    '(Catatan: "-" atau "Libur" berarti hari tersebut libur/tutup, "Belum diatur" berarti data belum diisi)',
    hoursText,
  )
  return lines.join('\n')
}

function buildProfileKeywords(profile: { name?: string; slug?: string; short_name?: string; address?: string }) {
  const rawKeywords = [
    'profil desa',
    'profil kelurahan',
    'alamat desa',
    'alamat kantor',
    'jam operasional',
    'jam operasional kantor',
    'jam buka',
    'hari libur',
    'libur',
    profile.name || '',
    profile.slug || '',
    profile.short_name || '',
    profile.address || '',
  ]

  return Array.from(new Set(rawKeywords.map((k) => k.toLowerCase().trim()).filter(Boolean)))
}

async function upsertProfileKnowledge(villageId: string, adminId: string | null, profile: {
  name?: string
  slug?: string
  address?: string
  gmaps_url?: string | null
  short_name?: string
  timezone?: string | null
  latitude?: number | null
  longitude?: number | null
  operating_hours?: Record<string, { open?: string; close?: string }> | null
}) {
  const resolvedCategory = await resolveVillageKnowledgeCategory({
    villageId,
    categoryName: PROFILE_CATEGORY_NAME,
    createIfMissing: true,
    isDefaultOnCreate: true,
  })

  if (!resolvedCategory.categoryId || !resolvedCategory.categoryName) return null

  const category = {
    id: resolvedCategory.categoryId,
    name: resolvedCategory.categoryName,
  }

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
    // Check if content has changed
    const contentChanged = existing.content !== content
    
    const updated = await prisma.knowledge_base.update({
      where: { id: existing.id },
      data: {
        content,
        category: category.name,
        keywords,
        is_active: true,
        priority: 10,
        admin_id: adminId || undefined,
        last_edited_at: contentChanged ? new Date() : existing.last_edited_at,
      },
    })

    // Only update embedding if content changed
    if (contentChanged) {
      updateKnowledgeVector(updated.id, {
        village_id: updated.village_id || undefined,
        title: updated.title,
        content: updated.content,
        category: updated.category,
        keywords: updated.keywords,
        scope: updated.scope,
        is_global: updated.is_global,
      }).then(async () => {
        // Update last_embedded_at on success
        await prisma.knowledge_base.update({
          where: { id: updated.id },
          data: { last_embedded_at: new Date() },
        })
      }).catch((error) => {
        console.error('Failed to sync profile knowledge update to AI Service:', error)
      })
    }

    return { 
      id: updated.id, 
      contentChanged,
      needsReembed: contentChanged && (!updated.last_embedded_at || updated.last_edited_at! > updated.last_embedded_at)
    }
  } else {
    const created = await prisma.knowledge_base.create({
      data: {
        title: PROFILE_CATEGORY_NAME,
        content,
        category: category.name,
        category_id: category.id,
        village_id: villageId,
        scope: 'village',
        is_global: false,
        keywords,
        is_active: true,
        priority: 10,
        admin_id: adminId || undefined,
        last_edited_at: new Date(),
      },
    })

    addKnowledgeVector({
      id: created.id,
      village_id: created.village_id || undefined,
      title: created.title,
      content: created.content,
      category: created.category,
      keywords: created.keywords,
      scope: created.scope,
      is_global: created.is_global,
    }).then(async () => {
      // Update last_embedded_at on success
      await prisma.knowledge_base.update({
        where: { id: created.id },
        data: { last_embedded_at: new Date() },
      })
    }).catch((error) => {
      console.error('Failed to sync profile knowledge create to AI Service:', error)
    })

    return { id: created.id, contentChanged: true, needsReembed: true }
  }
}

async function getVillageIdentity(villageId: string) {
  return prisma.villages.findUnique({
    where: { id: villageId },
    select: { id: true, name: true, slug: true, timezone: true },
  })
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

  // Parallel fetch all data
  const [village, profile, profileCategory] = await Promise.all([
    getVillageIdentity(session.admin.village_id),
    prisma.village_profiles.findFirst({
      where: { village_id: session.admin.village_id }
    }),
    findVillageKnowledgeCategoryByName(session.admin.village_id, PROFILE_CATEGORY_NAME),
  ])

  // Get knowledge if category exists
  let profileKnowledgeItem = null
  if (profileCategory) {
    profileKnowledgeItem = await prisma.knowledge_base.findFirst({
      where: {
        village_id: session.admin.village_id,
        category_id: profileCategory.id,
        title: PROFILE_CATEGORY_NAME,
      },
      select: {
        id: true,
        last_edited_at: true,
        last_embedded_at: true,
        updated_at: true,
      }
    })
  }

  let embeddingStatus = null
  if (profileKnowledgeItem) {
    const needsReembed = profileKnowledgeItem.last_edited_at && (
      !profileKnowledgeItem.last_embedded_at ||
      profileKnowledgeItem.last_edited_at > profileKnowledgeItem.last_embedded_at
    )
    embeddingStatus = {
      knowledge_id: profileKnowledgeItem.id,
      last_edited_at: profileKnowledgeItem.last_edited_at,
      last_embedded_at: profileKnowledgeItem.last_embedded_at,
      needs_reembed: needsReembed,
    }
  }

  return NextResponse.json({ data: profile ? {
    ...profile,
    name: village?.name || profile.name,
    slug: village?.slug || '',
    timezone: resolveVillageTimezone(village?.timezone),
    timezone_label: getVillageTimezoneLabel(village?.timezone),
  } : village ? {
    village_id: village.id,
    name: village.name,
    slug: village.slug,
    timezone: resolveVillageTimezone(village.timezone),
    timezone_label: getVillageTimezoneLabel(village.timezone),
    address: '',
    gmaps_url: null,
    latitude: null,
    longitude: null,
    short_name: '',
    operating_hours: {},
  } : null, embedding_status: embeddingStatus })
}

export async function PUT(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!session.admin.village_id) {
    return NextResponse.json({ error: 'Village not found' }, { status: 404 })
  }

  const body = await request.json()
  const { address, gmaps_url, short_name, operating_hours } = body
  if (body.timezone !== undefined) {
    return NextResponse.json({ error: 'Timezone hanya dapat diubah oleh superadmin' }, { status: 403 })
  }
  const latitude = body.latitude === '' || body.latitude === null || body.latitude === undefined ? null : Number(body.latitude)
  const longitude = body.longitude === '' || body.longitude === null || body.longitude === undefined ? null : Number(body.longitude)

  if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) {
    return NextResponse.json({ error: 'Latitude dan longitude harus berupa angka valid' }, { status: 400 })
  }

  if ((latitude === null) !== (longitude === null)) {
    return NextResponse.json({ error: 'Latitude dan longitude harus diisi bersama' }, { status: 400 })
  }

  const existing = await prisma.village_profiles.findFirst({
    where: { village_id: session.admin.village_id }
  })

  const village = await getVillageIdentity(session.admin.village_id)
  const profile = existing
    ? await (prisma.village_profiles as any).update({
        where: { id: existing.id },
        data: {
          address: address ?? undefined,
          gmaps_url: gmaps_url ?? undefined,
          latitude,
          longitude,
          short_name: short_name ?? undefined,
          operating_hours: operating_hours ?? undefined,
        }
      })
    : await (prisma.village_profiles as any).create({
        data: {
          village_id: session.admin.village_id,
          name: village?.name || '',
          address: address || '',
          gmaps_url: gmaps_url || null,
          latitude,
          longitude,
          short_name: short_name || '',
          operating_hours: operating_hours || {},
        }
      })

  await upsertProfileKnowledge(session.admin.village_id, session.admin_id, {
    name: village?.name || profile.name,
    slug: village?.slug || '',
    timezone: village?.timezone,
    address: profile.address,
    gmaps_url: profile.gmaps_url,
    latitude: (profile as any).latitude,
    longitude: (profile as any).longitude,
    short_name: profile.short_name,
    operating_hours: profile.operating_hours as Record<string, { open?: string; close?: string }> | null,
  })

  return NextResponse.json({ data: {
    ...profile,
    name: village?.name || profile.name,
    slug: village?.slug || '',
    timezone: resolveVillageTimezone(village?.timezone),
    timezone_label: getVillageTimezoneLabel(village?.timezone),
  } })
}
