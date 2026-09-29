import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'
import { apiFetch, buildUrl, getHeaders, ServicePath } from '@/lib/api-client'

/**
 * POST /api/identity/revoke — cabut verifikasi identitas L2 seorang warga (R10).
 *
 * Admin proxy -> ai-service POST /api/identity/revoke { village_id, user_id }.
 * village_id SELALU diambil dari sesi admin, bukan dari body bebas — tenant
 * tidak bisa dicabut lintas desa oleh admin desa.
 */
export async function POST(request: NextRequest) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const userId = String(body?.user_id ?? '').trim()
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  try {
    const backendResp = await apiFetch(buildUrl(ServicePath.AI, '/api/identity/revoke'), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ village_id: villageId, user_id: userId }),
    })

    if (!backendResp.ok) {
      const detail = await backendResp.text().catch(() => '')
      console.error('identity revoke backend error:', backendResp.status, detail)
      return NextResponse.json(
        { error: 'Gagal mencabut verifikasi identitas' },
        { status: 502 },
      )
    }

    const data = await backendResp.json().catch(() => ({ success: true }))
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error revoking identity:', error)
    return NextResponse.json(
      { error: 'Gagal mencabut verifikasi identitas' },
      { status: 500 },
    )
  }
}
