import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getHeaders, apiFetch, ServicePath } from '@/lib/api-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/admin/failed-messages/retry-all — bulk reprocess */
export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = buildUrl(ServicePath.AI, '/admin/failed-messages/retry-all')
    const response = await apiFetch(url, { method: 'POST', headers: getHeaders(), timeout: 60000 })
    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      return NextResponse.json({ error: raw || 'Failed to retry all' }, { status: response.status })
    }
    return NextResponse.json(await response.json())
  } catch (error: any) {
    return NextResponse.json({ error: 'AI service unreachable', detail: error.message }, { status: 502 })
  }
}
