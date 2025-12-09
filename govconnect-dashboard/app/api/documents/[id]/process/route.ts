import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * POST /api/documents/[id]/process
 * Re-trigger document processing
 * Note: Processing is now done automatically on upload via AI service
 * This endpoint is for re-processing failed documents
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

    // For re-processing, we need to re-upload the file to AI service
    // Since file is now stored in AI service, we just return info
    return NextResponse.json({
      success: false,
      error: 'Re-processing not supported. Please delete and re-upload the document.',
      hint: 'Documents are now processed automatically on upload by AI service.',
    }, { status: 400 })
  } catch (error: any) {
    console.error('Error processing document:', error)
    return NextResponse.json(
      { error: 'Failed to process document', details: error.message },
      { status: 500 }
    )
  }
}
