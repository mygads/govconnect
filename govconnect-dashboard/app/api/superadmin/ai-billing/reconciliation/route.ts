import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  try {
    const params: Record<string, string> = {}
    request.nextUrl.searchParams.forEach((value, key) => {
      if (value) params[key] = value
    })

    const response = await ai.getAIBillingReconciliation(params)
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin AI billing reconciliation proxy error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to reconcile AI billing' }, { status: 500 })
  }
}
