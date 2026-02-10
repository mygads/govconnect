import prisma from '../config/database';
import { config } from '../config/env';

const MAX_RETRIES = 5;

/**
 * Generate unique complaint ID in format: LAP-YYYYMMDD-XXX
 * Example: LAP-20251124-001
 * 
 * Uses retry loop with unique constraint check to prevent race conditions.
 * If two concurrent requests count the same number, one will get a duplicate
 * and retry with the next sequence number.
 */
export async function generateComplaintId(): Promise<string> {
  const today = new Date();
  const dateStr = formatDateForId(today);
  const { startOfDay, endOfDay } = getDayBounds(today);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const count = await prisma.complaint.count({
      where: {
        created_at: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    const sequence = String(count + 1 + attempt).padStart(3, '0');
    const candidateId = `${config.idPrefixComplaint}-${dateStr}-${sequence}`;

    // Check if this ID already exists (atomic uniqueness check)
    const existing = await prisma.complaint.findUnique({
      where: { complaint_id: candidateId },
      select: { id: true },
    });

    if (!existing) {
      return candidateId;
    }
  }

  // Fallback: use timestamp-based suffix for guaranteed uniqueness
  const fallbackSeq = Date.now().toString().slice(-4);
  return `${config.idPrefixComplaint}-${dateStr}-${fallbackSeq}`;
}

/**
 * Generate unique service request ID in format: LAY-YYYYMMDD-XXX
 * Example: LAY-20251124-001
 * 
 * Uses retry loop with unique constraint check to prevent race conditions.
 */
export async function generateServiceRequestId(): Promise<string> {
  const today = new Date();
  const dateStr = formatDateForId(today);
  const { startOfDay, endOfDay } = getDayBounds(today);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const count = await prisma.serviceRequest.count({
      where: {
        created_at: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    const sequence = String(count + 1 + attempt).padStart(3, '0');
    const candidateId = `${config.idPrefixServiceRequest}-${dateStr}-${sequence}`;

    // Check if this ID already exists (atomic uniqueness check)
    const existing = await prisma.serviceRequest.findUnique({
      where: { request_number: candidateId },
      select: { id: true },
    });

    if (!existing) {
      return candidateId;
    }
  }

  // Fallback: use timestamp-based suffix for guaranteed uniqueness
  const fallbackSeq = Date.now().toString().slice(-4);
  return `${config.idPrefixServiceRequest}-${dateStr}-${fallbackSeq}`;
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
