import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { buildUrl, ServicePath, getHeaders } from '@/lib/api-client'

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const prismaClient = prisma as any
  const session = await prismaClient.admin_sessions.findUnique({
    where: { token },
    include: { admin: true }
  })
  if (!session || session.expires_at < new Date()) return null
  return session
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request) as any
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      query,
      category_id,
      category_ids,
      top_k,
      min_score,
      include_knowledge = true,
      include_documents = true,
    } = body

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query wajib diisi' }, { status: 400 })
    }

    const sourceTypes: string[] = []
    if (include_knowledge) sourceTypes.push('knowledge')
    if (include_documents) sourceTypes.push('document')
    if (sourceTypes.length === 0) {
      return NextResponse.json({ error: 'Pilih minimal satu sumber data' }, { status: 400 })
    }

    let categories: string[] | undefined = undefined
    const categoryIds = Array.isArray(category_ids)
      ? category_ids
      : category_id
        ? [category_id]
        : []

    if (categoryIds.length > 0) {
      const prismaClient = prisma as any
      const records = await prismaClient.knowledge_categories.findMany({
        where: {
          id: { in: categoryIds },
          village_id: session.admin.village_id || undefined,
        },
        select: { name: true },
      })

      if (records.length === 0) {
        return NextResponse.json({ error: 'Kategori tidak ditemukan' }, { status: 400 })
      }

      categories = records.map((r: { name: string }) => r.name)
    }

    const response = await fetch(buildUrl(ServicePath.AI, '/api/search'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        query,
        topK: Number(top_k) || 5,
        minScore: Number(min_score) || 0.6,
        categories,
        sourceTypes,
        villageId: session.admin?.village_id || undefined,
        trackUsage: false,
      }),
    })

    let result: any = null
    try {
      result = await response.json()
    } catch {
      result = null
    }

    if (!response.ok) {
      // Degrade gracefully for upstream 5xx (AI unavailable, embedding fetch failed, etc.)
      if (response.status >= 500) {
        return NextResponse.json({
          data: [],
          total: 0,
          searchTimeMs: 0,
          warning: result?.error || 'AI search unavailable',
        })
      }

      return NextResponse.json({ error: result?.error || 'Gagal melakukan pencarian' }, { status: response.status })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Testing knowledge error:', error)
    // Network/infra errors should not break UI; return empty search results.
    return NextResponse.json({
      data: [],
      total: 0,
      searchTimeMs: 0,
      warning: 'AI search unavailable',
    })
  }
}
