import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

const CHANNEL_SERVICE_URL = process.env['CHANNEL_SERVICE_URL'] || 'http://localhost:3001'
const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] || ''

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value || request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({ where: { token }, include: { admin: true } })
  if (!session || session.expires_at < new Date()) return null
  return session
}

function resolveVillageId(request: NextRequest, session: any): string | null {
  return (session?.admin?.village_id as string | undefined) || new URL(request.url).searchParams.get('village_id')
}

async function safeReadJson(response: Response): Promise<any | null> {
  try { return await response.json() } catch { return null }
}

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(request, session)
  if (!villageId) return NextResponse.json({ error: 'village_id diperlukan' }, { status: 400 })
  const response = await fetch(`${CHANNEL_SERVICE_URL}/internal/whatsapp/s3?village_id=${encodeURIComponent(villageId)}`, {
    headers: { 'x-internal-api-key': INTERNAL_API_KEY },
  })
  return NextResponse.json(await safeReadJson(response), { status: response.status })
}

export async function DELETE(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(request, session)
  if (!villageId) return NextResponse.json({ error: 'village_id diperlukan' }, { status: 400 })
  const response = await fetch(`${CHANNEL_SERVICE_URL}/internal/whatsapp/s3?village_id=${encodeURIComponent(villageId)}`, {
    method: 'DELETE',
    headers: { 'x-internal-api-key': INTERNAL_API_KEY },
  })
  return NextResponse.json(await safeReadJson(response), { status: response.status })
}
