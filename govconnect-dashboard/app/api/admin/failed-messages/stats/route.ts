import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getHeaders, apiFetch, ServicePath } from '@/lib/api-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/admin/failed-messages/stats */
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = buildUrl(ServicePath.AI, '/admin/failed-messages/stats')
    const response = await apiFetch(url, { headers: getHeaders(), timeout: 10000 })
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch stats' }, { status: response.status })
    }
    return NextResponse.json(await response.json())
  } catch (error: any) {
    return NextResponse.json({ error: 'AI service unreachable', detail: error.message }, { status: 502 })
  }
}
