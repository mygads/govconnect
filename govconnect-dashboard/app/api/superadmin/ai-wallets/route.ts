import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  try {
    const response = await ai.listAIWallets()
    const payload = await response.json()
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Superadmin AI wallets proxy error:', error)
    return NextResponse.json({ error: 'Failed to fetch AI wallets' }, { status: 500 })
  }
}
