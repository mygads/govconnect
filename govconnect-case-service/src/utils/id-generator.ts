import prisma from '../config/database';
import { config } from '../config/env';

/**
 * Generate unique complaint ID in format: LAP-YYYYMMDD-XXX
 * Example: LAP-20251124-001
 */
export async function generateComplaintId(): Promise<string> {
  const today = new Date();
  const dateStr = formatDateForId(today);
  
  // Count today's complaints
  const { startOfDay, endOfDay } = getDayBounds(today);
  
  const count = await prisma.complaint.count({
    where: {
      created_at: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });
  
  const sequence = String(count + 1).padStart(3, '0');
  return `${config.idPrefixComplaint}-${dateStr}-${sequence}`;
}

/**
 * Generate unique service request ID in format: LAY-YYYYMMDD-XXX
 * Example: LAY-20251124-001
 */
export async function generateServiceRequestId(): Promise<string> {
  const today = new Date();
  const dateStr = formatDateForId(today);

  const { startOfDay, endOfDay } = getDayBounds(today);

  const count = await prisma.serviceRequest.count({
    where: {
      created_at: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  const sequence = String(count + 1).padStart(3, '0');
  return `${config.idPrefixServiceRequest}-${dateStr}-${sequence}`;
}


/**
 * Format date to YYYYMMDD string
 */
function formatDateForId(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Get start and end of day boundaries
 */
function getDayBounds(date: Date): { startOfDay: Date; endOfDay: Date } {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  return { startOfDay, endOfDay };
}
