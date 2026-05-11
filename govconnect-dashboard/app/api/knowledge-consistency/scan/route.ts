import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { apiFetch, buildUrl, getHeaders, ServicePath } from '@/lib/api-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const villageId = resolveVillageId(request, session)
    if (!villageId) {
      return NextResponse.json({ error: 'Village ID required' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const includeKbSweep = body?.includeKbSweep !== false

    const response = await apiFetch(buildUrl(ServicePath.AI, '/api/knowledge-consistency/scan'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ villageId, includeKbSweep }),
      timeout: 60000,
    })

    const data = await response.json().catch(() => ({
      success: false,
      error: 'Failed to scan knowledge consistency',
    }))

    return NextResponse.json(data, { status: response.status })
  } catch (error: any) {
    console.error('Knowledge consistency scan proxy error:', error.message)
    return NextResponse.json(
      { success: false, error: 'AI service unreachable', detail: error.message },
      { status: 502 },
    )
  }
}
