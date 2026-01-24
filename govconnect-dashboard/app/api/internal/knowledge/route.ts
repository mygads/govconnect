import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Internal API for AI service to query knowledge base
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
    // Verify internal API key
    const expectedApiKey = normalizeInternalApiKey(getInternalApiKey())
    const apiKey = getProvidedInternalApiKey(request)
    
    // Debug logging
    console.log('[Internal API] Expected key exists:', !!expectedApiKey)
    console.log('[Internal API] Provided key exists:', !!apiKey)
    console.log('[Internal API] Keys match:', apiKey === expectedApiKey)
    
    if (!expectedApiKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }
    if (!apiKey || apiKey !== expectedApiKey) {
      return NextResponse.json({ error: 'Unauthorized', debug: { expectedExists: !!expectedApiKey, providedExists: !!apiKey } }, { status: 401 })
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('query') // Search query from user message
    const category = searchParams.get('category')
    const categoryId = searchParams.get('category_id')
    const villageId = searchParams.get('village_id')
    const limit = parseInt(searchParams.get('limit') || '5')

    // Build where clause - only get active knowledge
    const where: any = {
      is_active: true,
    }

    if (villageId) {
      where.village_id = villageId
    }

    if (categoryId) {
      where.category_id = categoryId
    } else if (category) {
      where.category = category
    }

    // If query provided, do a relevance search
    if (query) {
      const queryWords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2)
      
      if (queryWords.length > 0) {
        where.OR = [
          // Match in title
          ...queryWords.map((word: string) => ({
            title: { contains: word, mode: 'insensitive' as const },
          })),
          // Match in content
          ...queryWords.map((word: string) => ({
            content: { contains: word, mode: 'insensitive' as const },
          })),
          // Match in keywords array
          ...queryWords.map((word: string) => ({
            keywords: { has: word },
          })),
        ]
      }
    }

    // Get matching knowledge entries
    const knowledge = await prisma.knowledge_base.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { updated_at: 'desc' },
      ],
      take: limit,
      select: {
        id: true,
        village_id: true,
        title: true,
        content: true,
        category: true,
        keywords: true,
      },
    })

    // Format for AI consumption
    const formattedKnowledge = knowledge.map((k: { id: string; village_id: string | null; title: string; content: string; category: string; keywords: string[] }) => ({
      id: k.id,
      village_id: k.village_id,
      title: k.title,
      content: k.content,
      category: k.category,
      keywords: k.keywords,
    }))

    return NextResponse.json({
      data: formattedKnowledge,
      total: knowledge.length,
    })
  } catch (error) {
    console.error('Error querying knowledge:', error)
    return NextResponse.json(
      { error: 'Failed to query knowledge' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const { query, categories, category_ids, limit = 5, village_id } = body

    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      )
    }

    // Extract keywords from query
    const queryWords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2)

    // Build where clause
    const where: any = {
      is_active: true,
    }

    if (village_id) {
      where.village_id = village_id
    }

    if (Array.isArray(category_ids) && category_ids.length > 0) {
      where.category_id = { in: category_ids }
    } else if (categories && Array.isArray(categories) && categories.length > 0) {
      where.category = { in: categories }
    }

    if (queryWords.length > 0) {
      where.OR = [
        // Match in title
        ...queryWords.map((word: string) => ({
          title: { contains: word, mode: 'insensitive' as const },
        })),
        // Match in content
        ...queryWords.map((word: string) => ({
          content: { contains: word, mode: 'insensitive' as const },
        })),
        // Match in keywords array
        ...queryWords.map((word: string) => ({
          keywords: { has: word },
        })),
      ]
    }

    // Get matching knowledge entries
    const knowledge = await prisma.knowledge_base.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { updated_at: 'desc' },
      ],
      take: limit,
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        keywords: true,
      },
    })

    // Build context string for AI
    let contextString = ''
    if (knowledge.length > 0) {
      contextString = knowledge.map((k: { category: string; title: string; content: string }) => 
        `[${k.category.toUpperCase()}] ${k.title}\n${k.content}`
      ).join('\n\n---\n\n')
    }

    return NextResponse.json({
      data: knowledge,
      total: knowledge.length,
      context: contextString, // Ready-to-use context for AI prompt
    })
  } catch (error) {
    console.error('Error searching knowledge:', error)
    return NextResponse.json(
      { error: 'Failed to search knowledge' },
      { status: 500 }
    )
  }
}
