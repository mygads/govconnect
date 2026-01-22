import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

const CHANNEL_SERVICE_URL = process.env.CHANNEL_SERVICE_URL || 'http://localhost:3001'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

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
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = (session.admin as any).village_id as string | undefined
  if (!villageId) return NextResponse.json({ error: 'Village not found' }, { status: 404 })

  const response = await fetch(
    `${CHANNEL_SERVICE_URL}/internal/whatsapp/qr?village_id=${encodeURIComponent(villageId)}`,
    {
      headers: {
        'x-internal-api-key': INTERNAL_API_KEY,
      },
    }
  )

  const data = await response.json()
  return NextResponse.json(data, { status: response.status })
}
