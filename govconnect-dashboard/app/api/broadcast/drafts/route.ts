import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'
import prisma from '@/lib/prisma'

const VALID_STATUSES = ['draft', 'approved', 'rejected', 'sent'] as const

/**
 * GET /api/broadcast/drafts?status=draft — antrean draft broadcast desa ini.
 * POST /api/broadcast/drafts — buat draft baru { message, recipients[] }.
 * Draft dibuat oleh admin yang sedang login (created_by = username session).
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })

  const status = new URL(request.url).searchParams.get('status')
  const drafts = await prisma.broadcast_drafts.findMany({
    where: {
      village_id: villageId,
      ...(status && (VALID_STATUSES as readonly string[]).includes(status) ? { status } : {}),
    },
    orderBy: { created_at: 'desc' },
    take: 100,
  })
  return NextResponse.json({ success: true, drafts })
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const message = String(body?.message ?? '').trim()
  const recipients = Array.isArray(body?.recipients)
    ? body.recipients.map(String).map((s: string) => s.trim()).filter(Boolean).slice(0, 5000)
    : []
  if (message.length < 5) {
    return NextResponse.json({ error: 'message minimal 5 karakter' }, { status: 400 })
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: 'message maksimal 4000 karakter' }, { status: 400 })
  }
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'recipients (user_id warga) wajib diisi, satu per baris' }, { status: 400 })
  }

  const draft = await prisma.broadcast_drafts.create({
    data: {
      village_id: villageId,
      message,
      recipients,
      created_by: session.admin.username,
      status: 'draft',
    },
  })
  return NextResponse.json({
    success: true,
    draft,
    note: 'Draft tersimpan. Harus di-approve oleh admin LAIN sebelum bisa dikirim.',
  })
}
