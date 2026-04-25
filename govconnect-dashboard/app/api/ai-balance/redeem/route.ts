import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const [session, authError] = await requireAuth(request)
  if (authError) return authError

  const villageId = session.villageId || request.nextUrl.searchParams.get('village_id')
  if (!villageId) {
    return NextResponse.json({ error: 'village_id is required' }, { status: 400 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const response = await ai.redeemAIWalletVoucher(villageId, {
      code: body.code,
      admin_id: session.adminId,
    })
    const payload = await response.json()
    return NextResponse.json(payload)
  } catch (error: any) {
    console.error('AI balance redeem proxy error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to redeem AI voucher' }, { status: 500 })
  }
}
