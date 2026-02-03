import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Internal API for AI service to fetch village profile
// Uses internal API key for authentication

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getInternalApiKey(): string | null {
  // Use bracket access so Next standalone build doesn't inline at build-time.
  return process.env['INTERNAL_API_KEY'] || null
}

function normalizeInternalApiKey(value: string | null): string | null {
  if (!value) return null
  let key = value.trim()
  if (key.toLowerCase().startsWith('bearer ')) {
    key = key.slice('bearer '.length).trim()
  }
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim()
  }
  return key.length > 0 ? key : null
}

function getProvidedInternalApiKey(request: NextRequest): string | null {
  return (
    normalizeInternalApiKey(request.headers.get('x-internal-api-key')) ||
    normalizeInternalApiKey(request.headers.get('authorization'))
  )
}

export async function GET(request: NextRequest) {
  try {
    const expectedApiKey = normalizeInternalApiKey(getInternalApiKey())
    const apiKey = getProvidedInternalApiKey(request)

    if (!expectedApiKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }
    if (!apiKey || apiKey !== expectedApiKey) {
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
        select: { id: true, name: true, slug: true },
      }),
      prisma.village_profiles.findFirst({
        where: { village_id: villageId },
        select: {
          name: true,
          address: true,
          gmaps_url: true,
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
        name: profile?.name || village?.name || null,
        short_name: village?.slug || profile?.short_name || null, // Prioritize village.slug for form URLs
        address: profile?.address || null,
        gmaps_url: profile?.gmaps_url || null,
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
