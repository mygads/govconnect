import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

const CHANNEL_SERVICE_URL = process.env['CHANNEL_SERVICE_URL'] || 'http://localhost:3001'
const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] || ''

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

function resolveVillageId(request: NextRequest, session: any): string | null {
  const fromSession = session?.admin?.village_id as string | undefined
  if (fromSession) return fromSession
  const url = new URL(request.url)
  return url.searchParams.get('village_id')
}

async function safeReadJson(response: Response): Promise<any | null> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(request, session)
  if (!villageId) return NextResponse.json({ error: 'village_id diperlukan' }, { status: 400 })

  const url = new URL(request.url)
  const waNumber = url.searchParams.get('wa_number')
  if (!waNumber) return NextResponse.json({ error: 'wa_number diperlukan' }, { status: 400 })

  const response = await fetch(
    `${CHANNEL_SERVICE_URL}/internal/whatsapp/check-duplicate?village_id=${encodeURIComponent(villageId)}&wa_number=${encodeURIComponent(waNumber)}`,
    {
      headers: {
        'x-internal-api-key': INTERNAL_API_KEY,
      },
    }
  )

  const data = await safeReadJson(response)
  
  // If duplicate found, try to enrich with village name from our database
  if (data?.data?.isDuplicate && data?.data?.existingVillageId) {
    try {
      const village = await prisma.villages.findUnique({
        where: { id: data.data.existingVillageId },
        select: { name: true },
      })
      if (village?.name) {
        data.data.existingVillageName = village.name
      }
    } catch {
      // Keep existing name
    }
  }

  return NextResponse.json(data, { status: response.status })
}
