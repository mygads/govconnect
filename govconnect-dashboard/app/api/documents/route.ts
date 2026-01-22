import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { ai } from '@/lib/api-client'
import { randomUUID } from 'crypto'

// Force Node.js runtime for file uploads
export const runtime = 'nodejs'

// Disable body parsing - we handle formData manually
export const dynamic = 'force-dynamic'

/**
 * GET /api/documents
 * List all knowledge files
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const village_id = searchParams.get('village_id')
    const category_id = searchParams.get('category_id')
    const is_processed = searchParams.get('is_processed')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    const where: any = {}
    if (village_id) where.village_id = village_id
    if (category_id) where.category_id = category_id
    if (is_processed !== null && is_processed !== undefined) {
      where.is_processed = is_processed === 'true'
    }

    const [documents, total] = await Promise.all([
      prisma.knowledge_files.findMany({
        where,
        include: {
          category: true
        },
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.knowledge_files.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: documents,
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Error fetching documents:', error)
    return NextResponse.json(
      { error: 'Gagal mengambil dokumen' },
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
    const village_id = formData.get('village_id') as string | null
    const category_id = formData.get('category_id') as string | null
    const title = formData.get('title') as string | null
    const description = formData.get('description') as string | null

    if (!file) {
      return NextResponse.json(
        { error: 'File tidak ditemukan' },
        { status: 400 }
      )
    }

    if (!village_id || !category_id) {
      return NextResponse.json(
        { error: 'village_id dan category_id harus diisi' },
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
        { error: `Tipe file tidak didukung. Diizinkan: PDF, DOCX, DOC, TXT, MD, CSV` },
        { status: 400 }
      )
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File terlalu besar. Maksimal 10MB' },
        { status: 400 }
      )
    }

    // Generate document ID
    const documentId = randomUUID()
    const extension = getExtension(file.name)
    const filename = `${documentId}.${extension}`
    
    // Create database record first (pending status)
    const document = await prisma.knowledge_files.create({
      data: {
        id: documentId,
        village_id,
        category_id,
        filename,
        original_name: file.name,
        mime_type: file.type,
        file_size: file.size,
        file_path: `/uploads/documents/${filename}`,
        title: title || file.name.replace(/\.[^/.]+$/, ''),
        description,
        is_processed: false,
      },
    })

    // Forward file to AI service for processing
    const aiFormData = new FormData()
    aiFormData.append('file', file)
    aiFormData.append('documentId', documentId)
    aiFormData.append('villageId', village_id)
    if (title) aiFormData.append('title', title)

    try {
      const aiResponse = await ai.uploadDocument(aiFormData)
      
      if (!aiResponse.ok) {
        const errorData = await aiResponse.json()
        
        // Update status to failed
        await prisma.knowledge_files.update({
          where: { id: documentId },
          data: {
            is_processed: false,
            error_message: errorData.error || errorData.details || 'AI processing failed',
          },
        })
        
        return NextResponse.json({
          success: false,
          data: document,
          error: errorData.error || 'Gagal memproses di AI service',
        }, { status: 500 })
      }

      const result = await aiResponse.json()
      
      // Update document with success status
      const updatedDoc = await prisma.knowledge_files.update({
        where: { id: documentId },
        data: {
          is_processed: true,
          total_chunks: result.chunksCount || 0,
          processed_content: result.textContent || null,
        },
      })

      return NextResponse.json({
        success: true,
        data: updatedDoc,
        chunksCount: result.chunksCount,
        message: 'Dokumen berhasil diupload dan diproses.',
      })
    } catch (aiError: any) {
      console.error('AI service error:', aiError)
      
      // Update status to failed
      await prisma.knowledge_files.update({
        where: { id: documentId },
        data: {
          is_processed: false,
          error_message: aiError.message || 'Gagal koneksi ke AI service',
        },
      })
      
      return NextResponse.json({
        success: false,
        data: document,
        error: 'Gagal memproses dokumen: ' + (aiError.message || 'AI service tidak tersedia'),
      }, { status: 500 })
    }
  } catch (error: any) {
    console.error('Error uploading document:', error)
    return NextResponse.json(
      { error: 'Gagal upload dokumen', details: error.message },
      { status: 500 }
    )
  }
}

function getExtension(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'txt'
}
