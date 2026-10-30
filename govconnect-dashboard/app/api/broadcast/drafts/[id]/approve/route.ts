import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'
import prisma from '@/lib/prisma'

/**
 * POST /api/broadcast/drafts/[id]/approve — approve draft oleh admin LAIN.
 * Aturan 2-step: approver (username session) TIDAK BOLEH sama dengan
 * created_by. Hanya draft berstatus 'draft' yang bisa di-approve.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })

  const draft = await prisma.broadcast_drafts.findFirst({ where: { id, village_id: villageId } })
  if (!draft) return NextResponse.json({ error: 'draft tidak ditemukan' }, { status: 404 })
  if (draft.status !== 'draft') {
    return NextResponse.json({ error: `draft sudah berstatus '${draft.status}'` }, { status: 409 })
  }
  if (draft.created_by === session.admin.username) {
    return NextResponse.json(
      { error: 'Tidak bisa approve draft sendiri — harus di-approve oleh admin lain.' },
      { status: 403 },
    )
  }

  const updated = await prisma.broadcast_drafts.update({
    where: { id },
    data: { status: 'approved', approved_by: session.admin.username, approved_at: new Date() },
  })
  return NextResponse.json({ success: true, draft: updated })
}
