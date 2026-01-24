import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Internal API for AI service to get single knowledge item

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getInternalApiKey(): string | null {
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

/**
 * GET /api/internal/knowledge/[id]
 * Get a single knowledge item by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify internal API key
    const expectedApiKey = normalizeInternalApiKey(getInternalApiKey())
    if (!expectedApiKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }
    const apiKey = getProvidedInternalApiKey(request)
    if (!apiKey || apiKey !== expectedApiKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const knowledge = await prisma.knowledge_base.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        keywords: true,
        is_active: true,
        priority: true,
      },
    })

    if (!knowledge) {
      return NextResponse.json({ error: 'Knowledge not found' }, { status: 404 })
    }

    return NextResponse.json({ data: knowledge })
  } catch (error) {
    console.error('Error fetching knowledge:', error)
    return NextResponse.json(
      { error: 'Failed to fetch knowledge' },
      { status: 500 }
    )
  }
}
