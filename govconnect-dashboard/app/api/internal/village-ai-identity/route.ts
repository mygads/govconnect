import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedInternalRequest } from '@/lib/internal-api-auth'
import prisma from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const DEFAULT_AI_IDENTITY = {
  disclosure: true,
  persona_name: 'Gana',
  persona_description: null as string | null,
}

/**
 * GET /api/internal/village-ai-identity?village_id=
 * Dibaca oleh ai-service (fail-open dengan default bila dashboard tidak
 * terjangkau). disclosure=true berarti agen menyebut dirinya
 * "asisten AI resmi, bukan petugas manusia".
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedInternalRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const villageId = request.nextUrl.searchParams.get('village_id')
  if (!villageId) return NextResponse.json({ error: 'village_id is required' }, { status: 400 })

  try {
    const row = await (prisma as any).village_behavior_configs.findUnique({
      where: { village_id: villageId },
      select: {
        ai_identity_disclosure: true,
        ai_persona_name: true,
        ai_persona_description: true,
      },
    })
    if (!row) return NextResponse.json({ data: { village_id: villageId, ai_identity: DEFAULT_AI_IDENTITY } })
    return NextResponse.json({
      data: {
        village_id: villageId,
        ai_identity: {
          disclosure: row.ai_identity_disclosure ?? true,
          persona_name: (row.ai_persona_name || '').trim() || 'Gana',
          persona_description: row.ai_persona_description || null,
        },
      },
    })
  } catch (error: any) {
    console.warn('village-ai-identity lookup failed, returning default', { error: error?.message })
    return NextResponse.json({ data: { village_id: villageId, ai_identity: DEFAULT_AI_IDENTITY } })
  }
}
