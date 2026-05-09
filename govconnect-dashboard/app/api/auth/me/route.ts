import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const [session, authError] = await requireAuth(request)
    if (authError) return authError

    let village_timezone: string | null = null

    if (session.villageId) {
      const village = await prisma.villages.findUnique({
        where: { id: session.villageId },
        select: { timezone: true },
      })
      village_timezone = village?.timezone || null
    }

    return NextResponse.json({
      user: {
        id: session.adminId,
        username: session.username,
        name: session.name,
        role: session.role,
        village_id: session.villageId,
        village_timezone,
      }
    })
  } catch (error) {
    console.error('Auth check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
