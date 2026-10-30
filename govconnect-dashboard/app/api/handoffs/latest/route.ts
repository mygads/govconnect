import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

/**
 * GET /api/handoffs/latest?user_id=X&channel=whatsapp
 * A1: latest auto-generated takeover summary for a conversation.
 * village_id comes from the session (village admins) — never the client.
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })

  const q = new URL(request.url).searchParams
  const userId = q.get('user_id') ?? ''
  const channel = q.get('channel') ?? 'whatsapp'
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const url = new URL(buildUrl(ServicePath.AI, '/api/handoffs/latest'))
  url.searchParams.set('village_id', villageId)
  url.searchParams.set('user_id', userId)
  url.searchParams.set('channel', channel)

  try {
    const res = await apiFetch(url.toString(), { headers: getHeaders() })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    return NextResponse.json({ error: 'ai-service unreachable', detail: String(err?.message ?? err) }, { status: 502 })
  }
}
