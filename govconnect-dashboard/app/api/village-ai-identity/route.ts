import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const DEFAULT_NAME = 'Gana'

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

function normalize(body: any) {
  const disclosure = body?.disclosure !== false
  const personaName = typeof body?.persona_name === 'string' && body.persona_name.trim()
    ? body.persona_name.trim().slice(0, 40)
    : DEFAULT_NAME
  const personaDescription = typeof body?.persona_description === 'string' && body.persona_description.trim()
    ? body.persona_description.trim().slice(0, 500)
    : null
  return { disclosure, persona_name: personaName, persona_description: personaDescription }
}

async function readIdentity(villageId: string) {
  const row = await (prisma as any).village_behavior_configs.findUnique({
    where: { village_id: villageId },
    select: {
      ai_identity_disclosure: true,
      ai_persona_name: true,
      ai_persona_description: true,
    },
  })
  if (!row) return { disclosure: true, persona_name: DEFAULT_NAME, persona_description: null }
  return {
    disclosure: row.ai_identity_disclosure ?? true,
    persona_name: (row.ai_persona_name || '').trim() || DEFAULT_NAME,
    persona_description: row.ai_persona_description || null,
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(request, session)
  if (!villageId) return NextResponse.json({ error: 'village_id diperlukan' }, { status: 400 })
  const identity = await readIdentity(villageId)
  return NextResponse.json({ data: { village_id: villageId, ...identity } })
}

export async function PUT(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(request, session)
  if (!villageId) return NextResponse.json({ error: 'village_id diperlukan' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const { disclosure, persona_name, persona_description } = normalize(body)

  await (prisma as any).village_behavior_configs.upsert({
    where: { village_id: villageId },
    update: {
      ai_identity_disclosure: disclosure,
      ai_persona_name: persona_name,
      ai_persona_description: persona_description,
    },
    create: {
      village_id: villageId,
      ai_identity_disclosure: disclosure,
      ai_persona_name: persona_name,
      ai_persona_description: persona_description,
    },
  })

  // Audit trail: perubahan identitas AI selalu dicatat (siapa, kapan, nilai).
  try {
    await prisma.activity_logs.create({
      data: {
        admin_id: session.admin.id,
        action: 'update_ai_identity',
        resource: 'village_behavior_configs',
        details: { village_id: villageId, disclosure, persona_name },
        ip_address: request.headers.get('x-forwarded-for') ||
          request.headers.get('x-real-ip') ||
          'unknown',
      },
    })
  } catch { /* audit tidak boleh menggagalkan penyimpanan */ }

  return NextResponse.json({ success: true, data: { village_id: villageId, disclosure, persona_name, persona_description } })
}
