import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getHeaders, ServicePath } from '@/lib/api-client'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'

// GET - Get wa-support-v2 summary (users + local session data + village names)
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session || session.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = buildUrl(ServicePath.CHANNEL, '/internal/wa-support/summary')
    const res = await fetch(url, {
      headers: getHeaders(),
      next: { revalidate: 0 },
    })

    const data = await res.json()

    // Enrich items with village names from dashboard DB
    if (data.success && data.data?.items?.length > 0) {
      const items = data.data.items
      const candidateIds = items.flatMap((item: any) => [
        item.local_session?.village_id,
        item.village_id,
        item.user_id,
        item.id,
      ]).filter(Boolean)

      const [villages, dashboardSessions, channelSessionsResult] = await Promise.allSettled([
        prisma.villages.findMany({
          where: { id: { in: candidateIds } },
          select: { id: true, name: true, slug: true },
        }),
        prisma.genfity_whatsapp_sessions.findMany({
          where: { village_id: { in: candidateIds } },
          select: { village_id: true, session_name: true, status: true, jid: true, connected: true, updated_at: true, created_at: true },
        }),
        prisma.$queryRaw<Array<{
          village_id: string
          instance_name: string | null
          wa_number: string | null
          status: string | null
          wa_support_session_id: string | null
          last_connected_at: Date | null
          created_at: Date | null
        }>>(Prisma.sql`
          select village_id, instance_name, wa_number, status, wa_support_session_id, last_connected_at, created_at
          from channel.wa_sessions
          where village_id = any(${candidateIds})
        `),
      ])

      if (villages.status === 'rejected') {
        throw villages.reason
      }
      if (dashboardSessions.status === 'rejected') {
        throw dashboardSessions.reason
      }

      if (channelSessionsResult.status === 'rejected') {
        console.warn('Channel wa_sessions lookup failed:', channelSessionsResult.reason)
      }

      const villageRows = villages.value
      const dashboardSessionRows = dashboardSessions.value
      const channelSessions = channelSessionsResult.status === 'fulfilled' ? channelSessionsResult.value : []

      const villageMap = new Map(villageRows.map((v) => [v.id, v]))
      const dashboardSessionMap = new Map(dashboardSessionRows.map((s) => [s.village_id, s]))
      const channelSessionMap = new Map((channelSessions as any[]).map((s) => [s.village_id, s]))

      data.data.items = items.map((item: any) => {
        const villageId = item.local_session?.village_id || item.village_id || item.user_id || item.id
        const village = villageMap.get(villageId)
        const dashboardSession = dashboardSessionMap.get(villageId)
        const channelSession = channelSessionMap.get(villageId)
        const localSession = item.local_session || (channelSession ? {
          village_id: channelSession.village_id,
          instance_name: channelSession.instance_name,
          wa_number: channelSession.wa_number,
          status: channelSession.status,
          wa_support_session_id: channelSession.wa_support_session_id,
          last_connected_at: channelSession.last_connected_at,
          created_at: channelSession.created_at,
        } : dashboardSession ? {
          village_id: dashboardSession.village_id,
          instance_name: dashboardSession.session_name,
          wa_number: dashboardSession.jid?.split('@')[0] || null,
          status: dashboardSession.connected ? 'connected' : dashboardSession.status,
          wa_support_session_id: null,
          last_connected_at: dashboardSession.connected ? dashboardSession.updated_at : null,
          created_at: dashboardSession.created_at,
        } : null)

        return {
          ...item,
          local_session: localSession,
          village_name: village?.name || null,
          village_slug: village?.slug || null,
        }
      })
    }

    return NextResponse.json(data, { status: res.status })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
