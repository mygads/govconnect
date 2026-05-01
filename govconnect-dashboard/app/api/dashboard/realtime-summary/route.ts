import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const villageId = resolveVillageId(request, session)
    const response = await caseService.getRealtimeComplaintSummary(villageId || undefined)
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      return NextResponse.json(
        data || { error: 'Failed to fetch realtime summary', code: 'UPSTREAM_UNAVAILABLE' },
        { status: response.status },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching realtime summary:', error)
    return NextResponse.json(
      { error: 'Failed to fetch realtime summary', code: 'UPSTREAM_UNAVAILABLE' },
      { status: 503 },
    )
  }
}
