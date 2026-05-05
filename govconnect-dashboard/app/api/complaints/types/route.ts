import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

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

    const searchParams = request.nextUrl.searchParams
    const categoryId = searchParams.get('category_id') || undefined
    const isUrgent = searchParams.get('is_urgent') || undefined
    const villageId = session.admin.village_id || undefined

    const url = new URL(buildUrl(ServicePath.CASE, '/complaints/types'))
    if (categoryId) url.searchParams.set('category_id', categoryId)
    if (isUrgent) url.searchParams.set('is_urgent', isUrgent)
    if (villageId) url.searchParams.set('village_id', villageId)

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
      ? await prisma.$queryRaw<Array<{
          id: string
          category_id: string
          name: string
          description: string | null
          is_urgent: boolean
          require_address: boolean
          send_important_contacts: boolean
          important_contact_category: string | null
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

    return NextResponse.json({ data: rows })
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
    } = body

    if (!category_id || !name) {
      return NextResponse.json({ error: 'category_id and name are required' }, { status: 400 })
    }

    if (send_important_contacts && !important_contact_category) {
      return NextResponse.json({ error: 'important_contact_category is required' }, { status: 400 })
    }

    const response = await apiFetch(buildUrl(ServicePath.CASE, '/complaints/types'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        category_id,
        name,
        description: description || null,
        is_urgent: !!is_urgent,
        require_address: !!require_address,
        send_important_contacts: !!send_important_contacts,
        important_contact_category: send_important_contacts ? important_contact_category : null,
      }),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      return NextResponse.json({ error: data.error || 'Failed to create type' }, { status: response.status })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Error creating complaint type:', error)
    return NextResponse.json({ error: 'Failed to create type' }, { status: 500 })
  }
}
