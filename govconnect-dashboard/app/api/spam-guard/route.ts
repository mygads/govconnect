import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { ai } from '@/lib/api-client'

// GET - Get spam guard stats and bans
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

    // Fetch from both AI service (stats) and Channel service (bans)
    const [statsRes, bansRes] = await Promise.allSettled([
      ai.getSpamGuardStats(),
      ai.getSpamGuardBans(),
    ])

    const stats = statsRes.status === 'fulfilled' && statsRes.value.ok
      ? await statsRes.value.json()
      : { enabled: false, maxIdentical: 5, banDurationMs: 60000, activeTrackers: 0, activeBans: 0, supersededMessages: 0, bans: [] }

    const bans = bansRes.status === 'fulfilled' && bansRes.value.ok
      ? await bansRes.value.json()
      : { total: 0, bans: [] }

    return NextResponse.json({
      stats,
      channelBans: bans,
    })
  } catch (error) {
    console.error('Error fetching spam guard data:', error)
    return NextResponse.json({ error: 'Failed to fetch spam guard data' }, { status: 500 })
  }
}

// DELETE - Remove a spam ban
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
    const village_id = searchParams.get('village_id')

    if (!wa_user_id) {
      return NextResponse.json({ error: 'wa_user_id required' }, { status: 400 })
    }

    try {
      const response = await ai.removeSpamBan(wa_user_id, village_id || undefined)
      const data = await response.json()
      return NextResponse.json(data, { status: response.ok ? 200 : response.status })
    } catch (error) {
      console.log('Channel service not available:', error)
      return NextResponse.json({ error: 'Channel service not available' }, { status: 503 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Failed to remove spam ban' }, { status: 500 })
  }
}
