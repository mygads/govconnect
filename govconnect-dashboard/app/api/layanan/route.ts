import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'
import { invalidateVillageAiCacheSafely } from '@/lib/ai-cache-invalidation'

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
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
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(buildUrl(ServicePath.CASE, '/services'))
    const requestedVillageId = request.nextUrl.searchParams.get('village_id')?.trim() || ''
    const targetVillageId = session.admin.village_id || (session.admin.role === 'superadmin' ? requestedVillageId : '')

    if (targetVillageId) {
      url.searchParams.set('village_id', targetVillageId)
    } else if (session.admin.role === 'superadmin') {
      url.searchParams.set('scope', 'all')
    }

    const response = await apiFetch(url.toString(), {
      headers: getHeaders({
        'x-admin-role': session.admin.role,
        ...(targetVillageId ? { 'x-village-id': targetVillageId } : {}),
      }),
    })

    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return NextResponse.json(
        data || { error: 'Failed to fetch layanan from case service', code: 'UPSTREAM_UNAVAILABLE' },
        { status: response.status },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching layanan:', error)
    return NextResponse.json({ error: 'Failed to fetch layanan' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const targetVillageId = session.admin.village_id || (
      session.admin.role === 'superadmin' && typeof body.village_id === 'string'
        ? body.village_id.trim()
        : ''
    )

    if (!targetVillageId) {
      return NextResponse.json(
        { error: 'village_id wajib dipilih untuk membuat layanan.' },
        { status: 400 }
      )
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    const category_id = typeof body.category_id === 'string' ? body.category_id : ''
    const mode = typeof body.mode === 'string' ? body.mode : undefined
    const is_active = typeof body.is_active === 'boolean' ? body.is_active : undefined
    const citizen_fields_json = Array.isArray(body.citizen_fields_json)
      ? body.citizen_fields_json
      : undefined
    const estimated_cost = typeof body.estimated_cost === 'string' && body.estimated_cost.trim()
      ? body.estimated_cost.trim()
      : null
    const estimated_processing_time = typeof body.estimated_processing_time === 'string' && body.estimated_processing_time.trim()
      ? body.estimated_processing_time.trim()
      : null

    let slug = typeof body.slug === 'string' ? body.slug.trim() : ''
    if (!slug && name) slug = slugify(name)

    if (!name || !description || !category_id || !slug) {
      return NextResponse.json(
        { error: 'category_id, name, description, slug wajib diisi' },
        { status: 400 }
      )
    }

    const response = await apiFetch(buildUrl(ServicePath.CASE, '/services'), {
      method: 'POST',
      headers: getHeaders({
        'x-village-id': targetVillageId,
        'x-admin-role': session.admin.role,
      }),
      body: JSON.stringify({
        village_id: targetVillageId,
        category_id,
        name,
        description,
        slug,
        mode,
        estimated_cost,
        estimated_processing_time,
        citizen_fields_json,
        is_active,
      }),
    })

    const data = await response.json().catch(() => null)
    if (response.ok) {
      await invalidateVillageAiCacheSafely(targetVillageId)
    }
    return NextResponse.json(data ?? { error: 'Invalid response from case-service' }, { status: response.status })
  } catch (error) {
    console.error('Error creating layanan:', error)
    return NextResponse.json({ error: 'Failed to create layanan' }, { status: 500 })
  }
}
