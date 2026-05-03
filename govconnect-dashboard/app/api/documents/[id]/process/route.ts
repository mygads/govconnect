import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { ai } from '@/lib/api-client'

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

    if (session.admin.village_id && document.village_id !== session.admin.village_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!document.file_url) {
      return NextResponse.json({ error: 'File belum tersedia untuk diproses' }, { status: 409 })
    }

    await prisma.knowledge_documents.update({
      where: { id },
      data: { status: 'processing', error_message: null },
    })

    const response = await ai.processDocument(id)
    const result = await response.json().catch(() => null)

    if (!response.ok) {
      await prisma.knowledge_documents.update({
        where: { id },
        data: {
          status: result?.code === 'PARSE_FAIL' ? 'parse_fail' : result?.code === 'EMBED_FAIL' ? 'embed_fail' : 'failed',
          error_message: result?.details || result?.error || 'Gagal memproses dokumen',
        },
      })

      return NextResponse.json(
        { error: result?.error || 'Gagal memproses dokumen' },
        { status: response.status || 500 }
      )
    }

    if (result?.ocrQueued) {
      const updated = await prisma.knowledge_documents.update({
        where: { id },
        data: {
          status: 'ocr_pending',
          error_message: 'Dokumen terdeteksi scan/image-based. OCR sedang dijadwalkan.',
        },
      })

      return NextResponse.json({
        success: true,
        data: updated,
        ocrQueued: true,
        message: 'Dokumen masuk antrean OCR.',
      })
    }

    const updated = await prisma.knowledge_documents.update({
      where: { id },
      data: {
        status: 'completed',
        total_chunks: result?.chunksCount || 0,
        error_message: null,
      },
    })

    return NextResponse.json({
      success: true,
      data: updated,
      chunksCount: result?.chunksCount || 0,
      message: 'Dokumen berhasil diproses manual.',
    })
  } catch (error: any) {
    console.error('Error processing document:', error)
    return NextResponse.json(
      { error: 'Failed to process document' },
      { status: 500 }
    )
  }
}
