import { Router, Request, Response } from 'express'
import prisma from '../config/database'
import logger from '../utils/logger'
import { getQuery } from '../utils/http'
import { internalAuth } from '../middleware/auth.middleware'

const router: Router = Router()

// Cache control middleware for statistics endpoints (60s browser cache)
router.use((_req: Request, res: Response, next) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
  next();
});

router.get('/overview', internalAuth, async (req: Request, res: Response) => {
  try {
    const village_id = getQuery(req, 'village_id') || undefined;
    const complaintWhere: any = village_id ? { village_id } : {};
    const serviceWhere: any = village_id ? { service: { village_id } } : {};

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Get statistics using groupBy (optimized)
    const [
      complaintStats,
      serviceStats,
      todayComplaintCount,
      todayServiceCount,
      totalComplaints,
      totalServices
    ] = await Promise.all([
      // Group by status for complaints
      prisma.complaint.groupBy({
        by: ['status'],
        where: complaintWhere,
        _count: { status: true }
      }),
      // Group by status for services
      prisma.serviceRequest.groupBy({
        by: ['status'],
        where: serviceWhere,
        _count: { status: true }
      }),
      // Today counts
      prisma.complaint.count({ where: { ...complaintWhere, created_at: { gte: today } } }),
      prisma.serviceRequest.count({ where: { ...serviceWhere, created_at: { gte: today } } }),
      // Total counts (could sum from groupBy, but this is safer if status is nullable or strictly needed)
      prisma.complaint.count({ where: complaintWhere }),
      prisma.serviceRequest.count({ where: serviceWhere })
    ])

    // Helper to extract count from groupBy result
    const getCount = (arr: any[], status: string) => 
      arr.find(x => x.status === status)?._count.status || 0;

    const statistics = {
      totalLaporan: totalComplaints,
      totalLayanan: totalServices,
      laporan: {
        open: getCount(complaintStats, 'OPEN'),
        process: getCount(complaintStats, 'PROCESS'),
        done: getCount(complaintStats, 'DONE'),
        canceled: getCount(complaintStats, 'CANCELED'),
        reject: getCount(complaintStats, 'REJECT'),
        hariIni: todayComplaintCount,
      },
      layanan: {
        open: getCount(serviceStats, 'OPEN'),
        process: getCount(serviceStats, 'PROCESS'),
        done: getCount(serviceStats, 'DONE'),
        canceled: getCount(serviceStats, 'CANCELED'),
        reject: getCount(serviceStats, 'REJECT'),
        hariIni: todayServiceCount,
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

router.get('/by-category', internalAuth, async (req: Request, res: Response) => {
  try {
    const village_id = getQuery(req, 'village_id') || undefined;
    const complaints = await prisma.complaint.groupBy({
      by: ['kategori'],
      where: village_id ? { village_id } : undefined,
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

router.get('/by-status', internalAuth, async (req: Request, res: Response) => {
  try {
    const village_id = getQuery(req, 'village_id') || undefined;
    const complaintWhere = village_id ? { village_id } : undefined;
    const serviceWhere = village_id ? { service: { village_id } } : undefined;

    const [complaintsByStatus, servicesByStatus] = await Promise.all([
      prisma.complaint.groupBy({
        by: ['status'],
        where: complaintWhere,
        _count: {
          status: true,
        },
      }),
      prisma.serviceRequest.groupBy({
        by: ['status'],
        where: serviceWhere,
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

router.get('/trends', internalAuth, async (req: Request, res: Response) => {
  try {
    const period = getQuery(req, 'period') || 'weekly' // weekly, monthly
    const village_id = getQuery(req, 'village_id') || undefined;
    const now = new Date()
    
    // Calculate date ranges
    const daysBack = period === 'monthly' ? 365 : 84
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000)

    // Using raw SQL for optimized aggregation with parameterized queries
    const truncType = period === 'monthly' ? 'month' : 'week';
    
    // 1. Complaint Trends (parameterized to prevent SQL injection)
    const complaintTrendRaw = village_id
      ? await prisma.$queryRawUnsafe<any[]>(`
          SELECT DATE_TRUNC($1, created_at) as date, COUNT(*)::int as count 
          FROM "Complaint" 
          WHERE created_at >= $2 AND village_id = $3
          GROUP BY 1 ORDER BY 1
        `, truncType, startDate, village_id)
      : await prisma.$queryRawUnsafe<any[]>(`
          SELECT DATE_TRUNC($1, created_at) as date, COUNT(*)::int as count 
          FROM "Complaint" 
          WHERE created_at >= $2
          GROUP BY 1 ORDER BY 1
        `, truncType, startDate);

    // 2. Service Trends
    // ServiceRequest -> Service -> village_id
    const serviceTrendRaw = village_id
      ? await prisma.$queryRawUnsafe<any[]>(`
          SELECT DATE_TRUNC($1, sr.created_at) as date, COUNT(*)::int as count 
          FROM "ServiceRequest" sr
          JOIN "Service" s ON sr.service_id = s.id 
          WHERE s.village_id = $3 AND sr.created_at >= $2
          GROUP BY 1 ORDER BY 1
        `, truncType, startDate, village_id)
      : await prisma.$queryRawUnsafe<any[]>(`
          SELECT DATE_TRUNC($1, created_at) as date, COUNT(*)::int as count 
          FROM "ServiceRequest" sr
          WHERE sr.created_at >= $2
          GROUP BY 1 ORDER BY 1
        `, truncType, startDate);

    // 3. Category Trends (Complaints)
    const categoryTrendRaw = village_id
      ? await prisma.$queryRawUnsafe<any[]>(`
          SELECT kategori, DATE_TRUNC($1, created_at) as date, COUNT(*)::int as count 
          FROM "Complaint"
          WHERE created_at >= $2 AND village_id = $3
          GROUP BY 1, 2 ORDER BY 2
        `, truncType, startDate, village_id)
      : await prisma.$queryRawUnsafe<any[]>(`
          SELECT kategori, DATE_TRUNC($1, created_at) as date, COUNT(*)::int as count 
          FROM "Complaint"
          WHERE created_at >= $2
          GROUP BY 1, 2 ORDER BY 2
        `, truncType, startDate);

    // 4. Hourly Distribution (Complaints + Services)
    const hourlyComplaint = village_id
      ? await prisma.$queryRawUnsafe<any[]>(`
          SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*)::int as count
          FROM "Complaint"
          WHERE created_at >= $1 AND village_id = $2
          GROUP BY 1
        `, startDate, village_id)
      : await prisma.$queryRawUnsafe<any[]>(`
          SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*)::int as count
          FROM "Complaint"
          WHERE created_at >= $1
          GROUP BY 1
        `, startDate);

    const hourlyService = village_id
      ? await prisma.$queryRawUnsafe<any[]>(`
          SELECT EXTRACT(HOUR FROM sr.created_at) as hour, COUNT(*)::int as count 
          FROM "ServiceRequest" sr
          JOIN "Service" s ON sr.service_id = s.id 
          WHERE s.village_id = $2 AND sr.created_at >= $1
          GROUP BY 1
        `, startDate, village_id)
      : await prisma.$queryRawUnsafe<any[]>(`
          SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*)::int as count 
          FROM "ServiceRequest" sr
          WHERE sr.created_at >= $1
          GROUP BY 1
        `, startDate);

    // 5. Daily Distribution (Dow)
    const dailyComplaint = village_id
      ? await prisma.$queryRawUnsafe<any[]>(`
          SELECT EXTRACT(DOW FROM created_at) as day, COUNT(*)::int as count
          FROM "Complaint"
          WHERE created_at >= $1 AND village_id = $2
          GROUP BY 1
        `, startDate, village_id)
      : await prisma.$queryRawUnsafe<any[]>(`
          SELECT EXTRACT(DOW FROM created_at) as day, COUNT(*)::int as count
          FROM "Complaint"
          WHERE created_at >= $1
          GROUP BY 1
        `, startDate);

    const dailyService = village_id
      ? await prisma.$queryRawUnsafe<any[]>(`
          SELECT EXTRACT(DOW FROM sr.created_at) as day, COUNT(*)::int as count 
          FROM "ServiceRequest" sr
          JOIN "Service" s ON sr.service_id = s.id 
          WHERE s.village_id = $2 AND sr.created_at >= $1
          GROUP BY 1
        `, startDate, village_id)
      : await prisma.$queryRawUnsafe<any[]>(`
          SELECT EXTRACT(DOW FROM created_at) as day, COUNT(*)::int as count 
          FROM "ServiceRequest" sr
          WHERE sr.created_at >= $1
          GROUP BY 1
        `, startDate);
    
    // Process Data
    const trendData: { [key: string]: { complaints: number; services: number } } = {}
    const hourlyData: { [hour: number]: number } = {}
    const dailyData: { [day: number]: number } = {}
    
    // Init arrays
    for (let h = 0; h < 24; h++) hourlyData[h] = 0
    for (let d = 0; d < 7; d++) dailyData[d] = 0

    // Helper to format key
    const formatKey = (d: Date) => {
        if (period === 'monthly') {
             return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        }
        return getWeekKey(d)
    }

    // Process Trends
    complaintTrendRaw.forEach((row: any) => {
        const d = new Date(row.date);
        const k = formatKey(d);
        if (!trendData[k]) trendData[k] = { complaints: 0, services: 0 };
        trendData[k].complaints += row.count;
    });
    serviceTrendRaw.forEach((row: any) => {
        const d = new Date(row.date);
        const k = formatKey(d);
        if (!trendData[k]) trendData[k] = { complaints: 0, services: 0 };
        trendData[k].services += row.count;
    });

    // Process Distributions
    [...hourlyComplaint, ...hourlyService].forEach((row: any) => {
        hourlyData[row.hour] += row.count;
    });
     [...dailyComplaint, ...dailyService].forEach((row: any) => {
        dailyData[row.day] += row.count;
    });

    // Process Category Trends
    const categoryTrends: { [key: string]: { [period: string]: number } } = {}
    categoryTrendRaw.forEach((row: any) => {
        const d = new Date(row.date);
        const k = formatKey(d);
        if (!categoryTrends[row.kategori]) categoryTrends[row.kategori] = {};
        if (!categoryTrends[row.kategori][k]) categoryTrends[row.kategori][k] = 0;
        categoryTrends[row.kategori][k] += row.count;
    });

    // --- Logic from previous implementation ---
    const sortedPeriods = Object.keys(trendData).sort()
    const trendLabels = sortedPeriods.map((p) => formatPeriodLabel(p, period))
    const complaintTrend = sortedPeriods.map((p) => trendData[p].complaints)
    const serviceTrend = sortedPeriods.map((p) => trendData[p].services)
    const totalTrend = sortedPeriods.map((p) => trendData[p].complaints + trendData[p].services)

    const predictions = calculatePredictions(totalTrend, 4)
    
    const peakHour = Object.entries(hourlyData).reduce((a, b) => a[1] > b[1] ? a : b, ['0', 0]);
    const peakDay = Object.entries(dailyData).reduce((a, b) => a[1] > b[1] ? a : b, ['0', 0]);
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']

    const formattedCategoryTrends = Object.entries(categoryTrends).map(([kategori, data]) => ({
      kategori,
      data: sortedPeriods.map((p) => data[p] || 0),
    }))

    const recentPeriods = complaintTrend.slice(-4)
    const previousPeriods = complaintTrend.slice(-8, -4)
    const recentAvg = recentPeriods.length > 0 ? recentPeriods.reduce((a, b) => a + b, 0) / recentPeriods.length : 0
    const previousAvg = previousPeriods.length > 0 ? previousPeriods.reduce((a, b) => a + b, 0) / previousPeriods.length : 0
    const growthRate = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg * 100).toFixed(1) : 0

    // Simple totals from trends (approximate match to "totalComplaints" in summary)
    const totalComplaintsVal = complaintTrend.reduce((a,b)=>a+b, 0);
    const totalServicesVal = serviceTrend.reduce((a,b)=>a+b, 0);

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
        totalComplaints: totalComplaintsVal,
        totalServices: totalServicesVal,
        avgPerPeriod: sortedPeriods.length > 0 
          ? Math.round((totalComplaintsVal + totalServicesVal) / sortedPeriods.length) 
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
