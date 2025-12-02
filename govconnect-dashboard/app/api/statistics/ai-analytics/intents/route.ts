import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:3002'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'govconnect_internal_secret_key_2025_change_in_production'

// GET - Get intent distribution
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

    // Only superadmin can access
    if (payload.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Forward request to AI service
    try {
      const response = await fetch(`${AI_SERVICE_URL}/stats/analytics/intents`, {
        method: 'GET',
        headers: {
          'x-internal-api-key': INTERNAL_API_KEY,
        },
      })

      if (response.ok) {
        const data = await response.json()
        
        // The AI service returns an array, we need to map it to dashboard format
        // Format: { intents: { [intent]: { total, success, failure } }, total: number }
        if (Array.isArray(data)) {
          const intentsMap: Record<string, { total: number; success: number; failure: number }> = {}
          let totalCount = 0
          
          for (const item of data) {
            intentsMap[item.intent] = {
              total: item.count || 0,
              success: item.count || 0, // Assume success if no failure data
              failure: 0,
            }
            totalCount += item.count || 0
          }
          
          return NextResponse.json({
            intents: intentsMap,
            total: totalCount,
          })
        }
        
        // If already in correct format
        return NextResponse.json(data)
      }
    } catch (error) {
      console.log('AI service not available:', error)
    }

    // Return empty data if AI service unavailable
    return NextResponse.json({
      intents: {},
      total: 0,
    })
  } catch (error) {
    console.error('Error fetching intent distribution:', error)
    return NextResponse.json(
      { error: 'Failed to fetch intent distribution' },
      { status: 500 }
    )
  }
}
