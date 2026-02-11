import prisma from '../config/database';
import logger from '../utils/logger';

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETENTION_DAYS = 30;

/**
 * Permanently delete records that have been soft-deleted for more than 30 days.
 */
async function purgeExpiredRecords() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  try {
    // Purge old soft-deleted complaints (cascade deletes updates too)
    const deletedComplaints = await prisma.complaint.deleteMany({
      where: {
        deleted_at: { not: null, lt: cutoffDate },
      },
    });

    // Purge old soft-deleted service requests
    const deletedServiceRequests = await prisma.serviceRequest.deleteMany({
      where: {
        deleted_at: { not: null, lt: cutoffDate },
      },
    });

    if (deletedComplaints.count > 0 || deletedServiceRequests.count > 0) {
      logger.info('🗑️ Auto-purge completed', {
        complaints: deletedComplaints.count,
        serviceRequests: deletedServiceRequests.count,
        cutoffDate: cutoffDate.toISOString(),
      });
    }
  } catch (error: any) {
    logger.error('Auto-purge failed', { error: error.message });
  }
}

let purgeTimer: NodeJS.Timeout | null = null;

/**
 * Start the auto-purge scheduler (runs once on startup, then every 24 hours).
 */
export function startAutoPurgeScheduler() {
  // Run once on startup (after a short delay to let DB settle)
  setTimeout(() => purgeExpiredRecords(), 30_000);

  // Then run every 24 hours
  purgeTimer = setInterval(() => purgeExpiredRecords(), PURGE_INTERVAL_MS);

  logger.info(`🗑️ Auto-purge scheduler started (every 24h, retention: ${RETENTION_DAYS} days)`);
}

/**
 * Stop the auto-purge scheduler.
 */
export function stopAutoPurgeScheduler() {
  if (purgeTimer) {
    clearInterval(purgeTimer);
    purgeTimer = null;
  }
}
