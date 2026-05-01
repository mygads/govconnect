import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
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

    const response = await ai.getAIGenerationLogs(params)
    const payload = await response.json()
    const rows = Array.isArray(payload?.data) ? payload.data : []
    const villageIds = Array.from(new Set(rows.map((row: any) => row.village_id).filter(Boolean))) as string[]
    const villages = villageIds.length
      ? await prisma.villages.findMany({ where: { id: { in: villageIds } }, select: { id: true, name: true, slug: true } })
      : []
    const villageMap = new Map(villages.map((v) => [v.id, v]))

    return NextResponse.json({
      ...payload,
      data: rows.map((row: any) => ({
        ...row,
        village: row.village_id ? villageMap.get(row.village_id) ?? null : null,
      })),
    }, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin AI generation logs proxy error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load AI generation logs' }, { status: 500 })
  }
}
