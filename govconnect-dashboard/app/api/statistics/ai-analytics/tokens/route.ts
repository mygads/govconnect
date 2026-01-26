import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { ai } from '@/lib/api-client'

// Gemini pricing per 1M tokens (in USD) - December 2025
// https://ai.google.dev/pricing - Updated December 2025
const GEMINI_PRICING: Record<string, { input: number; output: number; description: string }> = {
  // Gemini 2.5 Flash - Hybrid reasoning model, 1M context, best price/performance
  'gemini-2.5-flash': { input: 0.30, output: 2.50, description: 'Hybrid reasoning, 1M context, thinking budget' },
  // Gemini 2.5 Flash-Lite - Smallest, most cost-efficient
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40, description: 'Smallest, cost-efficient, high throughput' },
  // Gemini 2.0 Flash - Balanced multimodal, 1M context
  'gemini-2.0-flash': { input: 0.10, output: 0.40, description: 'Balanced multimodal, 1M context' },
  // Gemini 2.0 Flash-Lite - Legacy cost-efficient
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.30, description: 'Legacy cost-efficient' },
}

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization')
    const token = request.cookies.get('token')?.value || authHeader?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Only superadmin can access
    if (payload.role !== 'superadmin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Forward request to AI service
    try {
      const response = await ai.getAnalyticsTokens()

      if (response.ok) {
        const data = await response.json()
        
        // Map the response to match dashboard expected format
        const mappedData = {
          totalInputTokens: data.total?.input || 0,
          totalOutputTokens: data.total?.output || 0,
          totalTokens: (data.total?.input || 0) + (data.total?.output || 0),
          estimatedCostUSD: data.total?.cost || 0,
          // Map byModel to include pricing info
          byModel: data.byModel?.reduce((acc: Record<string, any>, model: any) => {
            const pricing = GEMINI_PRICING[model.model] || { input: 0.10, output: 0.40 }
            acc[model.model] = {
              input: model.input,
              output: model.output,
              cost: model.cost,
              calls: model.calls,
              pricing: {
                inputPer1M: pricing.input,
                outputPer1M: pricing.output,
              },
            }
            return acc
          }, {}) || {},
          // Map last30Days to byDate format for chart
          byDate: (data.last30Days || []).slice(-7).map((day: any) => ({
            date: day.date,
            tokens: (day.input || 0) + (day.output || 0),
            inputTokens: day.input || 0,
            outputTokens: day.output || 0,
            cost: day.cost || 0,
          })),
          // Keep full 30 days data for weekly/monthly summaries
          last30Days: data.last30Days || [],
          // Add pricing reference (simplified for frontend)
          modelPricing: Object.fromEntries(
            Object.entries(GEMINI_PRICING).map(([model, p]) => [model, { input: p.input, output: p.output }])
          ),
        }
        
        return NextResponse.json(mappedData)
      }
    } catch (error) {
      console.log('AI service not available:', error)
    }

    return NextResponse.json({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      estimatedCostUSD: 0,
      byModel: {},
      byDate: [],
      last30Days: [],
      modelPricing: Object.fromEntries(
        Object.entries(GEMINI_PRICING).map(([model, p]) => [model, { input: p.input, output: p.output }])
      ),
    })
  } catch (error) {
    console.error('Error fetching token usage:', error)
    return NextResponse.json(
      { error: 'Failed to fetch token usage' },
      { status: 500 }
    )
  }
}
