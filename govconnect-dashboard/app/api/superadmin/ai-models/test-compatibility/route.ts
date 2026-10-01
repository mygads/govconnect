import { NextRequest, NextResponse } from 'next/server'
import { ai } from '@/lib/api-client'
import { requireRole } from '@/lib/auth'

// Rate limit: 1 test per menit per user (in-memory)
const lastTestAt = new Map<string, number>()
const RATE_LIMIT_MS = 60_000

export async function POST(request: NextRequest) {
  const [session, authError] = await requireRole(request, 'superadmin')
  if (authError) return authError

  try {
    const userId = (session as any)?.user?.id || (session as any)?.id || 'unknown'
    const now = Date.now()
    const last = lastTestAt.get(userId) || 0
    if (now - last < RATE_LIMIT_MS) {
      const waitSec = Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000)
      return NextResponse.json(
        { success: false, error: `Terlalu cepat. Tunggu ${waitSec} detik sebelum test lagi.` },
        { status: 429 }
      )
    }
    lastTestAt.set(userId, now)

    const body = await request.json().catch(() => ({}))
    const modelId = typeof body?.model_id === 'string' ? body.model_id : ''
    const draft = body?.draft && typeof body.draft === 'object' ? body.draft : null
    // Manual: base_url + api_key + model_name — api_key transient, tidak disimpan
    const manual = body?.manual && typeof body.manual === 'object' ? body.manual : null
    if (!modelId && !draft && !manual) {
      return NextResponse.json(
        { success: false, error: 'model_id, draft, atau manual wajib diisi' },
        { status: 400 }
      )
    }
    if (manual && (typeof manual.api_key !== 'string' || !manual.api_key)) {
      return NextResponse.json(
        { success: false, error: 'manual.api_key wajib diisi' },
        { status: 400 }
      )
    }

    const response = await ai.testModelCompatibility(
      modelId ? { model_id: modelId } : draft ? { draft } : { manual }
    )
    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error: any) {
    console.error('Superadmin model compatibility test proxy error:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to run compatibility test' },
      { status: 500 }
    )
  }
}
