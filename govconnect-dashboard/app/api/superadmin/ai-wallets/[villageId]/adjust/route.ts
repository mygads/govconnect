import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireRole } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ villageId: string }> },
) {
  const [session, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  const { villageId } = await params

  try {
    const body = await request.json().catch(() => ({}))
    const response = await ai.adjustAIWallet(villageId, {
      amount_usd: body.amount_usd,
      direction: body.direction,
      reason: body.reason || body.status_text,
      reference_type: body.reference_type,
      reference_id: body.reference_id,
      metadata: body.metadata,
      created_by_admin_id: session.adminId,
    })
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin AI wallet adjustment proxy error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to adjust AI wallet' }, { status: 500 })
  }
}
