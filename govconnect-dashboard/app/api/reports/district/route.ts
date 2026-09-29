import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-session'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

/**
 * GET /api/reports/district?year=2026&month=9[&village_ids=a,b untuk superadmin]
 * Proxy ke ai-service /api/reports/district (R11).
 * Scope enforcement: village admin hanya bisa melihat desanya sendiri
 * (diambil dari session); superadmin wajib mengirim ?village_ids=.
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = new URL(request.url).searchParams
  let villageIds: string[]
  if (session.admin.village_id) {
    villageIds = [session.admin.village_id]
  } else {
    const ids = String(q.get('village_ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    if (ids.length === 0) {
      return NextResponse.json({ error: 'village_ids required for superadmin' }, { status: 400 })
    }
    villageIds = ids
  }

  const year = q.get('year') ?? ''
  const month = q.get('month') ?? ''
  if (!/^\d{4}$/.test(year) || !/^(0?[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'year and month (1-12) required' }, { status: 400 })
  }

  const url = new URL(buildUrl(ServicePath.AI, '/api/reports/district'))
  url.searchParams.set('village_ids', villageIds.join(','))
  url.searchParams.set('year', year)
  url.searchParams.set('month', month)

  try {
    const res = await apiFetch(url.toString(), { headers: getHeaders() })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    return NextResponse.json({ error: 'ai-service unreachable', detail: String(err?.message ?? err) }, { status: 502 })
  }
}
