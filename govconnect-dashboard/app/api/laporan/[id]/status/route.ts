import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Get admin session with village_id
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get village_id from session for multi-tenancy validation
    const villageId = resolveVillageId(request, session)

    const body = await request.json()
    const { id } = await params

    const response = await caseService.updateLaporanStatus(id, body, villageId || undefined)

    if (!response.ok) {
      const error = await response.json()
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error updating complaint status:', error)
    return NextResponse.json(
      { error: 'Failed to update complaint status' },
      { status: 500 }
    )
  }
}
