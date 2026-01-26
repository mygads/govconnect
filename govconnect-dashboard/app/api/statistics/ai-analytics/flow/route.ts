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

    // Only superadmin can access
    if (payload.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Forward request to AI service
    try {
      const response = await ai.getAnalyticsFlow()

      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }
    } catch (error) {
      console.log('AI service not available:', error)
    }

    return NextResponse.json({
      patterns: [],
      dropOffPoints: [],
      avgMessagesPerSession: 0,
      totalSessions: 0,
    })
  } catch (error) {
    console.error('Error fetching conversation flow:', error)
    return NextResponse.json(
      { error: 'Failed to fetch conversation flow' },
      { status: 500 }
    )
  }
}
