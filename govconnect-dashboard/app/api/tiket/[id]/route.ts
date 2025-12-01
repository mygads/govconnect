import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || 'http://case-service:3003'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'shared-secret-key-12345'

export async function GET(
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

    const { id } = await params

    const response = await fetch(`${CASE_SERVICE_URL}/tiket/${id}`, {
      method: 'GET',
      headers: {
        'x-internal-api-key': INTERNAL_API_KEY,
      },
    })

    if (!response.ok) {
      const error = await response.json()
      return NextResponse.json(error, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching ticket:', error)
    return NextResponse.json(
      { error: 'Failed to fetch ticket' },
      { status: 500 }
    )
  }
}
