import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params
    const response = await caseService.getLaporanById(id)

    if (!response.ok) {
      const error = await response.json()
      return NextResponse.json(error, { status: response.status })
    }

    const result = await response.json()
    // Extract data from case-service response format { data: {...} }
    return NextResponse.json(result.data || result)
  } catch (error) {
    console.error('Error fetching complaint:', error)
    return NextResponse.json(
      { error: 'Failed to fetch complaint' },
      { status: 500 }
    )
  }
}
