import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireRole } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const modelId = typeof body?.model_id === 'string' ? body.model_id : ''
    if (!modelId) {
      return NextResponse.json({ success: false, error: 'model_id is required' }, { status: 400 })
    }

    const response = await ai.testAIModel(modelId)
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin AI model test proxy error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Failed to test AI model' }, { status: 500 })
  }
}
