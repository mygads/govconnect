import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { ai } from '@/lib/api-client'

export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const villageId = resolveVillageId(request, session)
    if (!villageId) {
      return NextResponse.json({ error: 'Village ID required' }, { status: 400 })
    }

    const kind = request.nextUrl.searchParams.get('kind') || 'all'
    const format = request.nextUrl.searchParams.get('format') || 'json'
    const limit = request.nextUrl.searchParams.get('limit') || '1000'

    const response = await ai.exportAnalytics({
      village_id: villageId,
      kind,
      format,
      limit,
    })

    if (!response.ok) {
      const text = await response.text()
      return NextResponse.json({ error: text || 'Failed to export analytics' }, { status: response.status })
    }

    const contentType = response.headers.get('content-type') || (format === 'ndjson'
      ? 'application/x-ndjson; charset=utf-8'
      : 'application/json; charset=utf-8')
    const filename = `govconnect-observability-${kind}-${new Date().toISOString().slice(0, 10)}.${format === 'ndjson' ? 'ndjson' : 'json'}`
    const body = await response.text()

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
