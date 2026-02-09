/**
 * Superadmin API: Validate a Gemini API Key
 * POST /api/superadmin/gemini-keys/validate
 * Tests a key without saving it.
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

export async function POST(request: NextRequest) {
  try {
    const result = await getSession(request)
    if (!result || result.payload.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { api_key } = body

    if (!api_key) {
      return NextResponse.json({ error: 'API key wajib diisi' }, { status: 400 })
    }

    // Test the API key
    const startTime = Date.now()
    try {
      const genAI = new GoogleGenerativeAI(api_key)
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-lite',
        generationConfig: { temperature: 0, maxOutputTokens: 10 },
      })

      const testResult = await Promise.race([
        model.generateContent('Respond with only "ok"'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Validation timeout')), 15000)
        ),
      ])

      const response = testResult.response.text()
      const latency = Date.now() - startTime

      return NextResponse.json({
        valid: true,
        message: 'API key valid dan berfungsi',
        latency_ms: latency,
        test_response: response.substring(0, 50),
      })
    } catch (validationError: any) {
      const latency = Date.now() - startTime
      const msg = validationError.message || 'Unknown error'

      if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED') || msg.includes('401')) {
        return NextResponse.json({
          valid: false,
          message: 'API key tidak valid',
          detail: 'Pastikan API key benar dan Gemini API sudah diaktifkan di Google AI Studio.',
          latency_ms: latency,
        })
      }

      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        return NextResponse.json({
          valid: true,
          message: 'API key valid tetapi sedang rate-limited',
          detail: 'Key tervalidasi tapi saat ini sedang di-rate limit. Bisa ditambahkan dan akan digunakan saat limit reset.',
          latency_ms: latency,
        })
      }

      if (msg.includes('Validation timeout')) {
        return NextResponse.json({
          valid: false,
          message: 'Timeout saat validasi',
          detail: 'Koneksi ke Google API timeout. Coba lagi.',
          latency_ms: latency,
        }, { status: 408 })
      }

      return NextResponse.json({
        valid: false,
        message: 'Gagal memvalidasi API key',
        detail: msg,
        latency_ms: latency,
      })
    }
  } catch (error) {
    console.error('Superadmin gemini-keys validate error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
