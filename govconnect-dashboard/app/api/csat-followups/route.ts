import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'
import { apiFetch, buildUrl, getHeaders, ServicePath } from '@/lib/api-client'

/**
 * GET /api/csat-followups — tiket follow-up CSAT rating rendah (R12).
 *
 * Admin proxy -> ai-service GET /api/fallback-tickets?village_id=&reason=csat_low_rating&status=open.
 * village_id diambil dari sesi admin (bukan dipercaya dari body bebas).
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const villageId = resolveVillageId(session, request)
  if (!villageId) {
    return NextResponse.json({ error: 'village_id diperlukan' }, { status: 400 })
  }

  try {
    const backendUrl = new URL(buildUrl(ServicePath.AI, '/api/fallback-tickets'))
    backendUrl.searchParams.set('village_id', villageId)
    backendUrl.searchParams.set('reason', 'csat_low_rating')
    backendUrl.searchParams.set('status', 'open')

    const backendResp = await apiFetch(backendUrl.toString(), { headers: getHeaders() })
    if (!backendResp.ok) {
      const detail = await backendResp.text().catch(() => '')
      console.error('CSAT follow-ups backend error:', backendResp.status, detail)
      return NextResponse.json(
        { error: 'Gagal memuat daftar tindak lanjut CSAT', tickets: [] },
        { status: 502 },
      )
    }

    const data = await backendResp.json().catch(() => ({ tickets: [] }))
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching CSAT follow-ups:', error)
    return NextResponse.json(
      { error: 'Gagal memuat daftar tindak lanjut CSAT', tickets: [] },
      { status: 500 },
    )
  }
}
