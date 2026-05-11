import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getAdminSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const villageId = resolveVillageId(request, session)
    const { id } = await context.params
    const body = await request.json()
    const { status, admin_notes, result_file_url, result_file_name, result_description } = body
    const hasMutableField = ['status', 'admin_notes', 'result_file_url', 'result_file_name', 'result_description']
      .some((key) => Object.prototype.hasOwnProperty.call(body, key))

    if (!hasMutableField) {
      return NextResponse.json({ error: 'Tidak ada perubahan yang dikirim' }, { status: 400 })
    }

    const url = new URL(buildUrl(ServicePath.CASE, `/service-requests/${id}/status`))
    if (villageId) {
      url.searchParams.set('village_id', villageId)
    }

    const response = await apiFetch(url.toString(), {
      method: 'PATCH',
      headers: getHeaders(villageId ? { 'x-village-id': villageId } : undefined),
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
