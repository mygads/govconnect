import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { updateKnowledgeVector, deleteKnowledgeVector } from '@/lib/ai-service'

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

    // Check if knowledge exists
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

    // Process keywords if provided
    const processedKeywords = keywords 
      ? keywords.map((k: string) => k.toLowerCase().trim()).filter(Boolean)
      : undefined

    // Update knowledge entry
    const knowledge = await prisma.knowledge_base.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(content && { content }),
        ...(resolvedCategoryName && { category: resolvedCategoryName }),
        ...(resolvedCategoryId && { category_id: resolvedCategoryId }),
        ...(processedKeywords && { keywords: processedKeywords }),
        ...(is_active !== undefined && { is_active }),
        ...(priority !== undefined && { priority }),
        admin_id: session.admin_id,
      },
    })

    // Sync to AI Service - re-embed with new content
    updateKnowledgeVector(id, {
      title: knowledge.title,
      content: knowledge.content,
      category: knowledge.category,
      keywords: knowledge.keywords,
    }).catch(err => {
      console.error('Failed to sync knowledge update to AI Service:', err)
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
    
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if knowledge exists
    const existing = await prisma.knowledge_base.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Knowledge not found' }, { status: 404 })
    }

    if (session.admin.village_id && existing.village_id !== session.admin.village_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete knowledge entry
    await prisma.knowledge_base.delete({
      where: { id },
    })

    // Delete from AI Service vector database
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
