import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-session'

/**
 * GET /api/csat-followups — tiket follow-up CSAT rating rendah (R12).
 *
 * BELUM TERSEDIA: ai-service tidak memiliki endpoint HTTP untuk membaca
 * `pipeline_fallback_tickets` (hanya ditulis oleh csat.service.ts dan
 * diagregasi di laporan bulanan). UI halaman /dashboard/csat-followup sudah
 * siap dan akan otomatis berfungsi setelah backend menambahkan endpoint,
 * misalnya: GET /api/fallback-tickets?village_id=X&reason=csat_low_rating
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(
    {
      error: 'not_available',
      message:
        'Endpoint backend belum tersedia: ai-service belum mengekspos daftar pipeline_fallback_tickets via HTTP.',
      backend_needed: 'GET /api/fallback-tickets?village_id=X&reason=csat_low_rating (ai-service)',
    },
    { status: 501 },
  )
}
