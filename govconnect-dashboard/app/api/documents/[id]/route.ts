import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { ai } from '@/lib/api-client'

/**
 * GET /api/documents/[id]
 * Get a specific document
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
 * Update document metadata
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { title, description, category } = body

    const document = await prisma.knowledge_documents.update({
      where: { id },
      data: {
        title,
        description,
        category,
        updated_at: new Date(),
      },
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
