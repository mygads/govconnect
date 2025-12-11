/**
 * Complaint Deduplication Service
 * 
 * Prevents duplicate complaint submissions by checking:
 * - Same user, same category, similar location within 24 hours
 * - Text similarity for description
 * 
 * Benefits:
 * - Reduces spam/duplicate reports
 * - Improves data quality
 * - Better resource allocation
 */

import prisma from '../config/database';
import logger from '../utils/logger';

// ==================== TYPES ====================

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingId?: string;
  similarity?: number;
  reason?: string;
}

export interface CreateComplaintData {
  wa_user_id: string;
  kategori: string;
  deskripsi: string;
  alamat: string;
  rt_rw?: string;
}

// ==================== CONFIGURATION ====================

const DUPLICATE_CHECK_HOURS = 24;
const MIN_SIMILARITY_THRESHOLD = 0.7; // 70% similarity
const ADDRESS_SIMILARITY_THRESHOLD = 0.6;

// ==================== CORE FUNCTIONS ====================

/**
 * Check if a complaint is a duplicate
 */
export async function checkDuplicateComplaint(
  data: CreateComplaintData
): Promise<DuplicateCheckResult> {
  try {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - DUPLICATE_CHECK_HOURS);

    // Find recent complaints from same user with same category
    const recentComplaints = await prisma.complaint.findMany({
      where: {
        wa_user_id: data.wa_user_id,
        kategori: data.kategori,
        created_at: {
          gte: cutoffTime,
        },
        status: {
          notIn: ['ditolak', 'dibatalkan'],
        },
      },
      select: {
        id: true,
        complaint_id: true,
        deskripsi: true,
        alamat: true,
        created_at: true,
      },
      orderBy: {
        created_at: 'desc',
      },
      take: 5,
    });

    if (recentComplaints.length === 0) {
      return { isDuplicate: false };
    }

    // Check for similar complaints
    for (const existing of recentComplaints) {
      // Check address similarity
      const addressSimilarity = calculateSimilarity(
        normalizeAddress(data.alamat || ''),
        normalizeAddress(existing.alamat || '')
      );

      if (addressSimilarity >= ADDRESS_SIMILARITY_THRESHOLD) {
        // Check description similarity
        const descSimilarity = calculateSimilarity(
          normalizeText(data.deskripsi),
          normalizeText(existing.deskripsi || '')
        );

        const overallSimilarity = (addressSimilarity * 0.6) + (descSimilarity * 0.4);

        if (overallSimilarity >= MIN_SIMILARITY_THRESHOLD) {
          logger.info('[Deduplication] Duplicate complaint detected', {
            wa_user_id: data.wa_user_id,
            existingId: existing.complaint_id,
            addressSimilarity: addressSimilarity.toFixed(2),
            descSimilarity: descSimilarity.toFixed(2),
            overallSimilarity: overallSimilarity.toFixed(2),
          });

          return {
            isDuplicate: true,
            existingId: existing.complaint_id,
            similarity: overallSimilarity,
            reason: `Laporan serupa sudah ada (${existing.complaint_id}) dibuat ${formatTimeAgo(existing.created_at)}`,
          };
        }
      }
    }

    return { isDuplicate: false };
  } catch (error: any) {
    logger.error('[Deduplication] Check failed', { error: error.message });
    // On error, allow the complaint to proceed
    return { isDuplicate: false };
  }
}

/**
 * Check for global duplicates (any user, same location, same category)
 * Useful for detecting multiple reports of the same issue
 */
export async function checkGlobalDuplicate(
  data: CreateComplaintData
): Promise<{ hasSimilar: boolean; similarCount: number; latestId?: string }> {
  try {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - 48); // 48 hours for global check

    const similarComplaints = await prisma.complaint.findMany({
      where: {
        kategori: data.kategori,
        created_at: {
          gte: cutoffTime,
        },
        status: {
          notIn: ['ditolak', 'dibatalkan', 'selesai'],
        },
      },
      select: {
        id: true,
        complaint_id: true,
        alamat: true,
      },
      take: 20,
    });

    let similarCount = 0;
    let latestId: string | undefined;

    for (const complaint of similarComplaints) {
      const similarity = calculateSimilarity(
        normalizeAddress(data.alamat || ''),
        normalizeAddress(complaint.alamat || '')
      );

      if (similarity >= 0.8) { // Higher threshold for global
        similarCount++;
        if (!latestId) latestId = complaint.complaint_id;
      }
    }

    return {
      hasSimilar: similarCount > 0,
      similarCount,
      latestId,
    };
  } catch (error: any) {
    logger.error('[Deduplication] Global check failed', { error: error.message });
    return { hasSimilar: false, similarCount: 0 };
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate text similarity using Jaccard index
 */
function calculateSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  if (text1 === text2) return 1;

  const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Normalize address for comparison
 */
function normalizeAddress(address: string): string {
  if (!address) return '';
  
  return address
    .toLowerCase()
    .replace(/jln?\.?\s*/gi, 'jalan ')
    .replace(/gg\.?\s*/gi, 'gang ')
    .replace(/no\.?\s*/gi, 'nomor ')
    .replace(/rt\.?\s*/gi, 'rt ')
    .replace(/rw\.?\s*/gi, 'rw ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
  if (!text) return '';
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format time ago
 */
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 60) {
    return `${diffMins} menit yang lalu`;
  } else if (diffHours < 24) {
    return `${diffHours} jam yang lalu`;
  } else {
    return `${Math.floor(diffHours / 24)} hari yang lalu`;
  }
}

// ==================== EXPORTS ====================

export default {
  checkDuplicateComplaint,
  checkGlobalDuplicate,
};
