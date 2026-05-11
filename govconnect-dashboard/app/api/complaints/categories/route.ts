import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'
import { invalidateVillageAiCacheSafely } from '@/lib/ai-cache-invalidation'

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

    const villageId = session.admin.village_id || undefined
    const url = new URL(buildUrl(ServicePath.CASE, '/complaints/categories'))
    if (villageId) {
      url.searchParams.set('village_id', villageId)
    }

    try {
      const response = await apiFetch(url.toString(), {
        headers: getHeaders(),
      })

      if (response.ok) {
        const data = await response.json()
        const rows = Array.isArray(data?.data) ? data.data : []
        if (rows.length > 0 || !villageId) {
          return NextResponse.json(data)
        }
      }
    } catch {
      // Fallback to direct DB read below
    }

    const rows = villageId
      ? await prisma.$queryRaw<Array<{ id: string; name: string; description: string | null; village_id: string; is_active: boolean; created_at: Date; updated_at: Date }>>`
          SELECT id, name, description, village_id, is_active, created_at, updated_at
          FROM cases.complaint_categories
          WHERE village_id = ${villageId}
          ORDER BY created_at ASC
        `
      : []

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('Error fetching complaint categories:', error)
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.admin.village_id) {
      return NextResponse.json({ error: 'Village not found' }, { status: 404 })
    }

    const body = await request.json()
    const { name, description } = body
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const response = await apiFetch(buildUrl(ServicePath.CASE, '/complaints/categories'), {
      method: 'POST',
      headers: getHeaders({ 'x-village-id': session.admin.village_id }),
      body: JSON.stringify({
        village_id: session.admin.village_id,
        name,
        description: description || null,
      }),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      return NextResponse.json({ error: data.error || 'Failed to create category' }, { status: response.status })
    }

    await invalidateVillageAiCacheSafely(session.admin.village_id)
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Error creating complaint category:', error)
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
  }
}
