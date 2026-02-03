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

// GET single service by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { serviceId } = await params

    const response = await apiFetch(buildUrl(ServicePath.CASE, `/services/${serviceId}`), {
      headers: getHeaders(),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Service not found' }))
      return NextResponse.json(errorData, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching service:', error)
    return NextResponse.json({ error: 'Failed to fetch service' }, { status: 500 })
  }
}

// UPDATE service
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { serviceId } = await params
    const body = await request.json().catch(() => null)
    
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const response = await apiFetch(buildUrl(ServicePath.CASE, `/services/${serviceId}`), {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })

    const data = await response.json().catch(() => null)
    return NextResponse.json(data ?? { error: 'Invalid response from case-service' }, { status: response.status })
  } catch (error) {
    console.error('Error updating service:', error)
    return NextResponse.json({ error: 'Failed to update service' }, { status: 500 })
  }
}

// DELETE service
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { serviceId } = await params

    const response = await apiFetch(buildUrl(ServicePath.CASE, `/services/${serviceId}`), {
      method: 'DELETE',
      headers: getHeaders(),
    })

    if (response.status === 204) {
      return NextResponse.json({ success: true })
    }

    const data = await response.json().catch(() => null)
    return NextResponse.json(data ?? { error: 'Invalid response from case-service' }, { status: response.status })
  } catch (error) {
    console.error('Error deleting service:', error)
    return NextResponse.json({ error: 'Failed to delete service' }, { status: 500 })
  }
}
