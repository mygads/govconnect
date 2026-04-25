import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  try {
    const response = await ai.listAIModels()
    const payload = await response.json()
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Superadmin AI models proxy error:', error)
    return NextResponse.json({ error: 'Failed to fetch AI models' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const response = await ai.createAIModel(body)
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin AI model create proxy error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to create AI model' }, { status: 500 })
  }
}
