import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession, resolveVillageId } from '@/lib/auth'
import { caseService } from '@/lib/api-client'

export async function GET(request: NextRequest) {
  try {
    // Get admin session with village_id
    const session = await getAdminSession(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get village_id from session (required for village_admin, optional for superadmin)
    const villageId = resolveVillageId(request, session)

    // Get period from query params
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'weekly'

    // Forward request to case service
    try {
      const response = await caseService.getTrends(period, villageId || undefined)

      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }

      console.error('Case service trends error:', await response.text())
    } catch (error) {
      console.log('Case service not available for trends:', error)
    }

    // Return empty data if case service not available
    return NextResponse.json({
      period,
      labels: [],
      trends: {
        complaints: [],
        services: [],
        total: [],
      },
      predictions: {
        labels: [],
        values: [],
      },
      peakAnalysis: {
        peakHour: { hour: 0, count: 0, label: 'N/A' },
        peakDay: { day: 0, count: 0, label: 'N/A' },
        hourlyDistribution: Array(24).fill(0),
        dailyDistribution: Array(7).fill(0),
      },
      categoryTrends: [],
      summary: {
        totalComplaints: 0,
        totalServices: 0,
        avgPerPeriod: 0,
        growthRate: 0,
      },
    })
  } catch (error) {
    console.error('Error fetching trends:', error)
    return NextResponse.json(
      { error: 'Failed to fetch trends' },
      { status: 500 }
    )
  }
}
