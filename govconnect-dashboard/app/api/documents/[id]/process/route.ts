import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { readFile } from 'fs/promises'
import path from 'path'
import { ai } from '@/lib/api-client'

/**
 * POST /api/documents/[id]/process
 * Trigger document processing (chunking and embedding)
 * This calls the AI service to process the document
 */
export async function POST(
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

    // Update status to processing
    await prisma.knowledge_documents.update({
      where: { id },
      data: {
        status: 'processing',
        error_message: null,
      },
    })

    // Read file content based on type
    let content = ''
    const filePath = path.join(process.cwd(), 'public', document.file_url)

    try {
      if (document.mime_type === 'text/plain' || 
          document.mime_type === 'text/markdown' ||
          document.mime_type === 'text/csv') {
        // Read text files directly
        content = await readFile(filePath, 'utf-8')
      } else if (document.mime_type === 'application/pdf') {
        // For PDF, we need pdf-parse library
        // For now, return error - PDF parsing should be done in AI service
        content = '[PDF_CONTENT_PLACEHOLDER]'
      } else if (document.mime_type.includes('wordprocessingml') || 
                 document.mime_type === 'application/msword') {
        // For DOCX/DOC, we need mammoth or similar library
        content = '[DOCX_CONTENT_PLACEHOLDER]'
      }
    } catch (e) {
      console.error('Error reading file:', e)
      await prisma.knowledge_documents.update({
        where: { id },
        data: {
          status: 'failed',
          error_message: 'Failed to read file content',
        },
      })
      return NextResponse.json(
        { error: 'Failed to read file content' },
        { status: 500 }
      )
    }

    // Call AI service to process document
    // The AI service will chunk the text and generate embeddings
    try {
      const response = await ai.processDocument({
        documentId: id,
        content,
        mimeType: document.mime_type,
        title: document.title || 'Untitled',
        category: document.category || 'general',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'AI service processing failed')
      }

      const result = await response.json()

      return NextResponse.json({
        success: true,
        message: 'Document processing started',
        chunksCount: result.chunksCount,
      })
    } catch (aiError: any) {
      console.error('AI service error:', aiError)
      
      // Update status to failed
      await prisma.knowledge_documents.update({
        where: { id },
        data: {
          status: 'failed',
          error_message: aiError.message || 'AI processing failed',
        },
      })

      return NextResponse.json(
        { error: 'Document processing failed', details: aiError.message },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Error processing document:', error)
    return NextResponse.json(
      { error: 'Failed to process document' },
      { status: 500 }
    )
  }
}
