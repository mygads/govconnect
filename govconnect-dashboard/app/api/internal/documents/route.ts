import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// Internal API for AI service to manage documents
// Uses internal API key for authentication

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getInternalApiKey(): string | null {
  return process.env['INTERNAL_API_KEY'] || null
}

/**
 * GET /api/internal/documents
 * Get all documents for AI service
 */
export async function GET(request: NextRequest) {
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

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '100')
    const villageId = searchParams.get('village_id')

    const where: any = {}
    if (status) where.status = status
    // Filter by village_id for multi-tenancy isolation
    if (villageId) where.village_id = villageId

    const documents = await prisma.knowledge_documents.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
    })

    return NextResponse.json({
      data: documents,
      total: documents.length,
    })
  } catch (error) {
    console.error('Error fetching documents:', error)
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/internal/documents
 * Create a document record (used by AI service after processing)
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const { 
      filename, 
      original_name, 
      mime_type, 
      file_size, 
      file_url,
      title,
      description,
      category,
      status = 'pending'
    } = body

    const document = await prisma.knowledge_documents.create({
      data: {
        filename,
        original_name,
        mime_type,
        file_size,
        file_url,
        title,
        description,
        category,
        status,
      },
    })

    return NextResponse.json({
      success: true,
      data: document,
    })
  } catch (error) {
    console.error('Error creating document:', error)
    return NextResponse.json(
      { error: 'Failed to create document' },
      { status: 500 }
    )
  }
}
