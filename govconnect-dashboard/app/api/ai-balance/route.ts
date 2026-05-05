import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const [session, authError] = await requireAuth(request)
  if (authError) return authError

  const villageId = session.villageId || (session.role === 'superadmin' ? request.nextUrl.searchParams.get('village_id') : null)
  if (!villageId) {
    return NextResponse.json({ error: 'village_id is required' }, { status: 400 })
  }

  try {
    const response = await ai.getAIWalletSummary(villageId)
    const payload = await response.json().catch(() => ({ error: 'Invalid AI balance response' }))
    return NextResponse.json(payload, { status: response.status })
  } catch (error) {
    console.error('AI balance summary proxy error:', error)
    return NextResponse.json({ error: 'Failed to fetch AI balance summary' }, { status: 500 })
  }
}
