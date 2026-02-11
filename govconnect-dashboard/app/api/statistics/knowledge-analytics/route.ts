import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { ai } from '@/lib/api-client'
import prisma from '@/lib/prisma'

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

    // Fetch AI analytics data
    let analyticsData = null
    try {
      const res = await ai.getAnalytics()
      if (res.ok) analyticsData = await res.json()
    } catch (e) { console.log('AI analytics unavailable') }

    // Fetch intent stats
    let intentData = null
    try {
      const res = await ai.getAnalyticsIntents()
      if (res.ok) intentData = await res.json()
    } catch (e) { console.log('AI intents unavailable') }

    // Fetch flow data for knowledge hit/miss info
    let flowData = null
    try {
      const res = await ai.getAnalyticsFlow()
      if (res.ok) flowData = await res.json()
    } catch (e) { console.log('AI flow unavailable') }

    // Fetch real-time knowledge stats from AI service
    let knowledgeData = null
    try {
      const res = await ai.getAnalyticsKnowledge()
      if (res.ok) knowledgeData = await res.json()
    } catch (e) { console.log('AI knowledge stats unavailable') }

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
            avgConfidence: i.avgConfidence || i.avg_confidence || 0,
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
      rawAnalytics: analyticsData,
    })
  } catch (error) {
    console.error('Error fetching knowledge analytics:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
