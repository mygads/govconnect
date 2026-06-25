import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getHeaders, apiFetch, ServicePath } from '@/lib/api-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function readUpstreamError(response: Response, fallback: string) {
  const raw = await response.text().catch(() => '')
  if (!raw) return fallback
  try {
    const payload = JSON.parse(raw)
    return payload?.error || payload?.message || payload?.detail || fallback
  } catch {
    return raw
  }
}

/** GET /api/admin/failed-messages — list failed messages from AI service */
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = buildUrl(ServicePath.AI, '/admin/failed-messages')
    const response = await apiFetch(url, { headers: getHeaders(), timeout: 10000 })
    if (!response.ok) {
      const upstreamError = await readUpstreamError(response, 'Failed to fetch failed messages')
      return NextResponse.json({ error: upstreamError }, { status: response.status })
    }
    return NextResponse.json(await response.json())
  } catch (error: any) {
    return NextResponse.json({ error: 'AI service unreachable', detail: error.message }, { status: 502 })
  }
}
