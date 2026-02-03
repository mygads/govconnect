import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { updateKnowledgeVector } from '@/lib/ai-service'

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

interface Params {
  params: Promise<{ id: string }>
}

/**
 * POST /api/knowledge/[id]/embed
 * Re-embed a single knowledge entry to AI service
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the knowledge entry
    const knowledge = await prisma.knowledge_base.findUnique({
      where: { id }
    })

    if (!knowledge) {
      return NextResponse.json({ error: 'Knowledge not found' }, { status: 404 })
    }

    // Check village access
    if (session.admin.village_id && knowledge.village_id !== session.admin.village_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Call AI service to update/re-embed the vector
    const vectorResult = await updateKnowledgeVector(knowledge.id, {
      village_id: knowledge.village_id || undefined,
      title: knowledge.title,
      content: knowledge.content,
      category: knowledge.category || 'Umum',
      keywords: knowledge.keywords || [],
      qualityScore: 0.8
    })

    if (!vectorResult.success) {
      console.error('Failed to re-embed knowledge:', vectorResult.error)
      return NextResponse.json(
        { error: 'Gagal melakukan re-embed ke AI service', details: vectorResult.error },
        { status: 500 }
      )
    }

    // Update last_embedded_at timestamp
    await prisma.knowledge_base.update({
      where: { id },
      data: {
        last_embedded_at: new Date()
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Knowledge berhasil di-embed ulang',
      knowledge_id: id,
      embedded_at: new Date().toISOString()
    })
  } catch (error) {
    console.error('Error re-embedding knowledge:', error)
    return NextResponse.json(
      { error: 'Gagal melakukan re-embed' },
      { status: 500 }
    )
  }
}
