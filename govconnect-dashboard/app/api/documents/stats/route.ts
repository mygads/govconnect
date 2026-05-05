import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true },
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

    const where = session.admin.village_id ? { village_id: session.admin.village_id } : {}

    const errorStatuses = ['failed', 'parse_fail', 'ocr_fail', 'embed_fail']
    const processingStatuses = ['processing', 'ocr_pending', 'retrying']

    const [total, completed, processing, failed, pending, ocrPending, retrying, parseFail, ocrFail, embedFail, chunks] = await Promise.all([
      prisma.knowledge_documents.count({ where }),
      prisma.knowledge_documents.count({ where: { ...where, status: 'completed' } }),
      prisma.knowledge_documents.count({ where: { ...where, status: { in: processingStatuses } } }),
      prisma.knowledge_documents.count({ where: { ...where, status: { in: errorStatuses } } }),
      prisma.knowledge_documents.count({ where: { ...where, status: 'pending' } }),
      prisma.knowledge_documents.count({ where: { ...where, status: 'ocr_pending' } }),
      prisma.knowledge_documents.count({ where: { ...where, status: 'retrying' } }),
      prisma.knowledge_documents.count({ where: { ...where, status: 'parse_fail' } }),
      prisma.knowledge_documents.count({ where: { ...where, status: 'ocr_fail' } }),
      prisma.knowledge_documents.count({ where: { ...where, status: 'embed_fail' } }),
      prisma.knowledge_documents.aggregate({
        where,
        _sum: { total_chunks: true },
      }),
    ])

    return NextResponse.json({
      data: {
        total,
        completed,
        processing,
        failed,
        pending,
        ocrPending,
        retrying,
        parseFail,
        ocrFail,
        embedFail,
        totalChunks: chunks._sum.total_chunks || 0,
      },
    })
  } catch (error) {
    console.error('Error fetching document stats:', error)
    return NextResponse.json({ error: 'Failed to fetch document stats' }, { status: 500 })
  }
}
