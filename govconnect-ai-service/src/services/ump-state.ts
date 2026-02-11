/**
 * UMP State — all in-memory caches, pending-state accessors, and lifecycle helpers
 * for the Unified Message Processor.
 *
 * Every LRU cache, photo accumulator, active-processing counter, and timer
 * that previously lived in the monolithic UMP file is centralised here so
 * handler modules can share state without circular imports.
 */

import logger from '../utils/logger';
import { LRUCache } from '../utils/lru-cache';
import { registerInterval } from '../utils/timer-registry';
import { updateConversationUserProfile } from './channel-client.service';
import { deleteProfile } from './user-profile.service';
import type { ChannelType } from './ump-formatters';

// ==================== LRU CACHES ====================

/** Address confirmation state cache (for VAGUE addresses) */
export const pendingAddressConfirmation = new LRUCache<string, {
  alamat: string;
  kategori: string;
  deskripsi: string;
  village_id?: string;
  timestamp: number;
  foto_url?: string;
}>({ maxSize: 1000, ttlMs: 10 * 60 * 1000, name: 'pendingAddressConfirmation' });

/** Pending address request cache (for MISSING required addresses) */
export const pendingAddressRequest = new LRUCache<string, {
  kategori: string;
  deskripsi: string;
  village_id?: string;
  timestamp: number;
  foto_url?: string;
}>({ maxSize: 1000, ttlMs: 10 * 60 * 1000, name: 'pendingAddressRequest' });

/** Cancellation confirmation state cache */
export const pendingCancelConfirmation = new LRUCache<string, {
  type: 'laporan' | 'layanan';
  id: string;
  reason?: string;
  timestamp: number;
}>({ maxSize: 500, ttlMs: 10 * 60 * 1000, name: 'pendingCancelConfirmation' });

/** Name confirmation state cache */
export const pendingNameConfirmation = new LRUCache<string, {
  name: string;
  timestamp: number;
}>({ maxSize: 500, ttlMs: 10 * 60 * 1000, name: 'pendingNameConfirmation' });

/** Online service form offer state cache */
export const pendingServiceFormOffer = new LRUCache<string, {
  service_slug: string;
  village_id?: string;
  timestamp: number;
}>({ maxSize: 500, ttlMs: 10 * 60 * 1000, name: 'pendingServiceFormOffer' });

/** Pending complaint data cache (waiting for name/phone before creating complaint) */
export const pendingComplaintData = new LRUCache<string, {
  kategori: string;
  deskripsi: string;
  alamat?: string;
  rt_rw?: string;
  village_id?: string;
  foto_url?: string;
  channel: ChannelType;
  timestamp: number;
  waitingFor: 'nama' | 'no_hp';
}>({ maxSize: 500, ttlMs: 10 * 60 * 1000, name: 'pendingComplaintData' });

/** Accumulated photos cache (for multi-photo complaint support, max 5 per user) */
export const pendingPhotos = new LRUCache<string, {
  urls: string[];
  timestamp: number;
}>({ maxSize: 500, ttlMs: 10 * 60 * 1000, name: 'pendingPhotos' });

/** Complaint types cache (per village) — bounded LRU */
export const complaintTypeCache = new LRUCache<string, { data: any[]; timestamp: number }>({
  maxSize: 100, ttlMs: 5 * 60 * 1000, name: 'complaintTypeCache',
});

/** Conversation history cache — avoids HTTP round-trip per message */
export const conversationHistoryCache = new LRUCache<string, {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  timestamp: number;
}>({ maxSize: 2000, ttlMs: 60 * 1000, name: 'conversationHistoryCache' });

/** Service search results cache — avoids HTTP + micro LLM per lookup */
export const serviceSearchCache = new LRUCache<string, {
  slug: string;
  name?: string;
  timestamp: number;
}>({ maxSize: 500, ttlMs: 5 * 60 * 1000, name: 'serviceSearchCache' });

// ==================== PERIODIC CACHE PURGE ====================

registerInterval(() => {
  const caches = [
    pendingAddressConfirmation, pendingAddressRequest, pendingCancelConfirmation,
    pendingNameConfirmation, pendingServiceFormOffer, pendingComplaintData,
    pendingPhotos, complaintTypeCache, conversationHistoryCache,
    serviceSearchCache,
  ];
  let totalPurged = 0;
  for (const cache of caches) {
    totalPurged += cache.purgeExpired();
  }
  if (totalPurged > 0) {
    logger.debug(`Purged ${totalPurged} expired cache entries`);
  }
}, 60 * 1000, 'ump-lru-cache-purge');

