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

// GET - Fetch current settings
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const response = await fetch(`${CHANNEL_SERVICE_URL}/internal/whatsapp/settings`, {
      headers: {
        'X-Internal-API-Key': INTERNAL_API_KEY,
        'Content-Type': 'application/json',
      },
    })

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching WhatsApp settings:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch WhatsApp settings' },
      { status: 500 }
    )
  }
}

// PATCH - Update settings
export async function PATCH(request: NextRequest) {
  try {
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()

    const response = await fetch(`${CHANNEL_SERVICE_URL}/internal/whatsapp/settings`, {
      method: 'PATCH',
      headers: {
        'X-Internal-API-Key': INTERNAL_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error updating WhatsApp settings:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update WhatsApp settings' },
      { status: 500 }
    )
  }
}
