import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:3002'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'shared-secret-key-12345'

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
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
      const response = await fetch(`${AI_SERVICE_URL}/stats/analytics`, {
        method: 'GET',
        headers: {
          'x-internal-api-key': INTERNAL_API_KEY,
        },
      })

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
