import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { ai } from '@/lib/api-client'

/**
 * Proxy all /api/statistics/token-usage requests to the AI service.
 * Query params are forwarded as-is.
 * Only superadmin can access.
 */

// Map of sub-path -> api-client method name
const ENDPOINT_MAP: Record<string, keyof typeof ai> = {
  summary: 'getTokenUsageSummary',
  'by-period': 'getTokenUsageByPeriod',
  'by-period-layer': 'getTokenUsageByPeriodLayer',
  'by-model': 'getTokenUsageByModel',
  'by-village': 'getTokenUsageByVillage',
  'layer-breakdown': 'getTokenUsageLayerBreakdown',
  'avg-per-chat': 'getTokenUsageAvgPerChat',
  'responses-by-village': 'getTokenUsageResponsesByVillage',
  'village-model-detail': 'getTokenUsageVillageModelDetail',
  'by-source': 'getTokenUsageBySource',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    const token = request.cookies.get('token')?.value || authHeader?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Only superadmin can access
    if (payload.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const methodName = ENDPOINT_MAP[slug]
    if (!methodName) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Extract query params
    const searchParams = request.nextUrl.searchParams
    const queryObj: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      queryObj[key] = value
    })

    try {
      const method = ai[methodName] as (params?: Record<string, string>) => Promise<Response>
      const response = await method(Object.keys(queryObj).length > 0 ? queryObj : undefined)

      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }

      console.error(`Token usage ${slug} error:`, await response.text())
    } catch (error) {
      console.log(`AI service not available for token-usage/${slug}:`, error)
    }

    // Return empty data if AI service not available
    return NextResponse.json([])
  } catch (error) {
    console.error('Error fetching token usage:', error)
    return NextResponse.json(
      { error: 'Failed to fetch token usage data' },
      { status: 500 }
    )
  }
}
