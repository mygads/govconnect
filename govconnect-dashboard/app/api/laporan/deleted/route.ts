import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

/**
 * GET /api/laporan/deleted
 * List soft-deleted complaints
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const villageId = resolveVillageId(request, session)

    const response = await caseService.getDeletedLaporan(villageId || undefined)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed' }))
      return NextResponse.json(error, { status: response.status })
    }

    return NextResponse.json(await response.json())
  } catch (error) {
    console.error('Error fetching deleted complaints:', error)
    return NextResponse.json({ error: 'Failed to fetch deleted complaints' }, { status: 500 })
  }
}
