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

    try {
      const response = await ai.getModelsStats()
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        return NextResponse.json(
          data || { error: 'AI service unavailable', code: 'UPSTREAM_UNAVAILABLE' },
          { status: response.status },
        )
      }

      return NextResponse.json(data)
    } catch (error) {
      console.log('AI service not available:', error)
      return NextResponse.json(
        { error: 'AI service is currently offline', code: 'UPSTREAM_UNAVAILABLE' },
        { status: 503 },
      )
    }
  } catch (error) {
    console.error('Error fetching AI usage stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch AI usage statistics' },
      { status: 500 }
    )
  }
}
