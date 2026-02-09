/**
 * Internal API: Report BYOK Key Status
 * Called by AI Service when a key is detected as invalid.
 */

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

function verifyInternalApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-internal-api-key')
  return apiKey === process.env.INTERNAL_API_KEY
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyInternalApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { is_valid, reason } = body

    await prisma.gemini_api_keys.update({
      where: { id },
      data: {
        is_valid: is_valid ?? false,
        invalid_reason: reason || null,
        last_error: reason || null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Internal gemini-key status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
