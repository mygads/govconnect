/**
 * Superadmin API: Gemini BYOK Key Management
 * CRUD operations for managing Gemini API keys.
 */

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { GoogleGenerativeAI } from '@google/generative-ai'

async function getSession(request: NextRequest) {
  const token = request.cookies.get('token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const session = await prisma.admin_sessions.findUnique({
    where: { token },
    include: { admin: true }
  })
  if (!session || session.expires_at < new Date()) return null
  return { session, payload }
}

function requireSuperadmin(payload: any) {
  return payload.role === 'superadmin'
}

// ==================== Rate Limit Constants ====================
// These are exposed to the frontend for display

const TIER_LIMITS = {
  free: {
    label: 'Free',
    models: {
      'gemini-2.0-flash-lite':  { rpm: 10,  tpm: 250_000, rpd: 20 },
      'gemini-2.0-flash':       { rpm: 5,   tpm: 250_000, rpd: 20 },
      'gemini-2.5-flash-lite':  { rpm: 10,  tpm: 250_000, rpd: 20 },
      'gemini-2.5-flash':       { rpm: 5,   tpm: 250_000, rpd: 20 },
      'gemini-2.5-pro':         { rpm: 2,   tpm: 250_000, rpd: 10 },
      'gemini-3-flash-preview': { rpm: 5,   tpm: 250_000, rpd: 20 },
      'gemini-embedding-001':   { rpm: 100, tpm: 30_000,  rpd: 1_000 },
    },
  },
  tier1: {
    label: 'Tier 1 (Berbayar)',
    models: {
      'gemini-2.0-flash-lite':  { rpm: 4_000, tpm: 4_000_000,  rpd: 999_999 },
      'gemini-2.0-flash':       { rpm: 2_000, tpm: 4_000_000,  rpd: 999_999 },
      'gemini-2.5-flash-lite':  { rpm: 4_000, tpm: 4_000_000,  rpd: 999_999 },
      'gemini-2.5-flash':       { rpm: 1_000, tpm: 1_000_000,  rpd: 10_000 },
      'gemini-2.5-pro':         { rpm: 150,   tpm: 2_000_000,  rpd: 1_000 },
      'gemini-3-flash-preview': { rpm: 1_000, tpm: 1_000_000,  rpd: 10_000 },
      'gemini-3-pro-preview':   { rpm: 25,    tpm: 1_000_000,  rpd: 250 },
      'gemini-embedding-001':   { rpm: 3_000, tpm: 1_000_000,  rpd: 999_999 },
    },
  },
  tier2: {
    label: 'Tier 2 (>$250 spend)',
    models: {
      'gemini-2.0-flash-lite':  { rpm: 8_000,  tpm: 8_000_000,  rpd: 999_999 },
      'gemini-2.0-flash':       { rpm: 4_000,  tpm: 8_000_000,  rpd: 999_999 },
      'gemini-2.5-flash-lite':  { rpm: 8_000,  tpm: 8_000_000,  rpd: 999_999 },
      'gemini-2.5-flash':       { rpm: 2_000,  tpm: 4_000_000,  rpd: 999_999 },
      'gemini-2.5-pro':         { rpm: 1_000,  tpm: 4_000_000,  rpd: 10_000 },
      'gemini-3-flash-preview': { rpm: 2_000,  tpm: 4_000_000,  rpd: 999_999 },
      'gemini-3-pro-preview':   { rpm: 150,    tpm: 2_000_000,  rpd: 1_000 },
      'gemini-embedding-001':   { rpm: 5_000,  tpm: 4_000_000,  rpd: 999_999 },
    },
  },
} as const

/**
 * GET /api/superadmin/gemini-keys
 * List all BYOK keys with usage data.
 */
