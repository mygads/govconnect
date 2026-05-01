import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { ai } from '@/lib/api-client'

// GET - Get rate limit config and stats
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const villageId = resolveVillageId(request, session)
    const response = await ai.getRateLimit(villageId)
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      return NextResponse.json(
        data || { error: 'Failed to fetch rate limit config', code: 'UPSTREAM_UNAVAILABLE' },
        { status: response.status },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching rate limit:', error)
    return NextResponse.json(
      { error: 'Failed to fetch rate limit' },
      { status: 500 }
    )
  }
}