// ==================== PHOTO HELPERS ====================

export const MAX_PHOTOS_PER_COMPLAINT = 5;

/**
 * Add a photo URL to the pending photos cache for a user.
 * Returns the current count after adding.
 */
export function addPendingPhoto(userId: string, photoUrl: string): number {
  const existing = pendingPhotos.get(userId);
  if (existing) {
    if (existing.urls.length >= MAX_PHOTOS_PER_COMPLAINT) {
      return existing.urls.length; // Already at max, don't add
    }
    existing.urls.push(photoUrl);
    existing.timestamp = Date.now();
    return existing.urls.length;
  }
  pendingPhotos.set(userId, { urls: [photoUrl], timestamp: Date.now() });
  return 1;
}

/**
 * Get and clear all pending photos for a user.
 * Returns a foto_url string: single URL or JSON array string for multiple.
 */
export function consumePendingPhotos(userId: string, currentMediaUrl?: string): string | undefined {
  const pending = pendingPhotos.get(userId);
  const allUrls: string[] = [];

  if (pending) {
    allUrls.push(...pending.urls);
    pendingPhotos.delete(userId);
  }

  if (currentMediaUrl && !allUrls.includes(currentMediaUrl)) {
    allUrls.push(currentMediaUrl);
  }

  if (allUrls.length === 0) return undefined;
  if (allUrls.length === 1) return allUrls[0]; // Single URL (backward compatible)
  // Enforce max
  const trimmed = allUrls.slice(0, MAX_PHOTOS_PER_COMPLAINT);
  return JSON.stringify(trimmed); // JSON array string for multiple photos
}

/**
 * Get current pending photo count for a user.
 */
export function getPendingPhotoCount(userId: string): number {
  return pendingPhotos.get(userId)?.urls.length || 0;
}

// ==================== CACHE ADMIN ====================

/**
 * Clear ALL in-memory caches (for admin cache management endpoint).
 */
export function clearAllUMPCaches(): { cleared: number; caches: string[] } {
  const cacheList = [
    { cache: pendingAddressConfirmation, name: 'pendingAddressConfirmation' },
    { cache: pendingAddressRequest, name: 'pendingAddressRequest' },
    { cache: pendingCancelConfirmation, name: 'pendingCancelConfirmation' },
    { cache: pendingNameConfirmation, name: 'pendingNameConfirmation' },
    { cache: pendingServiceFormOffer, name: 'pendingServiceFormOffer' },
    { cache: pendingComplaintData, name: 'pendingComplaintData' },
    { cache: pendingPhotos, name: 'pendingPhotos' },
    { cache: complaintTypeCache, name: 'complaintTypeCache' },
    { cache: conversationHistoryCache, name: 'conversationHistoryCache' },
    { cache: serviceSearchCache, name: 'serviceSearchCache' },
  ];
  let cleared = 0;
  const names: string[] = [];
  for (const { cache, name } of cacheList) {
    if (cache.size > 0) {
      cleared += cache.size;
      names.push(`${name}(${cache.size})`);
      cache.clear();
    }
  }
  logger.info(`[Admin] Cleared all UMP caches: ${cleared} entries`, { caches: names });
  return { cleared, caches: names };
}

/**
 * Clear all in-memory caches for a SPECIFIC user.
 * Used when admin clears a conversation or user resets their chat session.
 * Also clears the user profile's personal data (name, phone, etc.)
 */
export function clearUserCaches(userId: string): { cleared: number } {
  const userCaches = [
    pendingAddressConfirmation, pendingAddressRequest, pendingCancelConfirmation,
    pendingNameConfirmation, pendingServiceFormOffer, pendingComplaintData,
    pendingPhotos, conversationHistoryCache,
  ];
  let cleared = 0;
  for (const cache of userCaches) {
    if (cache.get(userId)) {
      cache.delete(userId);
      cleared++;
    }
  }
  // Fully delete user profile so AI has zero memory of this user
  deleteProfile(userId);
  logger.info(`[Admin] Cleared caches for user: ${userId}`, { cleared });
  return { cleared };
}

