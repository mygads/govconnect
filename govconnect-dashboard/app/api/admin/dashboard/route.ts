import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireSuperAdmin, isNextResponse } from '@/lib/auth-middleware';

// GET - Super admin dashboard statistics
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    // Get date ranges
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get all stats in parallel
    const [
      // Village stats
      totalVillages,
      newVillagesThisMonth,
      
      // User stats
      totalUsers,
      
      // Service Request stats
      totalRequests,
      pendingRequests,
      todayRequests,
      monthRequests,
      
      // Report stats
      totalReports,
      pendingReports,
      todayReports,
      
      // Top villages by requests
      topVillagesByRequests,
      
      // Recent villages
      recentVillages,
      
      // Recent activity
      recentActivity
    ] = await Promise.all([
      // Villages
      prisma.villages.count(),
      prisma.villages.count({ 
        where: { created_at: { gte: startOfMonth } } 
      }),
      
      // Users
      prisma.users.count(),
      
      // Service Requests
      prisma.service_requests.count(),
      prisma.service_requests.count({ 
        where: { status: 'PENDING' } 
      }),
      prisma.service_requests.count({ 
        where: { created_at: { gte: startOfDay } } 
      }),
      prisma.service_requests.count({ 
        where: { created_at: { gte: startOfMonth } } 
      }),
      
      // Reports
      prisma.reports.count(),
      prisma.reports.count({ 
        where: { status: { in: ['RECEIVED', 'IN_PROGRESS'] } } 
      }),
      prisma.reports.count({ 
        where: { created_at: { gte: startOfDay } } 
      }),
      
      // Top villages
      prisma.villages.findMany({
        select: {
          id: true,
          name: true,
          short_name: true,
          _count: {
            select: {
              service_requests: true,
              reports: true
            }
          }
        },
        orderBy: {
          service_requests: {
            _count: 'desc'
          }
        },
        take: 10
      }),
      
      // Recent villages
      prisma.villages.findMany({
        include: {
          user: {
            select: {
              name: true,
              email: true
            }
          },
          _count: {
            select: {
              service_categories: true
            }
          }
        },
        orderBy: { created_at: 'desc' },
        take: 5
      }),
      
      // Recent activity
      prisma.activity_logs.findMany({
        include: {
          user: {
            select: {
              name: true,
              email: true
            }
          }
        },
        orderBy: { timestamp: 'desc' },
        take: 10
      })
    ]);

    return NextResponse.json({
      success: true,
      data: {
        villages: {
          total: totalVillages,
          active: totalVillages, // All villages are active
          inactive: 0,
          newThisMonth: newVillagesThisMonth
        },
        users: {
          total: totalUsers,
          activeToday: 0 // Not tracked
        },
        requests: {
          total: totalRequests,
          pending: pendingRequests,
          today: todayRequests,
          thisMonth: monthRequests
        },
        reports: {
          total: totalReports,
          pending: pendingReports,
          today: todayReports
        },
        topVillages: topVillagesByRequests,
        recentVillages,
        recentActivity
      }
    });

  } catch (error) {
    console.error('Get admin dashboard stats error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}
