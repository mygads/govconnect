import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

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

    try {
      const url = new URL(buildUrl(ServicePath.CASE, '/services'))
      if (session.admin.village_id) {
        url.searchParams.set('village_id', session.admin.village_id)
      }

      const response = await apiFetch(url.toString(), {
        headers: getHeaders(),
      })

      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }
    } catch (error) {
      console.log('Case service not available for layanan')
    }

    return NextResponse.json({ data: [] })
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
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    const category_id = typeof body.category_id === 'string' ? body.category_id : ''
    const mode = typeof body.mode === 'string' ? body.mode : undefined
    const is_active = typeof body.is_active === 'boolean' ? body.is_active : undefined

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
      headers: getHeaders(),
      body: JSON.stringify({
        village_id: session.admin.village_id,
        category_id,
        name,
        description,
        slug,
        mode,
        is_active,
      }),
    })

    const data = await response.json().catch(() => null)
    return NextResponse.json(data ?? { error: 'Invalid response from case-service' }, { status: response.status })
  } catch (error) {
    console.error('Error creating layanan:', error)
    return NextResponse.json({ error: 'Failed to create layanan' }, { status: 500 })
  }
}
