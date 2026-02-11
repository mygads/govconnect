import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

/**
 * PATCH /api/service-requests/:id/restore
 * Restore a soft-deleted service request
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAdminSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const villageId = resolveVillageId(request, session)
    const { id } = await params

    const response = await caseService.restoreServiceRequest(id, villageId || undefined)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed' }))
      return NextResponse.json(error, { status: response.status })
    }

    return NextResponse.json(await response.json())
  } catch (error) {
    console.error('Error restoring service request:', error)
    return NextResponse.json({ error: 'Failed to restore service request' }, { status: 500 })
  }
}
