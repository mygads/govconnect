import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

/**
 * GET /api/service-requests/deleted
 * List soft-deleted service requests
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const villageId = resolveVillageId(request, session)

    const response = await caseService.getDeletedServiceRequests(villageId || undefined)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed' }))
      return NextResponse.json(error, { status: response.status })
    }

    return NextResponse.json(await response.json())
  } catch (error) {
    console.error('Error fetching deleted service requests:', error)
    return NextResponse.json({ error: 'Failed to fetch deleted service requests' }, { status: 500 })
  }
}
