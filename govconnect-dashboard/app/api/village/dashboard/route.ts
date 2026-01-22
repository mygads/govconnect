import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireVillageAdmin, isNextResponse, getVillageIdFromUser } from '@/lib/auth-middleware';

// GET - Dashboard statistics
export async function GET(request: NextRequest) {
  const auth = await requireVillageAdmin(request);
  if (isNextResponse(auth)) return auth;

  try {
    const villageId = await getVillageIdFromUser(auth.userId);
    if (!villageId) {
      return NextResponse.json(
        { success: false, error: 'Desa tidak ditemukan' },
        { status: 404 }
      );
    }

    // Get date ranges
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Get all stats in parallel
    const [
      // Service Request stats
      totalRequests,
      pendingRequests,
      processingRequests,
      completedRequests,
      todayRequests,
      weekRequests,
      monthRequests,
      
      // Report stats
      totalReports,
      pendingReports,
      inProgressReports,
      resolvedReports,
      todayReports,
      
      // Conversation stats
      activeConversations,
      todayConversations,
      
      // Service stats
      totalServices,
      activeServices,
      
      // Recent requests
      recentRequests,
      
      // Recent reports
      recentReports
    ] = await Promise.all([
      // Service Requests
      prisma.service_requests.count({ where: { village_id: villageId } }),
      prisma.service_requests.count({ 
        where: { 
          village_id: villageId, 
          status: 'PENDING'
        } 
      }),
      prisma.service_requests.count({ 
        where: { 
          village_id: villageId, 
          status: 'IN_PROGRESS'
        } 
      }),
      prisma.service_requests.count({ 
        where: { 
          village_id: villageId, 
          status: 'COMPLETED'
        } 
      }),
      prisma.service_requests.count({ 
        where: { 
          village_id: villageId, 
          created_at: { gte: startOfDay } 
        } 
      }),
      prisma.service_requests.count({ 
        where: { 
          village_id: villageId, 
          created_at: { gte: startOfWeek } 
        } 
      }),
      prisma.service_requests.count({ 
        where: { 
          village_id: villageId, 
          created_at: { gte: startOfMonth } 
        } 
      }),
      
      // Reports
      prisma.reports.count({ where: { village_id: villageId } }),
      prisma.reports.count({ 
        where: { village_id: villageId, status: 'RECEIVED' } 
      }),
      prisma.reports.count({ 
        where: { village_id: villageId, status: 'IN_PROGRESS' } 
      }),
      prisma.reports.count({ 
        where: { village_id: villageId, status: 'RESOLVED' } 
      }),
      prisma.reports.count({ 
        where: { 
          village_id: villageId, 
          created_at: { gte: startOfDay } 
        } 
      }),
      
      // Conversations
      prisma.conversations.count({ 
        where: { 
          village_id: villageId, 
          status: 'AI_ACTIVE' 
        } 
      }),
      prisma.conversations.count({ 
        where: { 
          village_id: villageId, 
          created_at: { gte: startOfDay } 
        } 
      }),
      
      // Services
      prisma.services.count({ where: { village_id: villageId } }),
      prisma.services.count({ 
        where: { village_id: villageId, is_active: true } 
      }),
      
      // Recent requests
      prisma.service_requests.findMany({
        where: { village_id: villageId },
        include: {
          service: {
            select: { name: true }
          }
        },
        orderBy: { created_at: 'desc' },
        take: 5
      }),
      
      // Recent reports
      prisma.reports.findMany({
        where: { village_id: villageId },
        include: {
          type: {
            select: { name: true }
          }
        },
        orderBy: { created_at: 'desc' },
        take: 5
      })
    ]);

    return NextResponse.json({
      success: true,
      data: {
        requests: {
          total: totalRequests,
          pending: pendingRequests,
          processing: processingRequests,
          completed: completedRequests,
          today: todayRequests,
          thisWeek: weekRequests,
          thisMonth: monthRequests
        },
        reports: {
          total: totalReports,
          pending: pendingReports,
          inProgress: inProgressReports,
          resolved: resolvedReports,
          today: todayReports
        },
        conversations: {
          active: activeConversations,
          today: todayConversations
        },
        services: {
          total: totalServices,
          active: activeServices
        },
        recent: {
          requests: recentRequests,
          reports: recentReports
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil data' },
      { status: 500 }
    );
  }
}
