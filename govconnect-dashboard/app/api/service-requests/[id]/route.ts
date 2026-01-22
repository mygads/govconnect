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

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await context.params
    const response = await apiFetch(buildUrl(ServicePath.CASE, `/service-requests/${id}`), {
      headers: getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request not found' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    const serviceVillageId = data?.data?.service?.village_id
    if (session.admin.village_id && serviceVillageId && serviceVillageId !== session.admin.village_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching service request detail:', error)
    return NextResponse.json({ error: 'Failed to fetch service request' }, { status: 500 })
  }
}
