import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { ai } from '@/lib/api-client'
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

    const [
      analyticsData,
      intentData,
      flowData,
      knowledgeData,
      retrievalData,
    ] = await Promise.all([
      safeJson(() => ai.getAnalytics({ village_id: villageId })),
      safeJson(() => ai.getAnalyticsIntents({ village_id: villageId })),
      safeJson(() => ai.getAnalyticsFlow({ village_id: villageId })),
      safeJson(() => ai.getAnalyticsKnowledge({ village_id: villageId })),
      safeJson(() => ai.getAnalyticsRetrieval({ village_id: villageId })),
    ])

    // Build analytics response
    const intents = intentData?.intents || intentData?.data || []
    const flow = flowData?.flow || flowData?.data || flowData || {}

    // Fetch persistent knowledge gaps from DB (needed for both gap table AND fallback stats)
    let topGaps: any[] = []
    let gapStatusCounts: Record<string, number> = { open: 0, resolved: 0, ignored: 0 }
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
      }))
      for (const sc of statusCounts) {
        gapStatusCounts[sc.status] = sc._count
      }
    } catch (e) { console.log('Knowledge gaps DB unavailable') }

    // Fetch knowledge conflicts from DB
    let topConflicts: any[] = []
    let conflictStatusCounts: Record<string, number> = { open: 0, resolved: 0, auto_resolved: 0, ignored: 0 }
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
      }))
      for (const sc of conflictCounts) {
        conflictStatusCounts[sc.status] = sc._count
      }
    } catch (e) { console.log('Knowledge conflicts DB unavailable') }

    // Calculate knowledge coverage
    // Prefer real-time AI stats; if AI service has reset (all zeros), use DB-based counts as fallback
    const aiTotalQueries = analyticsData?.totalQueries || analyticsData?.total_queries || 0
    const aiKnowledgeHits = knowledgeData?.hits || flow.knowledge_hit || flow.knowledgeHit || 0
    const aiKnowledgeMisses = knowledgeData?.misses || flow.knowledge_miss || flow.knowledgeMiss || 0
    const fallbackCount = flow.fallback || flow.fallbackCount || 0

    // If AI in-memory stats are zero (e.g., after restart), use DB gap counts as miss indicator
    const totalQueries = aiTotalQueries > 0 ? aiTotalQueries : (gapStatusCounts.open + gapStatusCounts.resolved + gapStatusCounts.ignored) || 0
    const knowledgeHits = aiKnowledgeHits
    const knowledgeMisses = aiKnowledgeMisses > 0 ? aiKnowledgeMisses : gapStatusCounts.open || 0

    return NextResponse.json({
      overview: {
        totalQueries,
        knowledgeHits,
        knowledgeMisses,
        fallbackCount,
        hitRate: totalQueries > 0 ? ((knowledgeHits / totalQueries) * 100).toFixed(1) : 0,
        missRate: totalQueries > 0 ? ((knowledgeMisses / totalQueries) * 100).toFixed(1) : 0,
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
        topConflicts,
        statusCounts: conflictStatusCounts,
        totalOpen: conflictStatusCounts.open,
        totalAutoResolved: conflictStatusCounts.auto_resolved,
      },
      retrievalObservability: retrievalData,
      rawAnalytics: analyticsData,
    })
  } catch (error) {
    console.error('Error fetching knowledge analytics:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
