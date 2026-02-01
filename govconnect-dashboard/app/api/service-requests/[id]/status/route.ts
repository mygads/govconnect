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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await context.params
    const body = await request.json()
    const { status, admin_notes, result_file_url, result_file_name, result_description } = body

    if (!status) {
      return NextResponse.json({ error: 'status is required' }, { status: 400 })
    }

    // Build URL with village_id for multi-tenancy validation
    const url = new URL(buildUrl(ServicePath.CASE, `/service-requests/${id}/status`))
    if (session.admin.village_id) {
      url.searchParams.set('village_id', session.admin.village_id)
    }

    const response = await apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ 
        status, 
        admin_notes,
        result_file_url,
        result_file_name,
        result_description,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update status' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error updating service request status:', error)
    return NextResponse.json({ error: 'Failed to update service request status' }, { status: 500 })
  }
}