export async function GET(request: NextRequest) {
  try {
    const result = await getSession(request)
    if (!result || !requireSuperadmin(result.payload)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'day' // day, week, month

    // Get all keys
    const keys = await prisma.gemini_api_keys.findMany({
      orderBy: { priority: 'asc' },
    })

    // Get today's usage for each key
    const now = new Date()
    const todayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`

    // Calculate period start
    let periodStart: string
    if (period === 'week') {
      const d = new Date(now)
      d.setDate(d.getDate() - 7)
      periodStart = d.toISOString().slice(0, 10)
    } else if (period === 'month') {
      const d = new Date(now)
      d.setMonth(d.getMonth() - 1)
      periodStart = d.toISOString().slice(0, 10)
    } else {
      periodStart = todayKey
    }

    // Get usage aggregated per key
    const usageByKey = await prisma.gemini_api_key_usage.groupBy({
      by: ['key_id', 'model'],
      where: {
        period_type: 'day',
        period_key: { gte: periodStart },
      },
      _sum: {
        request_count: true,
        input_tokens: true,
        total_tokens: true,
      },
    })

    // Get today's usage specifically (for current limits display)
    const todayUsage = await prisma.gemini_api_key_usage.findMany({
      where: {
        period_type: 'day',
        period_key: todayKey,
      },
      select: {
        key_id: true,
        model: true,
        request_count: true,
        input_tokens: true,
        total_tokens: true,
      },
    })

    // Build response
    const keysWithUsage = keys.map((key: any) => {
      // Period usage
      const keyUsage = usageByKey.filter((u: any) => u.key_id === key.id)
      const periodUsage = keyUsage.map((u: any) => ({
        model: u.model,
        request_count: u._sum.request_count || 0,
        input_tokens: u._sum.input_tokens || 0,
        total_tokens: u._sum.total_tokens || 0,
      }))

      // Today's usage per model (for limit comparison)
      const keyTodayUsage = todayUsage.filter((u: any) => u.key_id === key.id)
      const todayByModel = keyTodayUsage.map((u: any) => ({
        model: u.model,
        rpd_used: u.request_count,
        tokens_used: u.input_tokens,
      }))

      // Get tier limits
      const tierConfig = TIER_LIMITS[key.tier as keyof typeof TIER_LIMITS] || TIER_LIMITS.free

      return {
        ...key,
        api_key: key.api_key.substring(0, 8) + '...' + key.api_key.substring(key.api_key.length - 4), // Mask key
        api_key_full: undefined, // Never send full key to frontend
        tier_label: tierConfig.label,
        tier_limits: tierConfig.models,
        period_usage: periodUsage,
        today_usage: todayByModel,
        total_period_requests: periodUsage.reduce((s: number, u: any) => s + u.request_count, 0),
        total_period_tokens: periodUsage.reduce((s: number, u: any) => s + u.total_tokens, 0),
      }
    })

    return NextResponse.json({
      keys: keysWithUsage,
      tier_limits: TIER_LIMITS,
      env_key_configured: !!process.env.GEMINI_API_KEY,
    })
  } catch (error) {
    console.error('Superadmin gemini-keys GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/superadmin/gemini-keys
 * Add a new BYOK key. Validates with Google API first.
 */
export async function POST(request: NextRequest) {
  try {
    const result = await getSession(request)
    if (!result || !requireSuperadmin(result.payload)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { name, api_key, gmail_account, tier } = body

    if (!name || !api_key || !gmail_account || !tier) {
      return NextResponse.json({ error: 'Semua field wajib diisi' }, { status: 400 })
    }

    if (!['free', 'tier1', 'tier2'].includes(tier)) {
      return NextResponse.json({ error: 'Tier harus free, tier1, atau tier2' }, { status: 400 })
    }

    // Check for duplicate
    const existing = await prisma.gemini_api_keys.findFirst({
      where: { api_key },
    })
    if (existing) {
      return NextResponse.json({ error: 'API key sudah terdaftar' }, { status: 409 })
    }

    // Validate the API key by making a test call
    try {
      const genAI = new GoogleGenerativeAI(api_key)
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-lite',
        generationConfig: { temperature: 0, maxOutputTokens: 10 },
      })
      const testResult = await Promise.race([
        model.generateContent('Say "ok"'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Validation timeout')), 15000)
        ),
      ])
      // If we get here, the key is valid
      testResult.response.text()
    } catch (validationError: any) {
      const msg = validationError.message || 'Unknown error'
      if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED') || msg.includes('401')) {
        return NextResponse.json({
          error: 'API key tidak valid. Pastikan API key benar dan Gemini API sudah diaktifkan.',
          detail: msg,
        }, { status: 400 })
      }
      // Rate limit errors mean the key is valid but at capacity
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        // Key is valid, just at rate limit — allow adding
      } else if (msg.includes('Validation timeout')) {
        return NextResponse.json({
          error: 'Timeout saat validasi API key. Coba lagi.',
          detail: msg,
        }, { status: 408 })
      } else {
        return NextResponse.json({
          error: 'Gagal memvalidasi API key.',
          detail: msg,
        }, { status: 400 })
      }
    }

    // Get max priority for ordering
    const maxPriority = await prisma.gemini_api_keys.aggregate({
      _max: { priority: true },
    })

    const newKey = await prisma.gemini_api_keys.create({
      data: {
        name,
        api_key,
        gmail_account,
        tier,
        is_active: true,
        is_valid: true,
        priority: (maxPriority._max.priority ?? -1) + 1,
        last_validated_at: new Date(),
      },
    })

    return NextResponse.json({
      key: {
        ...newKey,
        api_key: newKey.api_key.substring(0, 8) + '...' + newKey.api_key.substring(newKey.api_key.length - 4),
      },
      message: 'API key berhasil ditambahkan dan tervalidasi',
    }, { status: 201 })
  } catch (error) {
    console.error('Superadmin gemini-keys POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
