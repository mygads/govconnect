import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { ai } from '@/lib/api-client'
import { randomUUID } from 'crypto'

// Force Node.js runtime for file uploads
export const runtime = 'nodejs'

// Disable body parsing - we handle formData manually
export const dynamic = 'force-dynamic'

// Document upload and management API
// Requires admin authentication

/**
 * GET /api/documents
 * List all knowledge documents
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const category = searchParams.get('category')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    const where: any = {}
    if (status) where.status = status
    if (category) where.category = category

    const [documents, total] = await Promise.all([
      prisma.knowledge_documents.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.knowledge_documents.count({ where }),
    ])

    return NextResponse.json({
      data: documents,
      total,
      limit,
      offset,
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
 * POST /api/documents
 * Upload a new document - forwards to AI service for processing
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const title = formData.get('title') as string | null
    const description = formData.get('description') as string | null
    const category = formData.get('category') as string | null

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
      'text/markdown',
      'text/csv',
    ]

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `File type not supported. Allowed: PDF, DOCX, DOC, TXT, MD, CSV` },
        { status: 400 }
      )
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB' },
        { status: 400 }
      )
    }

    // Generate document ID
    const documentId = randomUUID()
    
    // Create database record first (pending status)
    const document = await prisma.knowledge_documents.create({
      data: {
        id: documentId,
        filename: `${documentId}.${getExtension(file.name)}`,
        original_name: file.name,
        mime_type: file.type,
        file_size: file.size,
        file_url: '', // Will be updated by AI service
        title: title || file.name.replace(/\.[^/.]+$/, ''),
        description,
        category,
        status: 'processing',
      },
    })

    // Forward file to AI service for processing
    const aiFormData = new FormData()
    aiFormData.append('file', file)
    aiFormData.append('documentId', documentId)
    if (title) aiFormData.append('title', title)
    if (category) aiFormData.append('category', category)

    try {
      const aiResponse = await ai.uploadDocument(aiFormData)
      
      if (!aiResponse.ok) {
        const errorData = await aiResponse.json()
        
        // Update status to failed
        await prisma.knowledge_documents.update({
          where: { id: documentId },
          data: {
            status: 'failed',
            error_message: errorData.error || errorData.details || 'AI processing failed',
          },
        })
        
        return NextResponse.json({
          success: false,
          data: document,
          error: errorData.error || 'AI processing failed',
        }, { status: 500 })
      }

      const result = await aiResponse.json()
      
      // Update document with success status
      const updatedDoc = await prisma.knowledge_documents.update({
        where: { id: documentId },
        data: {
          status: 'completed',
          total_chunks: result.chunksCount || 0,
          file_url: result.filename || '',
        },
      })

      return NextResponse.json({
        success: true,
        data: updatedDoc,
        chunksCount: result.chunksCount,
        message: 'Document uploaded and processed successfully.',
      })
    } catch (aiError: any) {
      console.error('AI service error:', aiError)
      
      // Update status to failed
      await prisma.knowledge_documents.update({
        where: { id: documentId },
        data: {
          status: 'failed',
          error_message: aiError.message || 'Failed to connect to AI service',
        },
      })
      
      return NextResponse.json({
        success: false,
        data: document,
        error: 'Failed to process document: ' + (aiError.message || 'AI service unavailable'),
      }, { status: 500 })
    }
  } catch (error: any) {
    console.error('Error uploading document:', error)
    return NextResponse.json(
      { error: 'Failed to upload document', details: error.message },
      { status: 500 }
    )
  }
}

function getExtension(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'txt'
}
