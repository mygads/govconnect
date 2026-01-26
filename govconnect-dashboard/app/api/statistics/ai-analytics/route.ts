import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { ai } from '@/lib/api-client'

export async function GET(request: NextRequest) {
  try {
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

    // Only superadmin can access analytics
    if (payload.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Forward request to AI service
    try {
      const response = await ai.getAnalytics()

      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }

      console.error('AI service analytics error:', await response.text())
    } catch (error) {
      console.log('AI service not available for analytics:', error)
    }

    // Return empty data if AI service not available
    return NextResponse.json({
      totalRequests: 0,
      overallAccuracy: 0,
      totalCostUSD: 0,
      avgProcessingTimeMs: 0,
      topIntents: [],
      topPatterns: [],
      tokenUsageLast7Days: [],
    })
  } catch (error) {
    console.error('Error fetching analytics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    )
  }
}
