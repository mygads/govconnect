import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-session'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

/** POST /api/kb-proposals/[id]/reject — tolak proposal (reviewer = admin login, wajib). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const url = buildUrl(ServicePath.AI, `/api/kb-proposals/${encodeURIComponent(id)}/reject`)
  try {
    const res = await apiFetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ reviewer: session.admin.username, note: String(body?.note ?? '') }),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    return NextResponse.json({ error: 'ai-service unreachable', detail: String(err?.message ?? err) }, { status: 502 })
  }
}
