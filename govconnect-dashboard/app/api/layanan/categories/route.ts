import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

async function getSession(request: NextRequest) {
  const token =
    request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true },
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

    const url = new URL(buildUrl(ServicePath.CASE, '/service-categories'))
    if (session.admin.village_id) {
      url.searchParams.set('village_id', session.admin.village_id)
    }

    const response = await apiFetch(url.toString(), {
      headers: getHeaders(),
    })

    const data = await response.json().catch(() => null)
    return NextResponse.json(data ?? { error: 'Invalid response from case-service' }, { status: response.status })
  } catch (error) {
    console.error('Error fetching layanan categories:', error)
    return NextResponse.json(
      { error: 'Failed to fetch layanan categories' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.admin.village_id) {
      return NextResponse.json(
        { error: 'Admin belum terhubung ke desa. Set village_id dulu.' },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const description =
      typeof body.description === 'string' ? body.description.trim() : undefined

    if (!name) {
      return NextResponse.json({ error: 'name wajib diisi' }, { status: 400 })
    }

    const response = await apiFetch(buildUrl(ServicePath.CASE, '/service-categories'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        village_id: session.admin.village_id,
        name,
        description,
      }),
    })

    const data = await response.json().catch(() => null)
    return NextResponse.json(data ?? { error: 'Invalid response from case-service' }, { status: response.status })
  } catch (error) {
    console.error('Error creating layanan category:', error)
    return NextResponse.json(
      { error: 'Failed to create layanan category' },
      { status: 500 }
    )
  }
}
