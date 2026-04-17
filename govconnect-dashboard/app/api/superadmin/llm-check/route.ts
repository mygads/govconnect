import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getHeaders, apiFetch, ServicePath, AI_SERVICE_URL } from '@/lib/api-client'

type LaneName = 'llm' | 'embed' | 'rag' | 'rerank'

interface LaneCheckResult {
  lane: LaneName
  label: string
  status: string
  responseTime: number
  provider?: string
  model?: string
  error?: string
  details?: any
}

function laneLabel(lane: LaneName): string {
  switch (lane) {
    case 'embed':
      return 'Embedding Lane'
    case 'rag':
      return 'RAG Rewrite Lane'
    case 'rerank':
      return 'Rerank Lane'
    default:
      return 'LLM Lane'
  }
}

function normalizeLaneChecks(payload: any): LaneCheckResult[] {
  const tests = payload?.tests
  if (!tests || typeof tests !== 'object') {
    return []
  }

  const order: LaneName[] = ['llm', 'embed', 'rag', 'rerank']
  const checks: LaneCheckResult[] = []

  for (const lane of order) {
    const item = tests[lane]
    if (!item || typeof item !== 'object') {
      continue
    }

    checks.push({
      lane,
      label: laneLabel(lane),
      status: typeof item.status === 'string' ? item.status : 'unknown',
      responseTime: typeof item.responseTime === 'number' ? item.responseTime : 0,
      provider: typeof item.provider === 'string' ? item.provider : undefined,
      model: typeof item.model === 'string' ? item.model : undefined,
      error: typeof item.error === 'string' ? item.error : undefined,
      details: item.details,
    })
  }

  return checks
}

// GET - Check AI gateway lane connectivity and model info
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session || session.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const results: any = {
      timestamp: new Date().toISOString(),
      aiServiceStatus: 'unknown',
      laneChecks: [],
    }

    // 1. Check AI service health
    try {
      const start = Date.now()
      const healthRes = await apiFetch(`${AI_SERVICE_URL}/health`, {
        headers: getHeaders(),
        timeout: 8000,
      })
      results.aiServiceStatus = healthRes.ok ? 'healthy' : 'unhealthy'
      results.aiServiceResponseTime = Date.now() - start

      if (healthRes.ok) {
        const healthData = await healthRes.json()
        results.aiServiceDetails = healthData
      }
    } catch (e: any) {
      results.aiServiceStatus = 'unreachable'
      results.aiServiceError = e.message
    }

    // 2. Check models info via AI service stats
    try {
      const modelsRes = await apiFetch(buildUrl(ServicePath.AI, '/stats/models'), {
        headers: getHeaders(),
        timeout: 10000,
      })
      if (modelsRes.ok) {
        results.models = await modelsRes.json()
      }
    } catch (e) {
      results.models = null
    }

    // 3. Test all configured gateway lanes
    try {
      const start = Date.now()
      const testRes = await apiFetch(buildUrl(ServicePath.AI, '/api/testing/ping'), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({}),
        timeout: 15000,
      })
      const elapsed = Date.now() - start

      const testData = await testRes.json().catch(() => null)
      results.pingDetails = testData
      results.laneChecks = normalizeLaneChecks(testData)

      if (results.laneChecks.length === 0) {
        results.laneChecks = [{
          lane: 'llm',
          label: 'Gateway Ping',
          status: testRes.ok ? 'connected' : 'error',
          responseTime: testData?.responseTime || elapsed,
          error: testRes.ok ? undefined : `HTTP ${testRes.status}`,
          details: testData,
        }]
      }
    } catch (e: any) {
      results.laneChecks.push({
        lane: 'llm',
        label: 'Gateway Ping',
        status: 'failed',
        responseTime: 0,
        error: e.message,
      })
    }

    return NextResponse.json(results)
  } catch (error) {
    console.error('Error checking LLM connectivity:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
