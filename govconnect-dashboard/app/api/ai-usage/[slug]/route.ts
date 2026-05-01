import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { getAdminSession } from '@/lib/auth'

const ENDPOINT_MAP: Record<string, keyof typeof ai> = {
  summary: 'getTokenUsageSummary',
  'by-period': 'getTokenUsageByPeriod',
  'by-period-layer': 'getTokenUsageByPeriodLayer',
  'by-model': 'getTokenUsageByModel',
  'by-provider': 'getTokenUsageByProvider',
  'layer-breakdown': 'getTokenUsageLayerBreakdown',
  'avg-per-chat': 'getTokenUsageAvgPerChat',
}

function scopedParams(request: NextRequest, villageId: string) {
  const params = new URL(request.url).searchParams
  const allowed = ['period', 'model', 'start', 'end', 'wa_user_id', 'session_id']
  const result: Record<string, string> = { village_id: villageId }
  for (const key of allowed) {
    const value = params.get(key)
    if (value) result[key] = value
  }
  return result
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'superadmin' || !session.villageId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { slug } = await params
  const methodName = ENDPOINT_MAP[slug]
  if (!methodName) return NextResponse.json({ error: 'Invalid token usage endpoint' }, { status: 404 })

  try {
    const method = ai[methodName] as (params?: Record<string, string>) => Promise<Response>
    const response = await method(scopedParams(request, session.villageId))
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load AI usage' }, { status: 500 })
  }
}
