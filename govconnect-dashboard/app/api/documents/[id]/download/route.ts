import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getInternalApiKey, ServicePath } from '@/lib/api-client'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const document = await prisma.knowledge_documents.findUnique({
      where: { id },
    })

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (session.villageId && document.village_id !== session.villageId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!document.file_url) {
      return NextResponse.json({ error: 'File belum tersedia untuk diunduh' }, { status: 409 })
    }

    const rawUrl = document.file_url
    const normalized = rawUrl.startsWith('http')
      ? rawUrl
      : buildUrl(ServicePath.AI, rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`)

    const requestHeaders = new Headers()
    if (new URL(normalized).pathname.startsWith('/uploads/documents/')) {
      requestHeaders.set('x-internal-api-key', getInternalApiKey())
    }

    let response: Response
    try {
      response = await fetch(normalized, {
        headers: requestHeaders,
        signal: AbortSignal.timeout(15000),
      })
    } catch (fetchErr: any) {
      console.error('Download fetch error:', fetchErr.message, 'URL:', normalized)
      return NextResponse.json(
        { error: 'Gagal mengambil file dari AI service. Pastikan AI service aktif.' },
        { status: 502 }
      )
    }

    if (!response.ok) {
      console.error('Download response not ok:', response.status, 'URL:', normalized)
      return NextResponse.json(
        { error: `Gagal mengunduh file (status ${response.status}). File mungkin sudah dihapus.` },
        { status: 502 }
      )
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const data = await response.arrayBuffer()
    const filename = document.original_name || document.filename || 'document'
    const encoded = encodeURIComponent(filename)

    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
      },
    })
  } catch (error) {
    console.error('Download document error:', error)
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 })
  }
}
