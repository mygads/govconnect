import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { ai } from '@/lib/api-client'
import { verifyToken } from '@/lib/auth'
import { resolveVillageKnowledgeCategory } from '@/lib/knowledge-categories'

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

/**
 * GET /api/documents/[id]
 * Get a specific document
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const document = await prisma.knowledge_documents.findUnique({
      where: { id },
    })

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }

    if (session.admin.village_id && document.village_id !== session.admin.village_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json({
      data: {
        ...document,
        chunks_count: document.total_chunks || 0,
      },
    })
  } catch (error) {
    console.error('Error fetching document:', error)
    return NextResponse.json(
      { error: 'Failed to fetch document' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/documents/[id]
 * Update document metadata + KB review-gate lifecycle (§5.2).
 *
 * Lifecycle fields:
 * - publish_status: 'draft' | 'published' | 'withdrawn'
 *   (never 'superseded' directly — that state is set via supersede_document_ids)
 * - review_due_at: ISO date for re-review scheduling
 * - supersede_document_ids: document ids whose vectors become 'superseded'
 *   when this one is published
 * - version: immutable once set (rejected with 400 on change)
 *
 * publish/withdraw propagates to the AI service so retrieval sees the new
 * state immediately. The vector flip is authoritative: if the AI-service sync
 * fails, the request fails (no silent divergence between UI and retrieval).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const {
      title, description, category, category_id,
      publish_status, review_due_at, supersede_document_ids, version,
    } = body

    const existing = await prisma.knowledge_documents.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }

    if (session.admin.village_id && existing.village_id !== session.admin.village_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // version is immutable once set
    if (version !== undefined && version !== existing.version) {
      return NextResponse.json(
        { error: 'version is immutable; create a new document version instead' },
        { status: 400 }
      )
    }

    const allowedPublishStatus = ['draft', 'published', 'withdrawn']
    if (publish_status !== undefined && !allowedPublishStatus.includes(publish_status)) {
      return NextResponse.json(
        { error: `publish_status must be one of: ${allowedPublishStatus.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate supersede targets belong to the same village (tenant safety)
    const supersedeIds: string[] = Array.isArray(supersede_document_ids)
      ? [...new Set(supersede_document_ids.map(String))].filter((s) => s && s !== id)
      : []
    if (publish_status === 'published' && supersedeIds.length > 0) {
      const targets = await prisma.knowledge_documents.findMany({
        where: { id: { in: supersedeIds } },
        select: { id: true, village_id: true },
      })
      const foreign = targets.filter((t) => t.village_id !== existing.village_id)
      if (foreign.length > 0 || targets.length !== supersedeIds.length) {
        return NextResponse.json(
          { error: 'supersede_document_ids must reference existing documents in the same village' },
          { status: 400 }
        )
      }
      // Mirror superseded state on the replaced rows too — done by the AI
      // service via /internal/documents (it flips both vectors and dashboard
      // rows), so no separate dashboard write here: if the AI sync below
      // fails we fail closed with zero dashboard writes.
    }

    const resolvedCategory = await resolveVillageKnowledgeCategory({
      villageId: existing.village_id || session.admin.village_id,
      categoryId: category_id,
      categoryName: category,
      createIfMissing: true,
    })
    const resolvedCategoryId = resolvedCategory.categoryId
    const resolvedCategoryName = resolvedCategory.categoryName

    const data: Record<string, unknown> = {
      updated_at: new Date(),
    }
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description
    if (resolvedCategoryName || category) data.category = resolvedCategoryName || category
    if (resolvedCategoryId) data.category_id = resolvedCategoryId
    if (publish_status !== undefined) data.publish_status = publish_status
    if (review_due_at !== undefined) {
      data.review_due_at = review_due_at ? new Date(review_due_at) : null
    }

    // Propagate review-state changes to the AI service FIRST so that the
    // vector state (what retrieval actually serves) never diverges from the
    // dashboard row. Fail closed on propagation errors.
    if (publish_status !== undefined && publish_status !== existing.publish_status) {
      const resp = await ai.setDocumentPublishStatus(
        id,
        publish_status as 'draft' | 'published' | 'withdrawn',
        publish_status === 'published' ? supersedeIds : [],
      )
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}))
        return NextResponse.json(
          { error: 'Failed to sync document publish status with AI service', details: detail },
          { status: 502 }
        )
      }
    }

    const document = await prisma.knowledge_documents.update({
      where: { id },
      data,
    })

    return NextResponse.json({
      success: true,
      data: document,
    })
  } catch (error) {
    console.error('Error updating document:', error)
    return NextResponse.json(
      { error: 'Failed to update document' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/documents/[id]
 * Delete a document and its vectors from AI service
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Get document
    const document = await prisma.knowledge_documents.findUnique({
      where: { id },
    })

    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }

    if (session.admin.village_id && document.village_id !== session.admin.village_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete vectors from AI Service first
    try {
      await ai.deleteDocumentVectors(id)
    } catch (err) {
      console.error('Failed to delete document vectors from AI Service:', err)
      // Continue with deletion even if AI service fails
    }

    // Delete document record from database
    await prisma.knowledge_documents.delete({
      where: { id },
    })

    return NextResponse.json({
      success: true,
      message: 'Document deleted successfully',
    })
  } catch (error: any) {
    console.error('Error deleting document:', error)
    return NextResponse.json(
      { error: 'Failed to delete document', details: error.message },
      { status: 500 }
    )
  }
}
