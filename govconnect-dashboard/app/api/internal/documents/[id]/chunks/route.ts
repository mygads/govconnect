import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Internal API for AI service to get document chunks

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getInternalApiKey(): string | null {
  return process.env['INTERNAL_API_KEY'] || null
}

/**
 * GET /api/internal/documents/[id]/chunks
 * Get all chunks for a document
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify internal API key
    const expectedApiKey = getInternalApiKey()
    if (!expectedApiKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }
    const apiKey = request.headers.get('x-internal-api-key')
    if (!apiKey || apiKey !== expectedApiKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: documentId } = await params

    // Get document info
    const document = await prisma.knowledge_documents.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        category: true,
      },
    })

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Get chunks
    const chunks = await prisma.document_chunks.findMany({
      where: { document_id: documentId },
      orderBy: { chunk_index: 'asc' },
      select: {
        id: true,
        chunk_index: true,
        content: true,
        page_number: true,
        section_title: true,
      },
    })

    return NextResponse.json({
      document,
      chunks,
      total: chunks.length,
    })
  } catch (error) {
    console.error('Error fetching document chunks:', error)
    return NextResponse.json(
      { error: 'Failed to fetch document chunks' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/internal/documents/[id]/chunks
 * Save document chunks (called by AI service after chunking)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify internal API key
    const apiKey = request.headers.get('x-internal-api-key')
    if (!apiKey || apiKey !== getInternalApiKey()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: documentId } = await params
    const body = await request.json()
    const { chunks } = body

    if (!chunks || !Array.isArray(chunks)) {
      return NextResponse.json(
        { error: 'chunks array is required' },
        { status: 400 }
      )
    }

    // Delete existing chunks
    await prisma.document_chunks.deleteMany({
      where: { document_id: documentId },
    })

    // Create new chunks
    await prisma.document_chunks.createMany({
      data: chunks.map((chunk: any, idx: number) => ({
        document_id: documentId,
        chunk_index: chunk.chunkIndex ?? idx,
        content: chunk.content,
        page_number: chunk.pageNumber,
        section_title: chunk.sectionTitle,
      })),
    })

    return NextResponse.json({
      success: true,
      chunksCreated: chunks.length,
    })
  } catch (error) {
    console.error('Error saving document chunks:', error)
    return NextResponse.json(
      { error: 'Failed to save document chunks' },
      { status: 500 }
    )
  }
}
