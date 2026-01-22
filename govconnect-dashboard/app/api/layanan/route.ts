import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'

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
  try {
    const session = await getSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const url = new URL(buildUrl(ServicePath.CASE, '/services'))
      if (session.admin.village_id) {
        url.searchParams.set('village_id', session.admin.village_id)
      }

      const response = await apiFetch(url.toString(), {
        headers: getHeaders(),
      })

      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }
    } catch (error) {
      console.log('Case service not available for layanan')
    }

    return NextResponse.json({ data: [] })
  } catch (error) {
    console.error('Error fetching layanan:', error)
    return NextResponse.json({ error: 'Failed to fetch layanan' }, { status: 500 })
  }
}
