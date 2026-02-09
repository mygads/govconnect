import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth'
import { buildUrl, getHeaders, apiFetch, ServicePath, AI_SERVICE_URL } from '@/lib/api-client'

// GET - Check LLM connectivity and model info
export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request)
    if (!session || session.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const results: any = {
      timestamp: new Date().toISOString(),
      aiServiceStatus: 'unknown',
      llmTests: [],
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

    // 3. Test LLM with a lightweight ping (minimal tokens ~20)
    try {
      const start = Date.now()
      const testRes = await apiFetch(buildUrl(ServicePath.AI, '/api/testing/ping'), {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({}),
        timeout: 15000,
      })
      const elapsed = Date.now() - start

      if (testRes.ok) {
        const testData = await testRes.json()
        results.llmTests.push({
          name: 'LLM Connection Test',
          status: 'connected',
          responseTime: testData.responseTime || elapsed,
          details: testData,
        })
      } else {
        results.llmTests.push({
          name: 'LLM Connection Test',
          status: 'error',
          responseTime: elapsed,
          error: `HTTP ${testRes.status}`,
        })
      }
    } catch (e: any) {
      results.llmTests.push({
        name: 'LLM Connection Test',
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
