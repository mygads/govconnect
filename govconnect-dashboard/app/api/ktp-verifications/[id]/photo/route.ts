import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

/**
 * GET /api/ktp-verifications/:id/photo — KTP photo for the admin split-view.
 * Binary proxy; no-store so reviewed photos are never cached.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })

  const url = new URL(buildUrl(ServicePath.AI, `/api/ktp-verifications/${encodeURIComponent(id)}/photo`))
  url.searchParams.set('village_id', villageId)
  try {
    const res = await apiFetch(url.toString(), { headers: getHeaders() })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return NextResponse.json(data, { status: res.status })
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'image/jpeg',
        'cache-control': 'no-store',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'ai-service unreachable', detail: String(err?.message ?? err) }, { status: 502 })
  }
}
