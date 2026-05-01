import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

export async function GET(request: NextRequest) {
  try {
    // Get admin session with village_id
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get village_id from session (required for village_admin, optional for superadmin)
    const villageId = resolveVillageId(request, session)

    // Get period from query params
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'weekly'

    const response = await caseService.getTrends(period, villageId || undefined)
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      return NextResponse.json(
        data || { error: 'Failed to fetch trends from case service', code: 'UPSTREAM_UNAVAILABLE' },
        { status: response.status },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching trends:', error)
    return NextResponse.json(
      { error: 'Failed to fetch trends' },
      { status: 500 }
    )
  }
}
