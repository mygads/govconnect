import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireRole } from '@/lib/auth'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const response = await ai.updateAIModel(id, body)
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin AI model update proxy error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to update AI model' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  try {
    const { id } = await params
    const response = await ai.deleteAIModel(id)
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin AI model delete proxy error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to delete AI model' }, { status: 500 })
  }
}
