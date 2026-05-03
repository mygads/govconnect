import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { deleteKnowledgeVector } from '@/lib/ai-service'

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

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params

    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const knowledge = await prisma.knowledge_base.findUnique({
      where: { id },
    })

    if (!knowledge) {
      return NextResponse.json({ error: 'Knowledge not found' }, { status: 404 })
    }

    if (session.admin.village_id && knowledge.village_id !== session.admin.village_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json({
      data: knowledge,
    })
  } catch (error) {
    console.error('Error fetching knowledge:', error)
    return NextResponse.json(
      { error: 'Failed to fetch knowledge' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params

    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { title, content, category, category_id, keywords, is_active, priority } = body

    const existing = await prisma.knowledge_base.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Knowledge not found' }, { status: 404 })
    }

    if (session.admin.village_id && existing.village_id !== session.admin.village_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let resolvedCategoryId = category_id as string | undefined
    let resolvedCategoryName = category as string | undefined

    if (!resolvedCategoryId && category) {
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
    } else if (resolvedCategoryId) {
      const categoryRef = await prisma.knowledge_categories.findUnique({
        where: { id: resolvedCategoryId }
      })
      resolvedCategoryName = categoryRef?.name || resolvedCategoryName
    }

    const processedKeywords = keywords
      ? keywords.map((k: string) => k.toLowerCase().trim()).filter(Boolean)
      : undefined

    const resolvedTitle = title ?? existing.title
    const resolvedContent = content ?? existing.content
    const resolvedCategory = resolvedCategoryName ?? existing.category
    const resolvedCategoryIdFinal = resolvedCategoryId ?? existing.category_id ?? undefined
    const resolvedKeywords = processedKeywords ?? existing.keywords
    const resolvedScope = session.admin.role === 'superadmin' && body.scope === 'global' ? 'global' : existing.scope || 'village'
    const resolvedIsGlobal = resolvedScope === 'global'
    if (resolvedScope === 'village' && !existing.village_id && !session.admin.village_id) {
      return NextResponse.json({ error: 'village_id wajib untuk knowledge desa' }, { status: 400 })
    }

    const hasEmbeddingChanges =
      resolvedTitle !== existing.title ||
      resolvedContent !== existing.content ||
      resolvedCategory !== existing.category ||
      resolvedCategoryIdFinal !== existing.category_id ||
      JSON.stringify(resolvedKeywords ?? []) !== JSON.stringify(existing.keywords ?? [])

    const knowledge = await prisma.knowledge_base.update({
      where: { id },
      data: {
        title: resolvedTitle,
        content: resolvedContent,
        category: resolvedCategory,
        category_id: resolvedCategoryIdFinal,
        village_id: resolvedIsGlobal ? null : existing.village_id || session.admin.village_id,
        scope: resolvedScope,
        is_global: resolvedIsGlobal,
        keywords: resolvedKeywords,
        ...(is_active !== undefined && { is_active }),
        ...(priority !== undefined && { priority }),
        ...(hasEmbeddingChanges && {
          embedding_status: 'pending',
          embedding_error: null,
        }),
        admin_id: session.admin_id,
      },
    })

    return NextResponse.json({
      status: 'success',
      data: knowledge,
    })
  } catch (error) {
    console.error('Error updating knowledge:', error)
    return NextResponse.json(
      { error: 'Failed to update knowledge' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params

    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const existing = await prisma.knowledge_base.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Knowledge not found' }, { status: 404 })
    }

    if (session.admin.village_id && existing.village_id !== session.admin.village_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma.knowledge_base.delete({
      where: { id },
    })

    deleteKnowledgeVector(id).catch(err => {
      console.error('Failed to delete knowledge from AI Service:', err)
    })

    return NextResponse.json({
      status: 'success',
      message: 'Knowledge deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting knowledge:', error)
    return NextResponse.json(
      { error: 'Failed to delete knowledge' },
      { status: 500 }
    )
  }
}
