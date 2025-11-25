import { Router, Request, Response } from 'express'
import prisma from '../config/database'
import logger from '../utils/logger'

const router: Router = Router()

/**
 * GET /statistics/overview
 * Get overview statistics for dashboard
 */
router.get('/overview', async (req: Request, res: Response) => {
  try {
    // Get complaint statistics
    const [
      totalLaporan,
      laporanBaru,
      laporanProses,
      laporanSelesai,
    ] = await Promise.all([
      prisma.complaint.count(),
      prisma.complaint.count({ where: { status: 'baru' } }),
      prisma.complaint.count({ where: { status: 'proses' } }),
      prisma.complaint.count({ where: { status: 'selesai' } }),
    ])

    // Get ticket statistics
    const [
      totalTiket,
      tiketPending,
      tiketProses,
      tiketSelesai,
    ] = await Promise.all([
      prisma.ticket.count(),
      prisma.ticket.count({ where: { status: 'pending' } }),
      prisma.ticket.count({ where: { status: 'proses' } }),
      prisma.ticket.count({ where: { status: 'selesai' } }),
    ])

    // Get recent activity counts
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const [laporanHariIni, tiketHariIni] = await Promise.all([
      prisma.complaint.count({
        where: {
          created_at: {
            gte: today,
          },
        },
      }),
      prisma.ticket.count({
        where: {
          created_at: {
            gte: today,
          },
        },
      }),
    ])

    const statistics = {
      totalLaporan,
      totalTiket,
      laporan: {
        baru: laporanBaru,
        proses: laporanProses,
        selesai: laporanSelesai,
        hariIni: laporanHariIni,
      },
      tiket: {
        pending: tiketPending,
        proses: tiketProses,
        selesai: tiketSelesai,
        hariIni: tiketHariIni,
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

/**
 * GET /statistics/by-category
 * Get complaints grouped by category
 */
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

/**
 * GET /statistics/by-status
 * Get complaints and tickets grouped by status
 */
router.get('/by-status', async (req: Request, res: Response) => {
  try {
    const [complaintsByStatus, ticketsByStatus] = await Promise.all([
      prisma.complaint.groupBy({
        by: ['status'],
        _count: {
          status: true,
        },
      }),
      prisma.ticket.groupBy({
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
      tickets: ticketsByStatus.map((item) => ({
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

export default router
