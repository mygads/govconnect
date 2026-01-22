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

    const url = new URL(buildUrl(ServicePath.CASE, '/complaints/categories'))
    if (session.admin.village_id) {
      url.searchParams.set('village_id', session.admin.village_id)
    }

    const response = await apiFetch(url.toString(), {
      headers: getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch categories' }))
      return NextResponse.json({ error: error.error || 'Failed to fetch categories' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
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
      headers: getHeaders(),
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

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('Error creating complaint category:', error)
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
  }
}