import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://localhost:3001'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_FILE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

async function getSession(request: NextRequest) {
  const token =
    request.cookies.get('token')?.value || request.headers.get('authorization')?.replace('Bearer ', '')
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

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) return NextResponse.json({ error: 'File wajib diunggah' }, { status: 400 })
    if (!ALLOWED_FILE_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Tipe file tidak didukung. Gunakan JPG/PNG/PDF/DOC/DOCX.' }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Ukuran file maksimal 5MB' }, { status: 400 })
    }

    const forward = new FormData()
    forward.append('file', file, file.name)

    const response = await fetch(`${CHANNEL_SERVICE_URL}/internal/media/upload?scope=admin-updates`, {
      method: 'POST',
      headers: { 'x-internal-api-key': INTERNAL_API_KEY },
      body: forward,
    })

    const result = await response.json().catch(() => null)
    if (!response.ok) {
      return NextResponse.json({ error: result?.error || 'Gagal mengunggah file' }, { status: response.status })
    }

    return NextResponse.json({
      success: true,
      data: {
        url: result?.data?.url,
        internal_url: result?.data?.internal_url,
        mime_type: result?.data?.mime_type,
        size: result?.data?.size,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
