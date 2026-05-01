import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { getAdminSession } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ billingId: string }> },
) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'superadmin' || !session.villageId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { billingId } = await params
  try {
    const response = await ai.getVillageAIUsageMessageDetail(session.villageId, billingId)
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load AI usage message detail' }, { status: 500 })
  }
}
