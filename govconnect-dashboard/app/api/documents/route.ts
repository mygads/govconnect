import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { ai } from '@/lib/api-client'
import { randomUUID, createHash } from 'crypto'
import { verifyToken } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_DOCUMENT_SIZE_BYTES = Number(process.env.KNOWLEDGE_MAX_FILE_BYTES || 10 * 1024 * 1024)
const MAX_UPLOADS_PER_VILLAGE_PER_DAY = Number(process.env.KNOWLEDGE_MAX_UPLOADS_PER_VILLAGE_PER_DAY || 50)
const MAX_DOCUMENTS_PER_VILLAGE = Number(process.env.KNOWLEDGE_MAX_DOCUMENTS_PER_VILLAGE || 500)
const MAX_DOCUMENT_BYTES_PER_VILLAGE = Number(process.env.KNOWLEDGE_MAX_DOCUMENT_BYTES_PER_VILLAGE || 250 * 1024 * 1024)

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

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const category = searchParams.get('category')
    const categoryId = searchParams.get('category_id')
    const search = searchParams.get('search')
    const rawLimit = parseInt(searchParams.get('limit') || '50')
    const rawOffset = parseInt(searchParams.get('offset') || '0')
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 200)
    const offset = Math.max(isNaN(rawOffset) ? 0 : rawOffset, 0)

    const where: any = {}
    if (session.admin.village_id) {
      where.village_id = session.admin.village_id
    }
    if (status) where.status = status
    if (categoryId) {
      where.category_id = categoryId
    } else if (category) {
      where.category = category
    }
    if (search?.trim()) {
      const query = search.trim()
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { original_name: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { category: { contains: query, mode: 'insensitive' } },
      ]
    }

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

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const title = formData.get('title') as string | null
    const description = formData.get('description') as string | null
    const category = formData.get('category') as string | null
    const categoryId = formData.get('category_id') as string | null

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'text/plain',
      'text/markdown',
      'text/csv',
    ]

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `File type not supported. Allowed: PDF, DOCX, DOC, PPT, PPTX, TXT, MD, CSV` },
        { status: 400 }
      )
    }

    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${Math.floor(MAX_DOCUMENT_SIZE_BYTES / 1024 / 1024)}MB` },
        { status: 400 }
      )
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const fileHash = createHash('sha256').update(fileBuffer).digest('hex')
    const villageId = session.admin.village_id || null

    const duplicate = await prisma.knowledge_documents.findFirst({
      where: {
        village_id: villageId || undefined,
        file_hash: fileHash,
        status: { in: ['pending', 'processing', 'ocr_pending', 'retrying', 'completed'] },
      },
      orderBy: { created_at: 'desc' },
    })

    if (duplicate) {
      return NextResponse.json(
        { success: false, error: 'Dokumen yang sama sudah pernah diunggah.', data: duplicate, code: 'DUPLICATE_DOCUMENT' },
        { status: 409 }
      )
    }

    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)

    const quotaWhere = {
      village_id: villageId || undefined,
      status: { in: ['pending', 'processing', 'completed'] },
    }

    const [activeCount, activeBytes, todayUploads] = await Promise.all([
      prisma.knowledge_documents.count({ where: quotaWhere }),
      prisma.knowledge_documents.aggregate({ where: quotaWhere, _sum: { file_size: true } }),
      prisma.knowledge_documents.count({
        where: {
          village_id: villageId || undefined,
          created_at: { gte: dayStart },
        },
      }),
    ])

    const currentBytes = activeBytes._sum.file_size || 0
    if (activeCount >= MAX_DOCUMENTS_PER_VILLAGE) {
      return NextResponse.json({ error: 'Kuota jumlah dokumen knowledge base sudah penuh.' }, { status: 429 })
    }
    if (currentBytes + file.size > MAX_DOCUMENT_BYTES_PER_VILLAGE) {
      return NextResponse.json({ error: 'Kuota kapasitas dokumen knowledge base sudah penuh.' }, { status: 429 })
    }
    if (todayUploads >= MAX_UPLOADS_PER_VILLAGE_PER_DAY) {
      return NextResponse.json({ error: 'Batas upload dokumen harian sudah tercapai.' }, { status: 429 })
    }

    const documentId = randomUUID()

    let resolvedCategoryId = categoryId || undefined
    let resolvedCategoryName = category || undefined

    if (!resolvedCategoryId && category && session.admin.village_id) {
      const existingCategory = await prisma.knowledge_categories.findFirst({
        where: { name: category, village_id: session.admin.village_id }
      })
      if (existingCategory) {
        resolvedCategoryId = existingCategory.id
        resolvedCategoryName = existingCategory.name
      }
    } else if (resolvedCategoryId) {
      const categoryRef = await prisma.knowledge_categories.findUnique({
        where: { id: resolvedCategoryId }
      })
      resolvedCategoryName = categoryRef?.name || resolvedCategoryName
    }

    const document = await prisma.knowledge_documents.create({
      data: {
        id: documentId,
        filename: `${documentId}.${getExtension(file.name)}`,
        original_name: file.name,
        mime_type: file.type,
        file_size: file.size,
        file_url: '',
        title: title || file.name.replace(/\.[^/.]+$/, ''),
        description,
        category: resolvedCategoryName || category,
        category_id: resolvedCategoryId,
        village_id: villageId || undefined,
        file_hash: fileHash,
        status: 'pending',
        error_message: null,
      },
    })

    const aiFormData = new FormData()
    aiFormData.append('file', new File([fileBuffer], file.name, { type: file.type }))
    aiFormData.append('documentId', documentId)
    aiFormData.append('fileHash', fileHash)
    aiFormData.append('upload_only', 'true')
    if (villageId) aiFormData.append('village_id', villageId)
    if (title) aiFormData.append('title', title)
    if (category) aiFormData.append('category', category)

    const aiResponse = await ai.uploadDocument(aiFormData)
    const aiData = await aiResponse.json().catch(() => null)

    if (!aiResponse.ok) {
      await prisma.knowledge_documents.delete({ where: { id: documentId } }).catch(() => {})
      return NextResponse.json({
        success: false,
        error: aiData?.error || 'Gagal menyimpan file dokumen',
      }, { status: aiResponse.status || 500 })
    }

    const updatedDoc = await prisma.knowledge_documents.update({
      where: { id: documentId },
      data: {
        file_url: aiData?.fileUrl || '',
        status: 'pending',
        error_message: null,
      },
    })

    return NextResponse.json({
      success: true,
      data: updatedDoc,
      message: 'Dokumen berhasil diunggah. Lanjutkan embed manual.',
    })
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
