import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { apiFetch, buildUrl, getHeaders, ServicePath } from '@/lib/api-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const villageId = resolveVillageId(request, session)
    if (!villageId) {
      return NextResponse.json({ error: 'Village-scoped admin session required' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const status = typeof body?.status === 'string' ? body.status : undefined
    const resolutionNote = typeof body?.resolutionNote === 'string' && body.resolutionNote.trim()
      ? body.resolutionNote.trim()
      : undefined

    if (!status) {
      return NextResponse.json({ success: false, error: 'status is required' }, { status: 400 })
    }

    const response = await apiFetch(
      buildUrl(ServicePath.AI, `/api/knowledge-consistency/${encodeURIComponent(id)}/resolve`),
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          status,
          villageId,
          resolvedBy: session.adminId,
          ...(resolutionNote ? { resolutionNote } : {}),
        }),
        timeout: 15000,
      },
    )

    const data = await response.json().catch(() => ({
      success: false,
      error: 'Failed to update knowledge consistency status',
    }))

    return NextResponse.json(data, { status: response.status })
  } catch (error: any) {
    console.error('Knowledge consistency resolve proxy error:', error.message)
    return NextResponse.json(
      { success: false, error: 'AI service unreachable', detail: error.message },
      { status: 502 },
    )
  }
}
