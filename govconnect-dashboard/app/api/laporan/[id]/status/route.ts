import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || 'http://case-service:3003'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'shared-secret-key-12345'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const body = await request.json()
    const { id } = await params

    const response = await fetch(`${CASE_SERVICE_URL}/laporan/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json()
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error updating complaint status:', error)
    return NextResponse.json(
      { error: 'Failed to update complaint status' },
      { status: 500 }
    )
  }
}
