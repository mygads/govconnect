import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

/** POST /api/ktp-verifications/:id/approve — { fields } (reviewer = session admin). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const url = buildUrl(ServicePath.AI, `/api/ktp-verifications/${encodeURIComponent(id)}/approve`)
  try {
    const res = await apiFetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        village_id: villageId,
        reviewed_by: session.admin.username,
        fields: body.fields ?? {},
      }),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    return NextResponse.json({ error: 'ai-service unreachable', detail: String(err?.message ?? err) }, { status: 502 })
  }
}
