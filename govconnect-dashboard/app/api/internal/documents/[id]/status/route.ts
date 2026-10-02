import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

function verifyInternalKey(request: NextRequest): boolean {
  const key = request.headers.get('x-internal-api-key')
  const expected = process.env.INTERNAL_API_KEY
  return !!key && !!expected && key === expected
}

/**
 * PUT /api/internal/documents/[id]/status
 * Update document processing status (internal API)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyInternalKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { status } = body

  if (!status) {
    return NextResponse.json({ error: 'status is required' }, { status: 400 })
  }

  try {
    await prisma.knowledge_documents.update({
      where: { id },
      data: { status, updated_at: new Date() },
    })
    return NextResponse.json({ success: true, id, status })
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to update status', details: error.message },
      { status: 500 }
    )
  }
}
