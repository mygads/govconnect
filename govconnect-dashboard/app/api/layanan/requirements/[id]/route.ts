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

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!session.admin.village_id) {
      return NextResponse.json({ error: 'Admin belum terhubung ke desa. Set village_id dulu.' }, { status: 400 })
    }

    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: 'id diperlukan' }, { status: 400 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const response = await apiFetch(buildUrl(ServicePath.CASE, `/services/requirements/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })

    const data = await response.json().catch(() => null)
    return NextResponse.json(data ?? { error: 'Invalid response from case-service' }, { status: response.status })
  } catch (error) {
    console.error('Error updating layanan requirement:', error)
    return NextResponse.json({ error: 'Failed to update layanan requirement' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!session.admin.village_id) {
      return NextResponse.json({ error: 'Admin belum terhubung ke desa. Set village_id dulu.' }, { status: 400 })
    }

    const { id } = await ctx.params
    if (!id) return NextResponse.json({ error: 'id diperlukan' }, { status: 400 })

    const response = await apiFetch(buildUrl(ServicePath.CASE, `/services/requirements/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: getHeaders(),
    })

    const data = await response.json().catch(() => null)
    return NextResponse.json(data ?? { status: 'success' }, { status: response.status })
  } catch (error) {
    console.error('Error deleting layanan requirement:', error)
    return NextResponse.json({ error: 'Failed to delete layanan requirement' }, { status: 500 })
  }
}
