import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedInternalRequest } from '@/lib/internal-api-auth'
import prisma from '@/lib/prisma'
import { resolveVillageTimezone } from '@/lib/utils'

// Internal API for AI service to fetch village profile
// Uses internal API key for authentication

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedInternalRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const villageId = searchParams.get('village_id')

    if (!villageId) {
      return NextResponse.json({ error: 'village_id is required' }, { status: 400 })
    }

    const [village, profile] = await Promise.all([
      prisma.villages.findUnique({
        where: { id: villageId },
        select: { id: true, name: true, slug: true, timezone: true },
      }),
      (prisma.village_profiles as any).findFirst({
        where: { village_id: villageId },
        select: {
          name: true,
          address: true,
          gmaps_url: true,
          latitude: true,
          longitude: true,
          short_name: true,
          operating_hours: true,
        },
      }),
    ])

    if (!village && !profile) {
      return NextResponse.json({ data: null })
    }

    return NextResponse.json({
      data: {
        id: villageId,
        name: village?.name || profile?.name || null,
        slug: village?.slug || null,
        timezone: resolveVillageTimezone(village?.timezone),
        short_name: profile?.short_name || null,
        address: profile?.address || null,
        gmaps_url: profile?.gmaps_url || null,
        latitude: profile?.latitude ?? null,
        longitude: profile?.longitude ?? null,
        operating_hours: profile?.operating_hours || null,
      },
    })
  } catch (error) {
    console.error('Error fetching village profile:', error)
    return NextResponse.json(
      { error: 'Failed to fetch village profile' },
      { status: 500 }
    )
  }
}
