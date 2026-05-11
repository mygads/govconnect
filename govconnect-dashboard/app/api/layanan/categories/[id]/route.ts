import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'
import { invalidateVillageAiCacheSafely } from '@/lib/ai-cache-invalidation'

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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const requestedVillageId = request.nextUrl.searchParams.get('village_id')?.trim() || ''
    const targetVillageId = session.admin.village_id || (session.admin.role === 'superadmin' ? requestedVillageId : '')

    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : undefined
    const description =
      typeof body.description === 'string' ? (body.description.trim() || null) : body.description

    if (body.name !== undefined && !name) {
      return NextResponse.json({ error: 'name wajib diisi' }, { status: 400 })
    }

    const response = await apiFetch(buildUrl(ServicePath.CASE, `/service-categories/${id}`), {
      method: 'PATCH',
      headers: getHeaders({
        ...(targetVillageId ? { 'x-village-id': targetVillageId } : {}),
        'x-admin-role': session.admin.role,
      }),
      body: JSON.stringify({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      }),
    })

    const data = await response.json().catch(() => null)
    if (response.ok) {
      await invalidateVillageAiCacheSafely(targetVillageId)
    }
    return NextResponse.json(data ?? { error: 'Invalid response from case-service' }, { status: response.status })
  } catch (error) {
    console.error('Error updating layanan category:', error)
    return NextResponse.json(
      { error: 'Failed to update layanan category' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const requestedVillageId = request.nextUrl.searchParams.get('village_id')?.trim() || ''
    const targetVillageId = session.admin.village_id || (session.admin.role === 'superadmin' ? requestedVillageId : '')

    const { id } = await context.params

    const response = await apiFetch(buildUrl(ServicePath.CASE, `/service-categories/${id}`), {
      method: 'DELETE',
      headers: getHeaders({
        ...(targetVillageId ? { 'x-village-id': targetVillageId } : {}),
        'x-admin-role': session.admin.role,
      }),
    })

    if (response.status === 204) {
      await invalidateVillageAiCacheSafely(targetVillageId)
      return NextResponse.json({ success: true })
    }

    const data = await response.json().catch(() => null)
    if (response.ok) {
      await invalidateVillageAiCacheSafely(targetVillageId)
    }
    return NextResponse.json(data ?? { error: 'Invalid response from case-service' }, { status: response.status })
  } catch (error) {
    console.error('Error deleting layanan category:', error)
    return NextResponse.json(
      { error: 'Failed to delete layanan category' },
      { status: 500 }
    )
  }
}
