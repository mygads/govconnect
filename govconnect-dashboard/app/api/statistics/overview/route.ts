import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Get admin session with village_id
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get village_id from session (required for village_admin, optional for superadmin)
    const villageId = resolveVillageId(request, session)

    const response = await caseService.getOverview({
      village_id: villageId || undefined,
    })

    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return NextResponse.json(
        data || { error: 'Failed to fetch statistics from case service', code: 'UPSTREAM_UNAVAILABLE' },
        { status: response.status },
      )
    }

    return NextResponse.json({
      complaints: {
        total: data.totalLaporan || 0,
        open: data.laporan?.open || 0,
        process: data.laporan?.process || 0,
        done: data.laporan?.done || 0,
        canceled: data.laporan?.canceled || 0,
        reject: data.laporan?.reject || 0,
      },
      services: {
        total: data.totalLayanan || 0,
        open: data.layanan?.open || 0,
        process: data.layanan?.process || 0,
        done: data.layanan?.done || 0,
        canceled: data.layanan?.canceled || 0,
        reject: data.layanan?.reject || 0,
      },
    })
  } catch (error) {
    console.error('Error fetching statistics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    )
  }
}
