import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
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
    // TODO: Add auth check
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
 * Upload a new document
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

    // Generate unique filename
    const ext = getExtension(file.name)
    const filename = `${randomUUID()}.${ext}`
    
    // Create uploads directory if not exists
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'documents')
    await mkdir(uploadDir, { recursive: true })
    
    // Save file
    const filePath = path.join(uploadDir, filename)
    const bytes = await file.arrayBuffer()
    await writeFile(filePath, Buffer.from(bytes))
    
    // Create database record
    const document = await prisma.knowledge_documents.create({
      data: {
        filename,
        original_name: file.name,
        mime_type: file.type,
        file_size: file.size,
        file_url: `/uploads/documents/${filename}`,
        title: title || file.name.replace(/\.[^/.]+$/, ''), // Remove extension
        description,
        category,
        status: 'pending',
      },
    })

    return NextResponse.json({
      success: true,
      data: document,
      message: 'Document uploaded successfully. Processing will start shortly.',
    })
  } catch (error) {
    console.error('Error uploading document:', error)
    return NextResponse.json(
      { error: 'Failed to upload document' },
      { status: 500 }
    )
  }
}

function getExtension(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'txt'
}
