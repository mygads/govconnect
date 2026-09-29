import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

/** GET /api/ktp-verifications/:id/nik — decrypt-on-view (proxied, audited server-side). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })

  const url = new URL(buildUrl(ServicePath.AI, `/api/ktp-verifications/${encodeURIComponent(params.id)}/nik`))
  url.searchParams.set('village_id', villageId)
  url.searchParams.set('reviewed_by', session.admin.username ?? 'admin')
  try {
    const res = await apiFetch(url.toString(), { headers: getHeaders() })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    return NextResponse.json({ error: 'ai-service unreachable', detail: String(err?.message ?? err) }, { status: 502 })
  }
}
