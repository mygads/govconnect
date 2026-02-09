/**
 * Internal API: Receive BYOK usage data from AI/Case services.
 * Upserts usage counters (additive) per key+model+period.
 */

import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

function verifyInternalApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-internal-api-key')
  return apiKey === process.env.INTERNAL_API_KEY
}

export async function POST(request: NextRequest) {
  if (!verifyInternalApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const records = body.records as Array<{
      key_id: string
      model: string
      period_type: string
      period_key: string
      request_count: number
      input_tokens: number
      total_tokens: number
    }>

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ ok: true, upserted: 0 })
    }

    // Batch upsert
    let upserted = 0
    for (const rec of records) {
      try {
        await prisma.gemini_api_key_usage.upsert({
          where: {
            key_id_model_period_type_period_key: {
              key_id: rec.key_id,
              model: rec.model,
              period_type: rec.period_type,
              period_key: rec.period_key,
            },
          },
          update: {
            request_count: { increment: rec.request_count },
            input_tokens: { increment: rec.input_tokens },
            total_tokens: { increment: rec.total_tokens },
          },
          create: {
            key_id: rec.key_id,
            model: rec.model,
            period_type: rec.period_type,
            period_key: rec.period_key,
            request_count: rec.request_count,
            input_tokens: rec.input_tokens,
            total_tokens: rec.total_tokens,
          },
        })
        upserted++
      } catch (err) {
        // Skip individual record failures (e.g. orphaned key_id)
        console.warn('Usage upsert failed for record', rec.key_id, rec.model, err)
      }
    }

    // Also update last_used_at on the keys
    const keyIds = [...new Set(records.map(r => r.key_id))]
    await prisma.gemini_api_keys.updateMany({
      where: { id: { in: keyIds } },
      data: { last_used_at: new Date() },
    })

    return NextResponse.json({ ok: true, upserted })
  } catch (error) {
    console.error('Internal gemini-keys usage error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
