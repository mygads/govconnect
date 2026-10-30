import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-session'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

/**
 * GET /api/reports/[scope]?year=2026&month=9&format=json|markdown
 *   scope = 'district' | 'province'
 *
 * A5 scope enforcement happens HERE (not in the AI service):
 * - village admins: the village list is derived FROM THE SESSION —
 *   any client-supplied village_ids are ignored, so an operator can
 *   never pull another village's numbers.
 * - superadmins: must pass ?village_ids= explicitly (they manage all villages).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ scope: string }> }) {
  const { scope } = await params
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (scope !== 'district' && scope !== 'province') {
    return NextResponse.json({ error: "scope must be 'district' or 'province'" }, { status: 400 })
  }

  const q = new URL(request.url).searchParams
  let villageIds: string[]
  if (session.admin.village_id) {
    // Village-scoped operator: session decides, client input ignored.
    villageIds = [session.admin.village_id]
  } else {
    const ids = String(q.get('village_ids') ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean)
    if (ids.length === 0) {
      return NextResponse.json({ error: 'village_ids required for superadmin' }, { status: 400 })
    }
    villageIds = ids
  }

  const year = q.get('year') ?? ''
  const month = q.get('month') ?? ''
  const format = (q.get('format') ?? 'json').toLowerCase()
  if (!/^\d{4}$/.test(year) || !/^(0?[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'year and month (1-12) required' }, { status: 400 })
  }
  if (format !== 'json' && format !== 'markdown') {
    return NextResponse.json({ error: 'format must be json or markdown' }, { status: 400 })
  }

  const url = new URL(buildUrl(ServicePath.AI, `/api/reports/${scope}`))
  url.searchParams.set('village_ids', villageIds.join(','))
  url.searchParams.set('year', year)
  url.searchParams.set('month', month)
  url.searchParams.set('format', format)

  try {
    const res = await apiFetch(url.toString(), { headers: getHeaders() })
    if (format === 'markdown') {
      const text = await res.text()
      return new NextResponse(text, {
        status: res.status,
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      })
    }
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    return NextResponse.json({ error: 'ai-service unreachable', detail: String(err?.message ?? err) }, { status: 502 })
  }
}
