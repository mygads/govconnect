import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

/** GET /api/media-signals/recent — A4 fraud-signal review queue (proxied, session-scoped). */
export async function GET(request: NextRequest) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })

  const q = new URL(request.url).searchParams
  const url = new URL(buildUrl(ServicePath.AI, '/api/media-signals/recent'))
  url.searchParams.set('village_id', villageId)
  url.searchParams.set('limit', q.get('limit') ?? '50')

  try {
    const res = await apiFetch(url.toString(), { headers: getHeaders() })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    return NextResponse.json({ error: 'ai-service unreachable', detail: String(err?.message ?? err) }, { status: 502 })
  }
}
