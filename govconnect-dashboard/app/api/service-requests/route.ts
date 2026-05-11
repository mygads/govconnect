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
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || undefined
    const search = searchParams.get('search') || undefined
    const limit = searchParams.get('limit') || undefined
    const offset = searchParams.get('offset') || undefined
    const requestedVillageId = searchParams.get('village_id')?.trim() || ''
    const targetVillageId = session.admin.village_id || (session.admin.role === 'superadmin' ? requestedVillageId : '')

    if (!targetVillageId) {
      return NextResponse.json(
        { error: 'village_id wajib dipilih untuk melihat daftar permohonan layanan.' },
        { status: 400 },
      )
    }

    const url = new URL(buildUrl(ServicePath.CASE, '/service-requests'))
    if (status) url.searchParams.set('status', status)
    if (search) url.searchParams.set('search', search)
    if (limit) url.searchParams.set('limit', limit)
    if (offset) url.searchParams.set('offset', offset)
    url.searchParams.set('village_id', targetVillageId)

    const response = await apiFetch(url.toString(), {
      headers: getHeaders({
        'x-village-id': targetVillageId,
        'x-admin-role': session.admin.role,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch service requests' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching service requests:', error)
    return NextResponse.json({ error: 'Failed to fetch service requests' }, { status: 500 })
  }
}
