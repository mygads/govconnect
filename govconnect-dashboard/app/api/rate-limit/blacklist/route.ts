import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { ai } from '@/lib/api-client'

// GET - Get blacklist
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const payload = await verifyToken(token)
    if (!payload || (payload.role !== 'superadmin' && payload.role !== 'village_admin' && payload.role !== 'admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    try {
      const response = await ai.getBlacklist()

      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }
    } catch (error) {
      console.log('AI service not available:', error)
    }

    return NextResponse.json({ total: 0, entries: [] })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch blacklist' }, { status: 500 })
  }
}

// POST - Add to blacklist
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const payload = await verifyToken(token)
    if (!payload || (payload.role !== 'superadmin' && payload.role !== 'village_admin' && payload.role !== 'admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()

    try {
      const response = await ai.addToBlacklist(body)
      const data = await response.json()
      return NextResponse.json(data, { status: response.ok ? 200 : response.status })
    } catch (error) {
      console.log('AI service not available:', error)
      return NextResponse.json({ error: 'AI service not available' }, { status: 503 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add to blacklist' }, { status: 500 })
  }
}

// DELETE - Remove from blacklist
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const payload = await verifyToken(token)
    if (!payload || (payload.role !== 'superadmin' && payload.role !== 'village_admin' && payload.role !== 'admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const wa_user_id = searchParams.get('wa_user_id')

    if (!wa_user_id) {
      return NextResponse.json({ error: 'wa_user_id required' }, { status: 400 })
    }

    try {
      const response = await ai.removeFromBlacklist(wa_user_id)
      const data = await response.json()
      return NextResponse.json(data, { status: response.ok ? 200 : response.status })
    } catch (error) {
      console.log('AI service not available:', error)
      return NextResponse.json({ error: 'AI service not available' }, { status: 503 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Failed to remove from blacklist' }, { status: 500 })
  }
}
