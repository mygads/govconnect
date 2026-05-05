import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { ai } from '@/lib/api-client'

const ELIGIBLE_STATUSES = ['pending', 'failed', 'parse_fail', 'embed_fail'] as const

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

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const where: any = {
      file_url: { not: '' },
      status: { in: [...ELIGIBLE_STATUSES] },
    }

    if (session.admin.village_id) {
      where.village_id = session.admin.village_id
    }

    const documents = await prisma.knowledge_documents.findMany({
      where,
      orderBy: { created_at: 'asc' },
      select: { id: true },
    })

    let processed = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const document of documents) {
      await prisma.knowledge_documents.update({
        where: { id: document.id },
        data: { status: 'processing', error_message: null },
      })

      const response = await ai.processDocument(document.id)
      const result = await response.json().catch(() => null)

      if (!response.ok) {
        await prisma.knowledge_documents.update({
          where: { id: document.id },
          data: {
            status: result?.code === 'PARSE_FAIL' ? 'parse_fail' : result?.code === 'EMBED_FAIL' ? 'embed_fail' : 'failed',
            error_message: result?.details || result?.error || 'Gagal memproses dokumen',
          },
        })

        errors.push({
          id: document.id,
          error: result?.error || 'Gagal memproses dokumen',
        })
        continue
      }

      if (result?.ocrQueued) {
        await prisma.knowledge_documents.update({
          where: { id: document.id },
          data: {
            status: 'ocr_pending',
            error_message: 'Dokumen terdeteksi scan/image-based. OCR sedang dijadwalkan.',
          },
        })
        processed += 1
        continue
      }

      await prisma.knowledge_documents.update({
        where: { id: document.id },
        data: {
          status: 'completed',
          total_chunks: result?.chunksCount || 0,
          error_message: null,
        },
      })
      processed += 1
    }

    return NextResponse.json({
      success: true,
      total: documents.length,
      processed,
      failed: errors.length,
      errors,
    })
  } catch (error: any) {
    console.error('Error processing all documents:', error)
    return NextResponse.json(
      { error: 'Failed to process documents', details: error.message },
      { status: 500 }
    )
  }
}
