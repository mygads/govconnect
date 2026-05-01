import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { ai } from '@/lib/api-client'
import { requireRole } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  const { id } = await params
  try {
    const response = await ai.getAIGenerationLogDetail(id)
    const payload = await response.json()
    const villageId = payload?.data?.log?.village_id || payload?.data?.token_usage?.village_id || payload?.log?.village_id || payload?.token_usage?.village_id
    const village = villageId
      ? await prisma.villages.findUnique({ where: { id: villageId }, select: { id: true, name: true, slug: true } })
      : null

    const data = payload?.data ? { ...payload.data, village } : payload
    return NextResponse.json({ ...payload, data }, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin AI generation detail proxy error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load AI generation detail' }, { status: 500 })
  }
}
