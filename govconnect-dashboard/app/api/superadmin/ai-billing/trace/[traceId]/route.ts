import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireRole } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ traceId: string }> },
) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  const { traceId } = await params

  try {
    const response = await ai.getAIBillingTrace(traceId)
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin AI trace proxy error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load AI trace' }, { status: 500 })
  }
}
