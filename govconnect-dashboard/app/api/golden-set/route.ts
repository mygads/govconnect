import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { isAuthorizedInternalRequest } from '@/lib/internal-api-auth'

/**
 * GET /api/golden-set — List recent golden set evaluation runs
 * POST /api/golden-set — Store a new golden set evaluation run (from AI service)
 */

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedInternalRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '10')

    const runs = await prisma.ai_golden_set_runs.findMany({
      orderBy: { completed_at: 'desc' },
      take: Math.min(limit, 50),
      include: {
        items: {
          orderBy: { created_at: 'asc' },
        },
      },
    })

    return NextResponse.json({ data: runs })
  } catch (error: any) {
    console.error('Error fetching golden set runs:', error)
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorizedInternalRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const {
      run_id,
      total,
      intent_accuracy,
      keyword_accuracy,
      overall_accuracy,
      thresholds,
      status,
      started_at,
      completed_at,
      results,
    } = body

    if (!run_id || !results) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Store run + items in a transaction
    const run = await prisma.ai_golden_set_runs.create({
      data: {
        run_id,
        total: total || results.length,
        intent_accuracy: intent_accuracy || 0,
        keyword_accuracy: keyword_accuracy || 0,
        overall_accuracy: overall_accuracy || 0,
        thresholds: thresholds || {},
        status: status || {},
        started_at: new Date(started_at),
        completed_at: new Date(completed_at),
        items: {
          create: results.map((r: any) => ({
            run_id,
            query: r.query,
            expected_intent: r.expected_intent || null,
            predicted_intent: r.predicted_intent || 'UNKNOWN',
            reply_text: r.reply_text || '',
            intent_match: r.intent_match ?? null,
            keyword_match: r.keyword_match ?? null,
            keyword_score: r.keyword_score ?? null,
            score: r.score || 0,
            latency_ms: r.latency_ms || 0,
          })),
        },
      },
    })

    // Release gate: check if regression detected against previous run
    const previousRun = await prisma.ai_golden_set_runs.findFirst({
      where: { run_id: { not: run_id } },
      orderBy: { completed_at: 'desc' },
    })

    let regressionDetected = false
    const regressionDelta = thresholds?.regression_delta || 0.05

    if (previousRun) {
      regressionDetected =
        (previousRun.overall_accuracy - overall_accuracy) >= regressionDelta
    }

    return NextResponse.json({
      status: 'success',
      data: {
        id: run.id,
        run_id: run.run_id,
        regression_detected: regressionDetected,
        release_gate_pass:
          (status?.overall_pass ?? true) &&
          (status?.intent_pass ?? true) &&
          (status?.tool_pass ?? true) &&
          !regressionDetected,
      },
    }, { status: 201 })
  } catch (error: any) {
    console.error('Error storing golden set run:', error)
    return NextResponse.json({ error: 'Failed to store run' }, { status: 500 })
  }
}
