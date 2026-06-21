import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireRole } from '@/lib/auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ villageId: string }> },
) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  const { villageId } = await params

  try {
    const body = await request.json().catch(() => ({}))
    const channelIdentifier = body.channel_identifier

    if (channelIdentifier) {
      const response = await ai.flushHeldMessages(villageId, channelIdentifier)
      const payload = await response.json()
      return NextResponse.json(payload, { status: response.status })
    }

    const response = await ai.flushAllHeldMessages(villageId)
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin held-messages flush proxy error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to flush held messages' }, { status: 500 })
  }
}
