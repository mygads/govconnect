import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/admin-session'

/**
 * POST /api/identity/revoke — cabut verifikasi identitas L2 seorang warga (R10).
 *
 * BELUM TERSEDIA: fungsi `identityRevoke()` hanya ada di
 * ai-service pipeline/pipeline-store.ts dan belum diekspos via HTTP.
 * Tombol di halaman verifikasi-identitas/[id] sudah terhubung ke route ini
 * dan akan otomatis berfungsi setelah backend menambahkan endpoint,
 * misalnya: POST /api/identity/revoke { village_id, user_id }
 * yang memanggil identityRevoke(village_id, user_id).
 */
export async function POST(request: NextRequest) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const villageId = resolveVillageId(session, request)
  if (!villageId) return NextResponse.json({ error: 'village_id required' }, { status: 400 })
  return NextResponse.json(
    {
      error: 'not_available',
      message:
        'Endpoint backend belum tersedia: identityRevoke() belum diekspos via HTTP di ai-service.',
      backend_needed: 'POST /api/identity/revoke { village_id, user_id } (ai-service)',
    },
    { status: 501 },
  )
}
