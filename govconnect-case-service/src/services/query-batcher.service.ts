/**
 * Query Batcher Service
 * 
 * Cache invalidation utilities for dashboard statistics.
 * 
 * NOTE: getBatchedDashboardStats and getBatchedUserData were removed — dead code never imported.
 * Dashboard stats are served directly by complaint.service.ts and service-request.service.ts.
 */

import logger from '../utils/logger';

// ==================== CACHED STATS ====================

let cacheTimestamp = 0;

// ==================== CORE FUNCTIONS ====================

/**
 * Invalidate stats cache (call after data changes)
 */
export function invalidateStatsCache(): void {
  cacheTimestamp = 0;
  logger.debug('[QueryBatcher] Stats cache invalidated');
}
