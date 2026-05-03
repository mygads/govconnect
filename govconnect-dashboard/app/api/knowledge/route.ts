import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { ai } from '@/lib/api-client'

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true }
  })
  if (!session || session.expires_at < new Date()) return null
  return session
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const category = searchParams.get('category')
    const categoryId = searchParams.get('category_id')
    const isActive = searchParams.get('is_active')
    const search = searchParams.get('search')
    const rawLimit = parseInt(searchParams.get('limit') || '50')
    const rawOffset = parseInt(searchParams.get('offset') || '0')
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200)
    const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0)

    const where: any = {}
    if (session.admin.village_id) {
      where.village_id = session.admin.village_id
    }

    if (categoryId) {
      where.category_id = categoryId
    } else if (category) {
      where.category = category
    }

    if (isActive !== null) {
      where.is_active = isActive === 'true'
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
        { keywords: { has: search.toLowerCase() } },
      ]
    }

    const [knowledge, total] = await Promise.all([
      prisma.knowledge_base.findMany({
        where,
        orderBy: [
          { priority: 'desc' },
          { updated_at: 'desc' },
        ],
        take: limit,
        skip: offset,
      }),
      prisma.knowledge_base.count({ where }),
    ])

    let enriched = knowledge

    try {
      const ids = knowledge.map((item) => item.id)
      if (ids.length > 0) {
        const statusResponse = await ai.getKnowledgeStatuses(ids)
        if (statusResponse.ok) {
          const statusJson = await statusResponse.json()
          const statuses = Array.isArray(statusJson.data) ? statusJson.data : []
          const statusMap = new Map<string, { id: string; embedding_model?: string | null; updated_at?: string | Date }>(
            statuses.map((status: { id: string; embedding_model?: string | null; updated_at?: string | Date }) => [
              status.id,
              status,
            ])
          )

          enriched = knowledge.map((item) => {
            const status = statusMap.get(item.id)
            const lastEmbedded = status?.updated_at
            return {
              ...item,
              embedding_model: status?.embedding_model || null,
              last_embedded_at: lastEmbedded ? (typeof lastEmbedded === 'string' ? new Date(lastEmbedded) : lastEmbedded) : null,
            }
          })
        }
      }
    } catch (statusError) {
      console.warn('Failed to fetch embedding status:', statusError)
    }

    return NextResponse.json({
      data: enriched,
      pagination: {
        total,
        limit,
        offset,
      },
    })
  } catch (error) {
    console.error('Error fetching knowledge:', error)
    return NextResponse.json(
      { error: 'Failed to fetch knowledge' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { title, content, category, category_id, keywords, is_active, priority } = body

    if (!title || !content || (!category && !category_id)) {
      return NextResponse.json(
        { error: 'Title, content, dan category wajib diisi' },
        { status: 400 }
      )
    }

    let resolvedCategoryId = category_id as string | undefined
    let resolvedCategoryName = category as string | undefined

    if (!resolvedCategoryId) {
      const existingCategory = await prisma.knowledge_categories.findFirst({
        where: {
          name: category,
          village_id: session.admin.village_id || undefined,
        }
      })

      if (existingCategory) {
        resolvedCategoryId = existingCategory.id
        resolvedCategoryName = existingCategory.name
      } else if (session.admin.village_id) {
        const created = await prisma.knowledge_categories.create({
          data: {
            village_id: session.admin.village_id,
            name: category,
            is_default: false,
          }
        })
        resolvedCategoryId = created.id
        resolvedCategoryName = created.name
      }
    } else {
      const existingCategory = await prisma.knowledge_categories.findUnique({
        where: { id: resolvedCategoryId }
      })
      resolvedCategoryName = existingCategory?.name || resolvedCategoryName
    }

    const processedKeywords = Array.isArray(keywords)
      ? keywords.map((k: string) => k.toLowerCase().trim()).filter(Boolean)
      : []
    const scope = session.admin.role === 'superadmin' && body.scope === 'global' ? 'global' : 'village'
    const isGlobal = scope === 'global'
    if (scope === 'village' && !session.admin.village_id) {
      return NextResponse.json({ error: 'village_id wajib untuk knowledge desa' }, { status: 400 })
    }

    const knowledge = await prisma.knowledge_base.create({
      data: {
        title,
        content,
        category: resolvedCategoryName || category,
        category_id: resolvedCategoryId,
        village_id: isGlobal ? undefined : session.admin.village_id || undefined,
        scope,
        is_global: isGlobal,
        keywords: processedKeywords,
        is_active: is_active ?? true,
        priority: priority ?? 0,
        admin_id: session.admin_id,
        embedding_status: 'pending',
        embedding_error: null,
      },
    })

    return NextResponse.json({
      status: 'success',
      data: knowledge,
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating knowledge:', error)
    return NextResponse.json(
      { error: 'Failed to create knowledge' },
      { status: 500 }
    )
  }
}
