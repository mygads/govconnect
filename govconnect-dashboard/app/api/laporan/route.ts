import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

export const revalidate = 30 // Cache for 30 seconds

export async function GET(request: NextRequest) {
  try {
    // Get admin session with village_id
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get village_id from session (required for village_admin, optional for superadmin)
    const villageId = resolveVillageId(request, session)

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') || undefined
    const search = searchParams.get('search') || undefined
    const limit = searchParams.get('limit') || '20'
    const offset = searchParams.get('offset') || '0'

    const response = await caseService.getLaporan({
      status,
      search,
      limit,
      offset,
      village_id: villageId || undefined,
    })

    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return NextResponse.json(
        data || { error: 'Failed to fetch laporan from case service' },
        { status: response.status },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching laporan:', error)
    return NextResponse.json(
      { error: 'Failed to fetch laporan' },
      { status: 500 }
    )
  }
}
