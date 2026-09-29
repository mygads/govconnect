import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'
import prisma from '@/lib/prisma'

/** POST /api/broadcast/drafts/[id]/reject — tolak draft { note? }. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })

  const draft = await prisma.broadcast_drafts.findFirst({ where: { id, village_id: villageId } })
  if (!draft) return NextResponse.json({ error: 'draft tidak ditemukan' }, { status: 404 })
  if (draft.status !== 'draft' && draft.status !== 'approved') {
    return NextResponse.json({ error: `draft sudah berstatus '${draft.status}'` }, { status: 409 })
  }

  const body = await request.json().catch(() => ({}))
  const updated = await prisma.broadcast_drafts.update({
    where: { id },
    data: {
      status: 'rejected',
      approved_by: session.admin.username,
      approved_at: new Date(),
      reject_note: String(body?.note ?? '').slice(0, 500) || null,
    },
  })
  return NextResponse.json({ success: true, draft: updated })
}
