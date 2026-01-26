import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

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

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') || undefined
    const limit = searchParams.get('limit') || '20'
    const offset = searchParams.get('offset') || '0'

    // Try to forward request to case service
    try {
      const response = await caseService.getLaporan({ status, limit, offset })

      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }
    } catch (error) {
      console.log('Case service not available, using mock data')
    }

    // Return empty data if case service not available
    return NextResponse.json({
      data: [],
      pagination: {
        total: 0,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    })
  } catch (error) {
    console.error('Error fetching laporan:', error)
    return NextResponse.json(
      { error: 'Failed to fetch laporan' },
      { status: 500 }
    )
  }
}
