import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const [session, authError] = await requireAuth(request)
  if (authError) return authError

  const villageId = session.villageId || request.nextUrl.searchParams.get('village_id')
  if (!villageId) {
    return NextResponse.json({ error: 'village_id is required' }, { status: 400 })
  }

  const limit = request.nextUrl.searchParams.get('limit') || '50'

  try {
    const response = await ai.getAIWalletLedger(villageId, { limit })
    const payload = await response.json().catch(() => ({ error: 'Invalid AI balance ledger response' }))
    return NextResponse.json(payload, { status: response.status })
  } catch (error) {
    console.error('AI balance ledger proxy error:', error)
    return NextResponse.json({ error: 'Failed to fetch AI balance ledger' }, { status: 500 })
  }
}
