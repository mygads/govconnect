import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { getAdminSession } from '@/lib/auth'

function scopedParams(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const allowed = ['start', 'end', 'wa_user_id', 'session_id', 'limit', 'offset']
  const result: Record<string, string> = {}
  for (const key of allowed) {
    const value = params.get(key)
    if (value) result[key] = value
  }
  return result
}

export async function GET(request: NextRequest) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'superadmin' || !session.villageId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const response = await ai.getVillageAIUsageMessages(session.villageId, scopedParams(request))
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load AI usage messages' }, { status: 500 })
  }
}
