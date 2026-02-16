import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getHeaders, ServicePath } from '@/lib/api-client'
import prisma from '@/lib/prisma'

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
      const villageIds = data.data.items
        .map((item: any) => item.local_session?.village_id || item.id)
        .filter(Boolean)

      const villages = await prisma.villages.findMany({
        where: { id: { in: villageIds } },
        select: { id: true, name: true, slug: true },
      })

      const villageMap = new Map(villages.map((v) => [v.id, v]))

      data.data.items = data.data.items.map((item: any) => {
        const villageId = item.local_session?.village_id || item.id
        const village = villageMap.get(villageId)
        return {
          ...item,
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
