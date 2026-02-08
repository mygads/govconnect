import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { ai } from '@/lib/api-client'

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

    // Build analytics response
    const intents = intentData?.intents || intentData?.data || []
    const flow = flowData?.flow || flowData?.data || flowData || {}

    // Calculate knowledge coverage
    const totalQueries = analyticsData?.totalQueries || analyticsData?.total_queries || 0
    const knowledgeHits = flow.knowledge_hit || flow.knowledgeHit || 0
    const knowledgeMisses = flow.knowledge_miss || flow.knowledgeMiss || 0
    const fallbackCount = flow.fallback || flow.fallbackCount || 0

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
      rawAnalytics: analyticsData,
    })
  } catch (error) {
    console.error('Error fetching knowledge analytics:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
