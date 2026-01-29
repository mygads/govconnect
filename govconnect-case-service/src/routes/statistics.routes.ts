import { Router, Request, Response } from 'express'
import prisma from '../config/database'
import logger from '../utils/logger'
import { getQuery } from '../utils/http'

const router: Router = Router()

router.get('/overview', async (req: Request, res: Response) => {
  try {
    // Get complaint statistics
    const [
      totalLaporan,
      laporanBaru,
      laporanProses,
      laporanSelesai,
      laporanDitolak,
    ] = await Promise.all([
      prisma.complaint.count(),
      prisma.complaint.count({ where: { status: 'baru' } }),
      prisma.complaint.count({ where: { status: 'proses' } }),
      prisma.complaint.count({ where: { status: 'selesai' } }),
      prisma.complaint.count({ where: { status: 'ditolak' } }),
    ])

    // Get service request statistics
    const [
      totalLayanan,
      layananBaru,
      layananProses,
      layananSelesai,
      layananDitolak,
    ] = await Promise.all([
      prisma.serviceRequest.count(),
      prisma.serviceRequest.count({ where: { status: 'baru' } }),
      prisma.serviceRequest.count({ where: { status: 'proses' } }),
      prisma.serviceRequest.count({ where: { status: 'selesai' } }),
      prisma.serviceRequest.count({ where: { status: 'ditolak' } }),
    ])

    // Get recent activity counts
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const [laporanHariIni, layananHariIni] = await Promise.all([
      prisma.complaint.count({
        where: {
          created_at: {
            gte: today,
          },
        },
      }),
      prisma.serviceRequest.count({
        where: {
          created_at: {
            gte: today,
          },
        },
      }),
    ])

    const statistics = {
      totalLaporan,
      totalLayanan,
      laporan: {
        baru: laporanBaru,
        proses: laporanProses,
        selesai: laporanSelesai,
        ditolak: laporanDitolak,
        hariIni: laporanHariIni,
      },
      layanan: {
        baru: layananBaru,
        proses: layananProses,
        selesai: layananSelesai,
        ditolak: layananDitolak,
        hariIni: layananHariIni,
      },
    }

    logger.info('Statistics fetched successfully', { 
      service: 'case-service',
      statistics 
    })

    res.json(statistics)
  } catch (error) {
    logger.error('Error fetching statistics', { 
      service: 'case-service',
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
    
    res.status(500).json({ 
      error: 'Failed to fetch statistics' 
    })
  }
})

router.get('/by-category', async (req: Request, res: Response) => {
  try {
    const complaints = await prisma.complaint.groupBy({
      by: ['kategori'],
      _count: {
        kategori: true,
      },
      orderBy: {
        _count: {
          kategori: 'desc',
        },
      },
    })

    const data = complaints.map((item) => ({
      kategori: item.kategori,
      count: item._count.kategori,
    }))

    res.json(data)
  } catch (error) {
    logger.error('Error fetching category statistics', { 
      service: 'case-service',
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
    
    res.status(500).json({ 
      error: 'Failed to fetch category statistics' 
    })
  }
})

router.get('/by-status', async (req: Request, res: Response) => {
  try {
    const [complaintsByStatus, servicesByStatus] = await Promise.all([
      prisma.complaint.groupBy({
        by: ['status'],
        _count: {
          status: true,
        },
      }),
      prisma.serviceRequest.groupBy({
        by: ['status'],
        _count: {
          status: true,
        },
      }),
    ])

    const data = {
      complaints: complaintsByStatus.map((item) => ({
        status: item.status,
        count: item._count.status,
      })),
      services: servicesByStatus.map((item) => ({
        status: item.status,
        count: item._count.status,
      })),
    }

    res.json(data)
  } catch (error) {
    logger.error('Error fetching status statistics', { 
      service: 'case-service',
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
    
    res.status(500).json({ 
      error: 'Failed to fetch status statistics' 
    })
  }
})

router.get('/trends', async (req: Request, res: Response) => {
  try {
    const period = getQuery(req, 'period') || 'weekly' // weekly, monthly
    const now = new Date()
    
    // Calculate date ranges
    const daysBack = period === 'monthly' ? 365 : 84 // 12 months or 12 weeks
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000)
    
    // Get all complaints in the period
    const complaints = await prisma.complaint.findMany({
      where: {
        created_at: {
          gte: startDate,
        },
      },
      select: {
        created_at: true,
        kategori: true,
        status: true,
      },
      orderBy: {
        created_at: 'asc',
      },
    })

    // Get all service requests in the period
    const services = await prisma.serviceRequest.findMany({
      where: {
        created_at: {
          gte: startDate,
        },
      },
      select: {
        created_at: true,
        status: true,
      },
      orderBy: {
        created_at: 'asc',
      },
    })

    // Group by period (week or month)
    const trendData: { [key: string]: { complaints: number; services: number } } = {}
    const hourlyData: { [hour: number]: number } = {}
    const dailyData: { [day: number]: number } = {} // 0 = Sunday, 6 = Saturday
    const categoryTrends: { [key: string]: { [period: string]: number } } = {}
    
    // Initialize hourly and daily data
    for (let h = 0; h < 24; h++) hourlyData[h] = 0
    for (let d = 0; d < 7; d++) dailyData[d] = 0

    // Process complaints
    complaints.forEach((c) => {
      const date = new Date(c.created_at)
      const periodKey = period === 'monthly' 
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : getWeekKey(date)
      
      if (!trendData[periodKey]) {
        trendData[periodKey] = { complaints: 0, services: 0 }
      }
      trendData[periodKey].complaints++
      
      // Peak hours analysis
      hourlyData[date.getHours()]++
      dailyData[date.getDay()]++
      
      // Category trends
      if (!categoryTrends[c.kategori]) {
        categoryTrends[c.kategori] = {}
      }
      if (!categoryTrends[c.kategori][periodKey]) {
        categoryTrends[c.kategori][periodKey] = 0
      }
      categoryTrends[c.kategori][periodKey]++
    })

    // Process services
    services.forEach((s) => {
      const date = new Date(s.created_at)
      const periodKey = period === 'monthly'
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : getWeekKey(date)
      
      if (!trendData[periodKey]) {
        trendData[periodKey] = { complaints: 0, services: 0 }
      }
      trendData[periodKey].services++
      
      // Also count services for hourly/daily analysis
      hourlyData[date.getHours()]++
      dailyData[date.getDay()]++
    })

    // Convert to sorted arrays
    const sortedPeriods = Object.keys(trendData).sort()
    const trendLabels = sortedPeriods.map((p) => formatPeriodLabel(p, period))
    const complaintTrend = sortedPeriods.map((p) => trendData[p].complaints)
    const serviceTrend = sortedPeriods.map((p) => trendData[p].services)
    const totalTrend = sortedPeriods.map((p) => trendData[p].complaints + trendData[p].services)

    // Calculate predictions using simple moving average
    const predictions = calculatePredictions(totalTrend, 4)

    // Find peak hours and days
    const peakHour = Object.entries(hourlyData).reduce((a, b) => a[1] > b[1] ? a : b)
    const peakDay = Object.entries(dailyData).reduce((a, b) => a[1] > b[1] ? a : b)
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

    // Format category trends
    const formattedCategoryTrends = Object.entries(categoryTrends).map(([kategori, data]) => ({
      kategori,
      data: sortedPeriods.map((p) => data[p] || 0),
    }))

    // Calculate growth rate
    const recentPeriods = complaintTrend.slice(-4)
    const previousPeriods = complaintTrend.slice(-8, -4)
    const recentAvg = recentPeriods.length > 0 ? recentPeriods.reduce((a, b) => a + b, 0) / recentPeriods.length : 0
    const previousAvg = previousPeriods.length > 0 ? previousPeriods.reduce((a, b) => a + b, 0) / previousPeriods.length : 0
    const growthRate = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg * 100).toFixed(1) : 0

    res.json({
      period,
      labels: trendLabels,
      trends: {
        complaints: complaintTrend,
        services: serviceTrend,
        total: totalTrend,
      },
      predictions: {
        labels: predictions.labels,
        values: predictions.values,
      },
      peakAnalysis: {
        peakHour: {
          hour: parseInt(peakHour[0]),
          count: peakHour[1],
          label: `${peakHour[0]}:00 - ${parseInt(peakHour[0]) + 1}:00`,
        },
        peakDay: {
          day: parseInt(peakDay[0]),
          count: peakDay[1],
          label: dayNames[parseInt(peakDay[0])],
        },
        hourlyDistribution: Object.values(hourlyData),
        dailyDistribution: Object.values(dailyData),
      },
      categoryTrends: formattedCategoryTrends,
      summary: {
        totalComplaints: complaints.length,
        totalServices: services.length,
        avgPerPeriod: sortedPeriods.length > 0 
          ? Math.round((complaints.length + services.length) / sortedPeriods.length) 
          : 0,
        growthRate: parseFloat(growthRate as string) || 0,
      },
    })
  } catch (error) {
    logger.error('Error fetching trend statistics', { 
      service: 'case-service',
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
    
    res.status(500).json({ 
      error: 'Failed to fetch trend statistics' 
    })
  }
})

// Helper function to get week key (YYYY-Www)
function getWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

// Helper function to format period labels
function formatPeriodLabel(periodKey: string, period: string): string {
  if (period === 'monthly') {
    const [year, month] = periodKey.split('-')
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
    return `${monthNames[parseInt(month) - 1]} ${year}`
  } else {
    // Weekly format: YYYY-Www -> Minggu ke-ww
    const [year, week] = periodKey.split('-W')
    return `M${week} ${year.slice(2)}`
  }
}

// Helper function to calculate simple predictions
function calculatePredictions(data: number[], periods: number): { labels: string[]; values: number[] } {
  if (data.length < 3) {
    return { labels: [], values: [] }
  }
  
  // Use exponential smoothing with trend
  const alpha = 0.3 // Smoothing factor
  const beta = 0.2 // Trend factor
  
  let level = data[0]
  let trend = data.length > 1 ? data[1] - data[0] : 0
  
  // Update level and trend for all data points
  for (let i = 1; i < data.length; i++) {
    const prevLevel = level
    level = alpha * data[i] + (1 - alpha) * (level + trend)
    trend = beta * (level - prevLevel) + (1 - beta) * trend
  }
  
  // Generate predictions
  const labels: string[] = []
  const values: number[] = []
  
  for (let i = 1; i <= periods; i++) {
    labels.push(`+${i}`)
    values.push(Math.max(0, Math.round(level + trend * i)))
  }
  
  return { labels, values }
}

export default router
