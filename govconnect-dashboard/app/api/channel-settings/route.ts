import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'

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
  if (!session.admin.village_id) return NextResponse.json({ data: null })

  const response = await fetch(`${CHANNEL_SERVICE_URL}/internal/channel-accounts/${session.admin.village_id}`, {
    headers: { 'x-internal-api-key': INTERNAL_API_KEY }
  })

  if (!response.ok) {
    return NextResponse.json({ error: 'Failed to fetch channel settings' }, { status: response.status })
  }

  const data = await response.json()
  return NextResponse.json(data)
}

export async function PUT(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.admin.village_id) return NextResponse.json({ error: 'Village not found' }, { status: 404 })

  const body = await request.json()
  const response = await fetch(`${CHANNEL_SERVICE_URL}/internal/channel-accounts/${session.admin.village_id}`, {
    method: 'PUT',
    headers: {
      'x-internal-api-key': INTERNAL_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  const data = await response.json()
  return NextResponse.json(data, { status: response.status })
}
