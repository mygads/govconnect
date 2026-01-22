/**
 * Query Batcher Service
 * 
 * Batches multiple database queries to reduce round trips.
 * 
 * Benefits:
 * - Reduced database connections
 * - Better performance for bulk operations
 * - Lower latency for dashboard
 */

import prisma from '../config/database';
import logger from '../utils/logger';

// ==================== TYPES ====================

export interface BatchedStats {
  complaints: {
    total: number;
    byStatus: Record<string, number>;
    byKategori: Record<string, number>;
    todayCount: number;
    weekCount: number;
  };
  services: {
    total: number;
    byStatus: Record<string, number>;
    todayCount: number;
    pendingCount: number;
  };
}

// ==================== CACHED STATS ====================

let cachedStats: BatchedStats | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

// ==================== CORE FUNCTIONS ====================

/**
 * Get all dashboard statistics in a single batched query
 */
export async function getBatchedDashboardStats(): Promise<BatchedStats> {
  // Check cache
  if (cachedStats && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedStats;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  weekAgo.setHours(0, 0, 0, 0);

  try {
    // Execute all queries in parallel
    const [
      complaintTotal,
      complaintByStatus,
      complaintByKategori,
      complaintToday,
      complaintWeek,
      serviceTotal,
      serviceByStatus,
      serviceToday,
      servicePending,
    ] = await Promise.all([
      // Complaint stats
      prisma.complaint.count(),
      prisma.complaint.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      prisma.complaint.groupBy({
        by: ['kategori'],
        _count: { kategori: true },
      }),
      prisma.complaint.count({
        where: { created_at: { gte: today } },
      }),
      prisma.complaint.count({
        where: { created_at: { gte: weekAgo } },
      }),
      // Service request stats
      prisma.serviceRequest.count(),
      prisma.serviceRequest.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      prisma.serviceRequest.count({
        where: { created_at: { gte: today } },
      }),
      prisma.serviceRequest.count({
        where: { status: 'baru' },
      }),
    ]);

    // Transform results
    const stats: BatchedStats = {
      complaints: {
        total: complaintTotal,
        byStatus: Object.fromEntries(
          complaintByStatus.map(s => [s.status, s._count.status])
        ),
        byKategori: Object.fromEntries(
          complaintByKategori.map(k => [k.kategori, k._count.kategori])
        ),
        todayCount: complaintToday,
        weekCount: complaintWeek,
      },
      services: {
        total: serviceTotal,
        byStatus: Object.fromEntries(
          serviceByStatus.map(s => [s.status, s._count.status])
        ),
        todayCount: serviceToday,
        pendingCount: servicePending,
      },
    };

    // Update cache
    cachedStats = stats;
    cacheTimestamp = Date.now();

    logger.debug('[QueryBatcher] Stats fetched and cached');

    return stats;
  } catch (error: any) {
    logger.error('[QueryBatcher] Failed to fetch stats', { error: error.message });
    throw error;
  }
}

/**
 * Get user's data in a single batched query
 */
export async function getBatchedUserData(wa_user_id: string): Promise<{
  complaints: any[];
  services: any[];
  totalComplaints: number;
  totalServices: number;
}> {
  try {
    const [complaints, services, totalComplaints, totalServices] = await Promise.all([
      prisma.complaint.findMany({
        where: { wa_user_id },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: {
          id: true,
          complaint_id: true,
          kategori: true,
          status: true,
          created_at: true,
        },
      }),
      prisma.serviceRequest.findMany({
        where: { wa_user_id },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          request_number: true,
          service: { select: { name: true } },
        },
      }),
      prisma.complaint.count({ where: { wa_user_id } }),
      prisma.serviceRequest.count({ where: { wa_user_id } }),
    ]);

    return {
      complaints,
      services,
      totalComplaints,
      totalServices,
    };
  } catch (error: any) {
    logger.error('[QueryBatcher] Failed to fetch user data', { 
      wa_user_id, 
      error: error.message 
    });
    throw error;
  }
}

/**
 * Invalidate stats cache (call after data changes)
 */
export function invalidateStatsCache(): void {
  cachedStats = null;
  cacheTimestamp = 0;
  logger.debug('[QueryBatcher] Stats cache invalidated');
}

// ==================== EXPORTS ====================

export default {
  getBatchedDashboardStats,
  getBatchedUserData,
  invalidateStatsCache,
};
