import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { ai } from '@/lib/api-client'
import { AuditActions, logAdminAction } from '@/lib/audit'

// GET - Get blacklist
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const villageId = resolveVillageId(request, session)
    const response = await ai.getBlacklist(villageId)
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      return NextResponse.json(
        data || { error: 'Failed to fetch blacklist from AI service', code: 'UPSTREAM_UNAVAILABLE' },
        { status: response.status },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch blacklist' }, { status: 500 })
  }
}

// POST - Add to blacklist
export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const villageId = session.role === 'superadmin' ? body.village_id : session.villageId
    if (session.role !== 'superadmin' && !villageId) {
      return NextResponse.json({ error: 'village_id required' }, { status: 400 })
    }
    body.village_id = villageId || undefined

    try {
      const response = await ai.addToBlacklist(body)
      const data = await response.json()
      if (response.ok) {
        await logAdminAction({
          adminId: session.adminId,
          action: AuditActions.BLACKLIST_USER,
          resource: `rate-limit:blacklist:${body.wa_user_id}`,
          details: { wa_user_id: body.wa_user_id, reason: body.reason },
          ipAddress: request.headers.get('x-forwarded-for'),
        })
      }
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
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const wa_user_id = searchParams.get('wa_user_id')
    const villageId = session.role === 'superadmin' ? searchParams.get('village_id') : session.villageId

    if (!wa_user_id) {
      return NextResponse.json({ error: 'wa_user_id required' }, { status: 400 })
    }

    try {
      const response = await ai.removeFromBlacklist(wa_user_id, villageId)
      const data = await response.json()
      if (response.ok) {
        await logAdminAction({
          adminId: session.adminId,
          action: AuditActions.UNBAN_USER,
          resource: `rate-limit:blacklist:${wa_user_id}`,
          details: { wa_user_id },
          ipAddress: request.headers.get('x-forwarded-for'),
        })
      }
      return NextResponse.json(data, { status: response.ok ? 200 : response.status })
    } catch (error) {
      console.log('AI service not available:', error)
      return NextResponse.json({ error: 'AI service not available' }, { status: 503 })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Failed to remove from blacklist' }, { status: 500 })
  }
}
