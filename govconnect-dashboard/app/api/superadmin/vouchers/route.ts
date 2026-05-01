import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  try {
    const response = await ai.listAIVouchers()
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error) {
    console.error('Superadmin vouchers proxy error:', error)
    return NextResponse.json({ error: 'Failed to fetch AI vouchers' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const [session, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const response = await ai.createAIVoucher({
      code: body.code,
      amount_usd: body.amount_usd,
      expires_at: body.expires_at,
      metadata: body.metadata,
      created_by_admin_id: session.adminId,
    })
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin voucher create proxy error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to create AI voucher' }, { status: 500 })
  }
}
