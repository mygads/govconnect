import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getHeaders, apiFetch, ServicePath } from '@/lib/api-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/admin/failed-messages/[messageId]/retry — retry a single failed message */
export async function POST(request: NextRequest, { params }: { params: { messageId: string } }) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { messageId } = params
    if (!messageId) {
      return NextResponse.json({ error: 'messageId is required' }, { status: 400 })
    }
    const url = buildUrl(ServicePath.AI, `/admin/failed-messages/${encodeURIComponent(messageId)}/retry`)
    const response = await apiFetch(url, { method: 'POST', headers: getHeaders(), timeout: 60000 })
    const data = await response.json().catch(() => ({}))
    return NextResponse.json(data, { status: response.status })
  } catch (error: any) {
    return NextResponse.json({ error: 'AI service unreachable', detail: error.message }, { status: 502 })
  }
}
