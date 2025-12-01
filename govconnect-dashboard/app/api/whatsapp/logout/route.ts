import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://localhost:3001'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

async function getAuthUser(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  const token = authHeader.split(' ')[1]
  return await verifyToken(token)
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const response = await fetch(`${CHANNEL_SERVICE_URL}/internal/whatsapp/logout`, {
      method: 'POST',
      headers: {
        'X-Internal-API-Key': INTERNAL_API_KEY,
        'Content-Type': 'application/json',
      },
    })

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error logging out WhatsApp:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to logout WhatsApp' },
      { status: 500 }
    )
  }
}
