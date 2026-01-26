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

    // Check if superadmin
    if (payload.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden - Superadmin only' }, { status: 403 })
    }

    // Try to forward request to AI service
    try {
      const response = await ai.getModelsStats()

      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }

      // If AI service returns error, return the error message
      const errorData = await response.json().catch(() => ({}))
      console.log('AI service error:', response.status, errorData)
      
      return NextResponse.json({
        error: 'AI service unavailable',
        status: response.status,
        message: errorData.message || 'Failed to fetch AI stats'
      }, { status: response.status })
    } catch (error) {
      console.log('AI service not available:', error)
      
      // Return empty stats if AI service not available
      return NextResponse.json({
        summary: {
          totalRequests: 0,
          lastUpdated: null,
          totalModels: 0,
          serviceStatus: 'offline'
        },
        models: [],
        error: 'AI service is currently offline'
      })
    }
  } catch (error) {
    console.error('Error fetching AI usage stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch AI usage statistics' },
      { status: 500 }
    )
  }
}
