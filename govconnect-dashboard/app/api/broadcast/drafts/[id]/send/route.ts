import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'
import { buildUrl, ServicePath, getHeaders, apiFetch } from '@/lib/api-client'
import prisma from '@/lib/prisma'

/**
 * POST /api/broadcast/drafts/[id]/send — kirim broadcast yang sudah di-approve.
 * Syarat: status = 'approved'. Meneruskan ke ai-service
 * POST /internal/broadcast/send (yang re-check consent per penerima).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })

  const draft = await prisma.broadcast_drafts.findFirst({ where: { id, village_id: villageId } })
  if (!draft) return NextResponse.json({ error: 'draft tidak ditemukan' }, { status: 404 })
  if (draft.status !== 'approved') {
    return NextResponse.json(
      { error: `Hanya draft berstatus 'approved' yang bisa dikirim (status: '${draft.status}').` },
      { status: 409 },
    )
  }

  const url = buildUrl(ServicePath.AI, '/internal/broadcast/send')
  try {
    const res = await apiFetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        village_id: villageId,
        text: draft.message,
        user_ids: draft.recipients,
        sent_by: `${session.admin.username} (approve: ${draft.approved_by ?? '-'})`,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error ?? 'ai-service menolak pengiriman', detail: data },
        { status: res.status },
      )
    }
    const updated = await prisma.broadcast_drafts.update({
      where: { id },
      data: { status: 'sent', sent_at: new Date(), send_result: data as object },
    })
    return NextResponse.json({ success: true, draft: updated, result: data })
  } catch (err: any) {
    return NextResponse.json({ error: 'ai-service unreachable', detail: String(err?.message ?? err) }, { status: 502 })
  }
}
