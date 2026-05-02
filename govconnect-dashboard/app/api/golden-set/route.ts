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
    const villageId = request.nextUrl.searchParams.get('village_id')

    const runs = await prisma.ai_golden_set_runs.findMany({
      where: villageId
        ? {
            OR: [
              { village_id: villageId },
              { village_id: null },
            ],
          }
        : undefined,
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
      village_id,
      total,
      intent_accuracy,
      tool_accuracy,
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

    const releaseGatePass =
      (status?.overall_pass ?? true) &&
      (status?.intent_pass ?? true) &&
      (status?.tool_pass ?? true) &&
      !regressionDetected

    const run = await prisma.ai_golden_set_runs.create({
      data: {
        run_id,
        village_id: village_id || null,
        total: total || results.length,
        intent_accuracy: intent_accuracy || 0,
        tool_accuracy: tool_accuracy || 0,
        keyword_accuracy: keyword_accuracy || 0,
        overall_accuracy: overall_accuracy || 0,
        regression_detected: regressionDetected,
        release_gate_pass: releaseGatePass,
        thresholds: thresholds || {},
        status: status || {},
        started_at: new Date(started_at),
        completed_at: new Date(completed_at),
        items: {
          create: results.map((r: any) => ({
            run_id,
            query: r.query,
            expected_intent: r.expected_intent || null,
            expected_tools: r.expected_tools || undefined,
            actual_tools: r.actual_tools || undefined,
            predicted_intent: r.predicted_intent || 'UNKNOWN',
            reply_text: r.reply_text || '',
            intent_match: r.intent_match ?? null,
            tool_match: r.tool_match ?? null,
            tool_score: r.tool_score ?? null,
            keyword_match: r.keyword_match ?? null,
            keyword_score: r.keyword_score ?? null,
            retrieval_match: r.retrieval_match ?? null,
            retrieval_score: r.retrieval_score ?? null,
            retrieval_metrics: r.retrieval_metrics || undefined,
            score: r.score || 0,
            trace_score: r.trace_score ?? null,
            trace_grade: r.trace_grade ?? null,
            latency_ms: r.latency_ms || 0,
            scenario: r.scenario || null,
            trace_id: r.trace_id || null,
          })),
        },
      },
    })

    return NextResponse.json({
      status: 'success',
      data: {
        id: run.id,
        run_id: run.run_id,
        regression_detected: regressionDetected,
        release_gate_pass: releaseGatePass,
      },
    }, { status: 201 })
  } catch (error: any) {
    console.error('Error storing golden set run:', error)
    return NextResponse.json({ error: 'Failed to store run' }, { status: 500 })
  }
}
