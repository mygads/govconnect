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

    const url = new URL(buildUrl(ServicePath.CASE, '/complaints/types'))
    if (categoryId) url.searchParams.set('category_id', categoryId)
    if (isUrgent) url.searchParams.set('is_urgent', isUrgent)
    if (session.admin.village_id) url.searchParams.set('village_id', session.admin.village_id)

    const response = await apiFetch(url.toString(), {
      headers: getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch types' }))
      return NextResponse.json({ error: error.error || 'Failed to fetch types' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
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