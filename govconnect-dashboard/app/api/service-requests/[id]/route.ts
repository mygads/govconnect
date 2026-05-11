import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getAdminSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const villageId = resolveVillageId(request, session)
    const { id } = await context.params
    const url = new URL(buildUrl(ServicePath.CASE, `/service-requests/${id}`))
    if (villageId) {
      url.searchParams.set('village_id', villageId)
    }

    const response = await apiFetch(url.toString(), {
      headers: getHeaders(villageId ? { 'x-village-id': villageId } : undefined),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request not found' }))
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    const serviceVillageId = data?.data?.service?.village_id
    if (session.villageId && serviceVillageId && serviceVillageId !== session.villageId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching service request detail:', error)
    return NextResponse.json({ error: 'Failed to fetch service request' }, { status: 500 })
  }
}
