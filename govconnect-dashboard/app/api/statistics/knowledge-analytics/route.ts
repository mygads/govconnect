import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { ai, apiFetch, buildUrl, getHeaders, ServicePath } from '@/lib/api-client'
import prisma from '@/lib/prisma'

async function safeJson(fetcher: () => Promise<Response>) {
  try {
    const res = await fetcher()
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// GET - Get knowledge analytics (intent stats, top queries, coverage gaps)
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const villageId = resolveVillageId(request, session)
    if (!villageId) {
      return NextResponse.json({ error: 'Village ID required' }, { status: 400 })
    }

    const consistencySummaryQs = `?villageId=${encodeURIComponent(villageId)}`
    const consistencyListQs = `?villageId=${encodeURIComponent(villageId)}&status=open&limit=10`

    const [
      analyticsData,
      intentData,
      flowData,
      knowledgeData,
      retrievalData,
      memoryData,
      guardrailData,
      toolPolicyData,
      consistencySummaryData,
      consistencyListData,
    ] = await Promise.all([
      safeJson(() => ai.getAnalytics({ village_id: villageId })),
      safeJson(() => ai.getAnalyticsIntents({ village_id: villageId })),
      safeJson(() => ai.getAnalyticsFlow({ village_id: villageId })),
      safeJson(() => ai.getAnalyticsKnowledge({ village_id: villageId })),
      safeJson(() => ai.getAnalyticsRetrieval({ village_id: villageId })),
      safeJson(() => ai.getAnalyticsMemory({ village_id: villageId })),
      safeJson(() => ai.getAnalyticsGuardrails({ village_id: villageId })),
      safeJson(() => ai.getAnalyticsToolPolicy({ village_id: villageId })),
      safeJson(() => apiFetch(buildUrl(ServicePath.AI, `/api/knowledge-consistency/summary${consistencySummaryQs}`), {
        headers: getHeaders(),
        timeout: 15000,
      })),
      safeJson(() => apiFetch(buildUrl(ServicePath.AI, `/api/knowledge-consistency${consistencyListQs}`), {
        headers: getHeaders(),
        timeout: 15000,
      })),
    ])

    // Build analytics response
    const intents = intentData?.intents || intentData?.data || []
    const flow = flowData?.flow || flowData?.data || flowData || {}

    // Fetch persistent knowledge gaps from DB (needed for both gap table AND fallback stats)
    let topGaps: any[] = []
    let gapStatusCounts: Record<string, number> = { open: 0, resolved: 0, ignored: 0 }
    let gapsAvailable = false
    try {
      const [gaps, statusCounts] = await Promise.all([
        prisma.knowledge_gaps.findMany({
          where: { village_id: villageId, status: 'open' },
          orderBy: [{ hit_count: 'desc' }, { last_seen_at: 'desc' }],
          take: 20,
        }),
        prisma.knowledge_gaps.groupBy({
          by: ['status'],
          where: { village_id: villageId },
          _count: true,
        }),
      ])
      topGaps = gaps.map(g => ({
        id: g.id,
        query: g.query_text,
        intent: g.intent,
        confidence: g.confidence_level,
        hitCount: g.hit_count,
        firstSeen: g.first_seen_at,
        lastSeen: g.last_seen_at,
        channel: g.channel,
        resolutionKbId: g.resolution_kb_id,
      }))
      for (const sc of statusCounts) {
        gapStatusCounts[sc.status] = sc._count
      }
      gapsAvailable = true
    } catch (e) { console.log('Knowledge gaps DB unavailable') }

    // Fetch knowledge conflicts from DB
    let topConflicts: any[] = []
    let conflictStatusCounts: Record<string, number> = { open: 0, resolved: 0, auto_resolved: 0, ignored: 0 }
    let conflictsAvailable = false
    let conflictSource: 'database' | 'knowledge_consistency' | 'unavailable' = 'unavailable'
    try {
      const [conflicts, conflictCounts] = await Promise.all([
        prisma.knowledge_conflicts.findMany({
          where: { village_id: villageId, status: { in: ['open', 'auto_resolved'] } },
          orderBy: [{ hit_count: 'desc' }, { last_seen_at: 'desc' }],
          take: 20,
        }),
        prisma.knowledge_conflicts.groupBy({
          by: ['status'],
          where: { village_id: villageId },
          _count: true,
        }),
      ])
      topConflicts = conflicts.map(c => ({
        id: c.id,
        source1: c.source1_title,
        source2: c.source2_title,
        summary: c.content_summary,
        similarity: c.similarity_score,
        hitCount: c.hit_count,
        status: c.status,
        autoResolved: c.auto_resolved,
        firstSeen: c.first_seen_at,
        lastSeen: c.last_seen_at,
        query: c.query_text,
        resolutionNote: c.resolution_note,
      }))
      for (const sc of conflictCounts) {
        conflictStatusCounts[sc.status] = sc._count
      }
      conflictsAvailable = true
      conflictSource = 'database'
    } catch (e) { console.log('Knowledge conflicts DB unavailable') }

    let latestEvalRun: any = null
    let evaluationAvailable = false
    try {
      const evalRun = await prisma.ai_golden_set_runs.findFirst({
        where: {
          OR: [
            { village_id: villageId },
            { village_id: null },
          ],
        },
        orderBy: { completed_at: 'desc' },
        include: {
          items: {
            orderBy: [{ score: 'asc' }, { latency_ms: 'desc' }],
            take: 20,
          },
        },
      })

      evaluationAvailable = true
      if (evalRun) {
        latestEvalRun = {
          runId: evalRun.run_id,
          total: evalRun.total,
          overallAccuracy: evalRun.overall_accuracy,
          intentAccuracy: evalRun.intent_accuracy,
          toolAccuracy: evalRun.tool_accuracy,
          keywordAccuracy: evalRun.keyword_accuracy,
          regressionDetected: evalRun.regression_detected,
          releaseGatePass: evalRun.release_gate_pass,
          thresholds: evalRun.thresholds,
          status: evalRun.status,
          startedAt: evalRun.started_at,
          completedAt: evalRun.completed_at,
          items: evalRun.items.map((item) => ({
            id: item.id,
            query: item.query,
            expectedIntent: item.expected_intent,
            expectedTools: item.expected_tools,
            actualTools: item.actual_tools,
            predictedIntent: item.predicted_intent,
            replyText: item.reply_text,
            intentMatch: item.intent_match,
            toolMatch: item.tool_match,
            toolScore: item.tool_score,
            keywordMatch: item.keyword_match,
            keywordScore: item.keyword_score,
            retrievalMatch: item.retrieval_match,
            retrievalScore: item.retrieval_score,
            retrievalMetrics: item.retrieval_metrics,
            score: item.score,
            traceScore: item.trace_score,
            traceGrade: item.trace_grade,
            latencyMs: item.latency_ms,
            scenario: item.scenario,
            traceId: item.trace_id,
          })),
        }
      }
    } catch (e) { console.log('Golden set DB unavailable') }

    // Calculate knowledge coverage
    // Runtime AI stats can reset with the AI service; DB gaps are persistent but only represent misses.
    const aiTotalQueries = analyticsData?.totalQueries || analyticsData?.total_queries || 0
    const aiKnowledgeHits = knowledgeData?.hits || flow.knowledge_hit || flow.knowledgeHit || 0
    const aiKnowledgeMisses = knowledgeData?.misses || flow.knowledge_miss || flow.knowledgeMiss || 0
    const fallbackCount = flow.fallback || flow.fallbackCount || 0
    const persistentGapCount = (gapStatusCounts.open + gapStatusCounts.resolved + gapStatusCounts.ignored) || 0
    const overviewSource = aiTotalQueries > 0
      ? 'runtime'
      : persistentGapCount > 0
        ? 'persistent_gap_fallback'
        : 'unavailable'
    const totalQueries = overviewSource === 'runtime' ? aiTotalQueries : persistentGapCount
    const knowledgeHits = overviewSource === 'runtime' ? aiKnowledgeHits : 0
    const knowledgeMisses = overviewSource === 'runtime'
      ? aiKnowledgeMisses
      : overviewSource === 'persistent_gap_fallback'
        ? gapStatusCounts.open || 0
        : 0
    const hitRate = overviewSource === 'runtime' && totalQueries > 0
      ? ((knowledgeHits / totalQueries) * 100).toFixed(1)
      : null
    const missRate = overviewSource === 'runtime' && totalQueries > 0
      ? ((knowledgeMisses / totalQueries) * 100).toFixed(1)
      : null
    const knowledgeConsistencySummary = consistencySummaryData?.summary || {
      total: 0,
      byKind: {},
      bySeverity: {},
      byStatus: {},
    }
    const knowledgeConsistencyItems = Array.isArray(consistencyListData?.items)
      ? consistencyListData.items.map((item: any) => ({
          id: item.id,
          kind: item.kind,
          severity: item.severity,
          status: item.status,
          topicHint: item.topic_hint,
          sourceATitle: item.source_a_title,
          sourceBTitle: item.source_b_title,
          snippetA: item.snippet_a,
          snippetB: item.snippet_b,
          similarityScore: item.similarity_score,
          detectedAt: item.detected_at,
          resolutionNote: item.resolution_note,
        }))
      : []
    const openKnowledgeConsistencyCount = knowledgeConsistencySummary.byStatus.open || 0
    const useCanonicalConflictView = openKnowledgeConsistencyCount > 0 || knowledgeConsistencyItems.length > 0

    if (useCanonicalConflictView) {
      conflictStatusCounts = {
        open: openKnowledgeConsistencyCount,
        resolved: knowledgeConsistencySummary.byStatus.resolved || 0,
        auto_resolved: 0,
        ignored: knowledgeConsistencySummary.byStatus.ignored || 0,
      }
      topConflicts = []
      conflictSource = 'knowledge_consistency'
    }

    return NextResponse.json({
      overview: {
        totalQueries,
        knowledgeHits,
        knowledgeMisses,
        fallbackCount,
        hitRate,
        missRate,
        source: overviewSource,
        isPartial: overviewSource !== 'runtime',
        caveat: overviewSource === 'runtime'
          ? null
          : overviewSource === 'persistent_gap_fallback'
            ? 'Runtime AI stats belum tersedia atau baru reset. Angka ini hanya memakai gap tersimpan, bukan total interaksi dan bukan hit-rate penuh.'
            : 'Belum ada runtime analytics atau gap tersimpan untuk desa ini.',
      },
      metricSources: {
        overview: overviewSource,
        gaps: gapsAvailable ? 'database' : 'unavailable',
        conflicts: conflictSource,
        evaluation: evaluationAvailable ? 'database' : 'unavailable',
        retrievalObservability: retrievalData ? 'ai-service' : 'unavailable',
        memoryObservability: memoryData ? 'ai-service' : 'unavailable',
        guardrailObservability: guardrailData ? 'ai-service' : 'unavailable',
        toolPolicyObservability: toolPolicyData ? 'ai-service' : 'unavailable',
      },
      dataFreshness: {
        generatedAt: new Date().toISOString(),
        runtimeStatsAvailable: aiTotalQueries > 0,
        persistentGapsAvailable: gapsAvailable,
        persistentConflictsAvailable: conflictsAvailable,
        latestEvalAvailable: !!latestEvalRun,
        knowledgeConsistencyAvailable: knowledgeConsistencySummary.total > 0 || knowledgeConsistencyItems.length > 0,
      },
      intents: Array.isArray(intents)
        ? intents.slice(0, 20).map((i: any) => ({
            intent: i.intent || i.name || 'unknown',
            count: i.count || i.total || 0,
            avgConfidence: i.avgConfidence || i.avg_confidence || i.percentage || 0,
          }))
        : [],
      flow,
      knowledgeGaps: {
        topGaps,
        statusCounts: gapStatusCounts,
        totalOpen: gapStatusCounts.open,
      },
      knowledgeConflicts: {
        source: conflictSource,
        topConflicts,
        statusCounts: conflictStatusCounts,
        totalOpen: conflictStatusCounts.open,
        totalAutoResolved: conflictStatusCounts.auto_resolved,
      },
      knowledgeConsistency: {
        summary: knowledgeConsistencySummary,
        items: knowledgeConsistencyItems,
      },
      retrievalObservability: retrievalData,
      memoryObservability: memoryData,
      guardrailObservability: guardrailData,
      toolPolicyObservability: toolPolicyData,
      evaluation: latestEvalRun,
      rawAnalytics: analyticsData,
    })
  } catch (error) {
    console.error('Error fetching knowledge analytics:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
