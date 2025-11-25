import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

const CASE_SERVICE_URL = process.env.CASE_SERVICE_URL || 'http://localhost:3003'
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

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const jenis = searchParams.get('jenis')
    const limit = searchParams.get('limit') || '20'
    const offset = searchParams.get('offset') || '0'

    // Build URL with query params
    const url = new URL(`${CASE_SERVICE_URL}/tiket`)
    if (jenis) url.searchParams.set('jenis', jenis)
    url.searchParams.set('limit', limit)
    url.searchParams.set('offset', offset)

    // Forward request to case service
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-internal-api-key': INTERNAL_API_KEY,
      },
    })

    if (!response.ok) {
      throw new Error(`Case service responded with status ${response.status}`)
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching tiket:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tiket' },
      { status: 500 }
    )
  }
}
