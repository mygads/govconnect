/**
 * Internal API: Gemini BYOK Key Management
 *
 * Called by AI Service and Case Service (internal Docker network).
 * Auth: x-internal-api-key header.
 */

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

function verifyInternalApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-internal-api-key')
  return apiKey === process.env.INTERNAL_API_KEY
}

/**
 * GET /api/internal/gemini-keys
 * Returns all active+valid BYOK keys for AI/Case services.
 */
export async function GET(request: NextRequest) {
  if (!verifyInternalApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const keys = await prisma.gemini_api_keys.findMany({
      where: { is_active: true, is_valid: true },
      orderBy: { priority: 'asc' },
      select: {
        id: true,
        name: true,
        api_key: true,
        gmail_account: true,
        tier: true,
        is_active: true,
        is_valid: true,
        priority: true,
        consecutive_failures: true,
        last_used_at: true,
      },
    })

    return NextResponse.json({ keys })
  } catch (error) {
    console.error('Internal gemini-keys error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
