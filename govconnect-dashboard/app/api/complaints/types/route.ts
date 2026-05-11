import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'
import { invalidateVillageAiCacheSafely } from '@/lib/ai-cache-invalidation'
import {
  findVillageImportantContactCategoryById,
  findVillageImportantContactCategoryByName,
} from '@/lib/important-contact-categories'

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

async function resolveImportantContactCategory(villageId: string, categoryId?: string | null, categoryName?: string | null) {
  if (categoryId) {
    const category = await findVillageImportantContactCategoryById(villageId, categoryId)
    if (category) return { id: category.id, name: category.name }
  }

  if (categoryName) {
    const category = await findVillageImportantContactCategoryByName(villageId, categoryName)
    if (category) return { id: category.id, name: category.name }
  }

  return null
}

async function enrichImportantContactCategory<T extends {
  important_contact_category?: string | null
  important_contact_category_id?: string | null
}>(rows: T[], villageId?: string) {
  if (!villageId || rows.length === 0) return rows

  const categoryIds = Array.from(new Set(rows.map((row) => row.important_contact_category_id).filter(Boolean))) as string[]
  if (categoryIds.length === 0) return rows

  const categories = await prisma.important_contact_categories.findMany({
    where: {
      village_id: villageId,
      id: { in: categoryIds },
    },
    select: { id: true, name: true },
  })

  const byId = new Map(categories.map((category) => [category.id, category.name]))

  return rows.map((row) => ({
    ...row,
    important_contact_category: row.important_contact_category_id
      ? byId.get(row.important_contact_category_id) || row.important_contact_category || null
      : row.important_contact_category || null,
  }))
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const categoryId = searchParams.get('category_id') || undefined
    const isUrgent = searchParams.get('is_urgent') || undefined
    const villageId = session.admin.village_id || undefined

    const url = new URL(buildUrl(ServicePath.CASE, '/complaints/types'))
    if (categoryId) url.searchParams.set('category_id', categoryId)
    if (isUrgent) url.searchParams.set('is_urgent', isUrgent)
    if (villageId) url.searchParams.set('village_id', villageId)
    else if (session.admin.role === 'superadmin') url.searchParams.set('scope', 'all')

    try {
      const response = await apiFetch(url.toString(), {
        headers: getHeaders({
          'x-admin-role': session.admin.role,
          ...(villageId ? { 'x-village-id': villageId } : {}),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const rows = Array.isArray(data?.data) ? data.data : []
        if (rows.length > 0 || !villageId) {
          const enrichedRows = await enrichImportantContactCategory(rows, villageId)
          return NextResponse.json({ ...data, data: enrichedRows })
        }
      }
    } catch {
      // Fallback to direct DB read below
    }

    const rows = villageId
      ? await prisma.$queryRaw<Array<{
          id: string
          category_id: string
          name: string
          description: string | null
          is_urgent: boolean
          require_address: boolean
          send_important_contacts: boolean
          important_contact_category: string | null
          important_contact_category_id: string | null
          created_at: Date
          updated_at: Date
          category: { id: string; name: string; description: string | null; village_id: string; is_active: boolean }
        }>>`
          SELECT
            t.id,
            t.category_id,
            t.name,
            t.description,
            t.is_urgent,
            t.require_address,
            t.send_important_contacts,
            t.important_contact_category,
            NULL::text AS important_contact_category_id,
            t.created_at,
            t.updated_at,
            json_build_object(
              'id', c.id,
              'name', c.name,
              'description', c.description,
              'village_id', c.village_id,
              'is_active', c.is_active
            ) AS category
          FROM cases.complaint_types t
          JOIN cases.complaint_categories c ON c.id = t.category_id
          WHERE c.village_id = ${villageId}
            AND (${categoryId || null}::text IS NULL OR t.category_id = ${categoryId || null})
            AND (
              ${isUrgent || null}::text IS NULL
              OR (${isUrgent || null} = 'true' AND t.is_urgent = true)
              OR (${isUrgent || null} = 'false' AND t.is_urgent = false)
            )
          ORDER BY t.created_at ASC
        `
      : []

    const enrichedRows = await enrichImportantContactCategory(rows, villageId)
    return NextResponse.json({ data: enrichedRows })
  } catch (error) {
    console.error('Error fetching complaint types:', error)
    return NextResponse.json({ error: 'Failed to fetch types' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      category_id,
      name,
      description,
      is_urgent,
      require_address,
      send_important_contacts,
      important_contact_category,
      important_contact_category_id,
    } = body

    if (!category_id || !name) {
      return NextResponse.json({ error: 'category_id and name are required' }, { status: 400 })
    }

    if (send_important_contacts && !important_contact_category && !important_contact_category_id) {
      return NextResponse.json({ error: 'important contact category is required' }, { status: 400 })
    }

    const resolvedImportantContactCategory = !!send_important_contacts && session.admin.village_id
      ? await resolveImportantContactCategory(session.admin.village_id, important_contact_category_id, important_contact_category)
      : null

    if (send_important_contacts && !resolvedImportantContactCategory) {
      return NextResponse.json({ error: 'important contact category tidak valid untuk desa ini' }, { status: 400 })
    }

    const response = await apiFetch(buildUrl(ServicePath.CASE, '/complaints/types'), {
      method: 'POST',
      headers: getHeaders({
        'x-admin-role': session.admin.role,
        ...(session.admin.village_id ? { 'x-village-id': session.admin.village_id } : {}),
      }),
      body: JSON.stringify({
        category_id,
        name,
        description: description || null,
        is_urgent: !!is_urgent,
        require_address: !!require_address,
        send_important_contacts: !!send_important_contacts,
        important_contact_category: null,
        important_contact_category_id: send_important_contacts ? resolvedImportantContactCategory?.id ?? null : null,
      }),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      return NextResponse.json({ error: data.error || 'Failed to create type' }, { status: response.status })
    }

    await invalidateVillageAiCacheSafely(session.admin.village_id)
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Error creating complaint type:', error)
    return NextResponse.json({ error: 'Failed to create type' }, { status: 500 })
  }
}