/**
 * Sync user name to Channel Service conversation record.
 * This updates the sidebar display in the livechat dashboard
 * (shows user name instead of phone number).
 * Non-blocking — failures are logged but don't affect the response.
 */
export function syncNameToChannelService(
  channelIdentifier: string,
  userName: string,
  villageId?: string,
  channel?: ChannelType,
): void {
  const channelUpper = (channel || 'whatsapp').toUpperCase() as 'WHATSAPP' | 'WEBCHAT';
  updateConversationUserProfile(channelIdentifier, { user_name: userName }, villageId, channelUpper)
    .then(ok => {
      if (ok) logger.debug('👤 Name synced to Channel Service', { channelIdentifier, userName });
    })
    .catch(() => { /* non-critical */ });
}

/**
 * Get stats from ALL UMP caches (for admin dashboard).
 */
export function getUMPCacheStats() {
  return [
    pendingAddressConfirmation, pendingAddressRequest, pendingCancelConfirmation,
    pendingNameConfirmation, pendingServiceFormOffer, pendingComplaintData,
    pendingPhotos, complaintTypeCache, conversationHistoryCache,
    serviceSearchCache,
  ].map(c => c.getStats());
}

// ==================== ACTIVE PROCESSING TRACKER ====================

let _activeProcessingCount = 0;

export function incrementActiveProcessing(): void {
  _activeProcessingCount++;
}

export function decrementActiveProcessing(): void {
  _activeProcessingCount--;
}

/** Get the count of messages currently being processed */
export function getActiveProcessingCount(): number {
  return _activeProcessingCount;
}

/**
 * Wait until all in-flight message processing completes (for graceful shutdown).
 * Polls every 500ms, gives up after maxWaitMs.
 */
export async function drainActiveProcessing(maxWaitMs: number = 15_000): Promise<boolean> {
  if (_activeProcessingCount === 0) return true;
  logger.info(`Draining ${_activeProcessingCount} active message(s)...`);
  const deadline = Date.now() + maxWaitMs;
  while (_activeProcessingCount > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
  }
  if (_activeProcessingCount > 0) {
    logger.warn(`Drain timeout: ${_activeProcessingCount} message(s) still active after ${maxWaitMs}ms`);
    return false;
  }
  logger.info('All active processing drained');
  return true;
}

// ==================== PENDING STATE ACCESSORS ====================

// --- Address Confirmation ---
export function getPendingAddressConfirmation(userId: string) {
  return pendingAddressConfirmation.get(userId);
}
export function clearPendingAddressConfirmation(userId: string) {
  pendingAddressConfirmation.delete(userId);
}
export function setPendingAddressConfirmation(userId: string, data: {
  alamat: string;
  kategori: string;
  deskripsi: string;
  village_id?: string;
  timestamp: number;
  foto_url?: string;
}) {
  pendingAddressConfirmation.set(userId, data);
}

// --- Cancel Confirmation ---
export function clearPendingCancelConfirmation(userId: string) {
  pendingCancelConfirmation.delete(userId);
}
export function setPendingCancelConfirmation(userId: string, data: {
  type: 'laporan' | 'layanan';
  id: string;
  reason?: string;
  timestamp: number;
}) {
  pendingCancelConfirmation.set(userId, data);
}

// --- Service Form Offer ---
export function getPendingServiceFormOffer(userId: string) {
  return pendingServiceFormOffer.get(userId);
}
export function clearPendingServiceFormOffer(userId: string) {
  pendingServiceFormOffer.delete(userId);
}
export function setPendingServiceFormOffer(userId: string, data: {
  service_slug: string;
  village_id?: string;
  timestamp: number;
}) {
  pendingServiceFormOffer.set(userId, data);
}

// --- Address Request ---
export function getPendingAddressRequest(userId: string) {
  return pendingAddressRequest.get(userId);
}
export function clearPendingAddressRequest(userId: string) {
  pendingAddressRequest.delete(userId);
}
export function setPendingAddressRequest(userId: string, data: {
  kategori: string;
  deskripsi: string;
  village_id?: string;
  timestamp: number;
  foto_url?: string;
}) {
  pendingAddressRequest.set(userId, data);
}
