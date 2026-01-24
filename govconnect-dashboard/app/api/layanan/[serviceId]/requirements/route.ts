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

export async function GET(request: NextRequest, ctx: { params: Promise<{ serviceId: string }> }) {
  try {
    const session = await getSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!session.admin.village_id) {
      return NextResponse.json({ error: 'Admin belum terhubung ke desa. Set village_id dulu.' }, { status: 400 })
    }

    const { serviceId } = await ctx.params
    if (!serviceId) return NextResponse.json({ error: 'serviceId diperlukan' }, { status: 400 })

    const response = await apiFetch(buildUrl(ServicePath.CASE, `/services/${encodeURIComponent(serviceId)}/requirements`), {
      headers: getHeaders(),
    })

    const data = await response.json().catch(() => null)
    return NextResponse.json(data ?? { error: 'Invalid response from case-service' }, { status: response.status })
  } catch (error) {
    console.error('Error fetching layanan requirements:', error)
    return NextResponse.json({ error: 'Failed to fetch layanan requirements' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ serviceId: string }> }) {
  try {
    const session = await getSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!session.admin.village_id) {
      return NextResponse.json({ error: 'Admin belum terhubung ke desa. Set village_id dulu.' }, { status: 400 })
    }

    const { serviceId } = await ctx.params
    if (!serviceId) return NextResponse.json({ error: 'serviceId diperlukan' }, { status: 400 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const response = await apiFetch(buildUrl(ServicePath.CASE, `/services/${encodeURIComponent(serviceId)}/requirements`), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })

    const data = await response.json().catch(() => null)
    return NextResponse.json(data ?? { error: 'Invalid response from case-service' }, { status: response.status })
  } catch (error) {
    console.error('Error creating layanan requirement:', error)
    return NextResponse.json({ error: 'Failed to create layanan requirement' }, { status: 500 })
  }
}
