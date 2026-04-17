/**
 * User Profile & Preference Memory Service
 * 
 * Menyimpan dan mengelola preferensi user untuk personalisasi response:
 * - Bahasa/gaya komunikasi (formal/informal)
 * - Alamat default (untuk laporan)
 * - Layanan yang sering digunakan
 * - Riwayat interaksi
 * 
 * Hybrid memory:
 * - Hot path: in-memory LRU cache untuk akses cepat
 * - Long-term: durable_user_profiles di PostgreSQL untuk survive restart
 */

import logger from '../utils/logger';
import { LRUCache } from '../utils/lru-cache';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { deleteAllMemories } from './hybrid-memory.service';

// ==================== PII ENCRYPTION (Temuan 5) ====================

const PII_ENCRYPTION_KEY = process.env.PROFILE_ENCRYPTION_KEY || '';
const ENCRYPTION_ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getPiiKey(): Buffer | null {
  if (!PII_ENCRYPTION_KEY || PII_ENCRYPTION_KEY.length < 32) {
    return null; // Encryption disabled if no key set
  }
  // Use first 32 bytes of hex-decoded key, or raw string padded/truncated
  return crypto.createHash('sha256').update(PII_ENCRYPTION_KEY).digest();
}

function encryptPii(plaintext: string): string {
  const key = getPiiKey();
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PROFILE_ENCRYPTION_KEY is required in production for PII encryption (UU PDP)');
    }
    logger.warn('⚠️ PII encryption disabled — PROFILE_ENCRYPTION_KEY not set');
    return plaintext;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: base64(iv + authTag + ciphertext)
  return 'enc:' + Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptPii(ciphertext: string): string {
  if (!ciphertext.startsWith('enc:')) return ciphertext; // Not encrypted

  const key = getPiiKey();
  if (!key) return ciphertext; // Can't decrypt without key

  try {
    const data = Buffer.from(ciphertext.slice(4), 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch (err) {
    logger.warn('PII decryption failed, returning raw value', { error: (err as Error).message });
    return ciphertext;
  }
}

// ==================== NAME MASKING (Temuan 6) ====================

/**
 * Mask full name: show first name only, replace rest with ***
 * "Ahmad Sudirman" → "Ahmad S***"
 * "Siti" → "Siti"
 */
function maskName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] || fullName;
  return `${parts[0]} ${parts[1][0]}***`;
}

// ==================== TYPES ====================

export type CommunicationStyle = 'formal' | 'informal' | 'auto';
export type PreferredLanguage = 'indonesian' | 'sundanese' | 'javanese' | 'auto';

export interface UserProfile {
  wa_user_id: string;
  
  // Communication preferences
  preferred_language: PreferredLanguage;
  communication_style: CommunicationStyle;
  response_detail: 'brief' | 'detailed' | 'auto';
  
  // UU PDP consent tracking
  data_consent: boolean;             // User has given consent for data processing
  data_consent_at?: Date;            // When consent was given
  data_consent_version?: string;     // Version of consent policy
  
  // Default data (untuk auto-fill)
  default_address?: string;
  default_rt_rw?: string;
  default_kelurahan?: string;
  
  // Personal data (dari interaksi sebelumnya)
  nama_lengkap?: string;
  nik?: string;
  no_hp?: string;
  
  // Usage patterns
  frequent_services: string[]; // ['SKD', 'SKTM', 'jalan_rusak']
  total_complaints: number;
  total_service_requests: number;
  
  // Interaction history
  first_interaction: Date;
  last_interaction: Date;
  total_messages: number;
  
  // Sentiment tracking
  avg_sentiment_score: number;
  frustration_count: number; // Berapa kali menunjukkan frustasi
  
  // Metadata
  created_at: Date;
  updated_at: Date;
}

export interface ProfileUpdate {
  preferred_language?: PreferredLanguage;
  communication_style?: CommunicationStyle;
  response_detail?: 'brief' | 'detailed' | 'auto';
  default_address?: string;
  default_rt_rw?: string;
  default_kelurahan?: string;
  nama_lengkap?: string;
  nik?: string;
  no_hp?: string;
}

// Hot-path memory cache. Durable backing lives in PostgreSQL.
const profileCache = new LRUCache<string, UserProfile>({
  maxSize: 2000,
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  name: 'user-profiles',
});

const profilePersistTimers = new Map<string, NodeJS.Timeout>();
const profileHydrationInFlight = new Map<string, Promise<void>>();
const PROFILE_PERSIST_DEBOUNCE_MS = 500;

logger.info('👤 User Profile Service initialized (hybrid cache + durable store)');

function mergeDistinctServices(primary: string[], secondary: string[]): string[] {
  const merged = [...secondary, ...primary].filter(Boolean);
  return Array.from(new Set(merged)).slice(-10);
}

function mergeProfiles(local: UserProfile, durable: UserProfile | null): UserProfile {
  if (!durable) {
    return local;
  }

  return {
    wa_user_id: local.wa_user_id,
    preferred_language: local.preferred_language !== 'auto' ? local.preferred_language : durable.preferred_language,
    communication_style: local.communication_style !== 'auto' ? local.communication_style : durable.communication_style,
    response_detail: local.response_detail !== 'auto' ? local.response_detail : durable.response_detail,
    data_consent: local.data_consent || durable.data_consent,
    data_consent_at: local.data_consent_at ?? durable.data_consent_at,
    data_consent_version: local.data_consent_version ?? durable.data_consent_version,
    default_address: local.default_address ?? durable.default_address,
    default_rt_rw: local.default_rt_rw ?? durable.default_rt_rw,
    default_kelurahan: local.default_kelurahan ?? durable.default_kelurahan,
    nama_lengkap: local.nama_lengkap ?? durable.nama_lengkap,
    nik: local.nik ?? durable.nik,
    no_hp: local.no_hp ?? durable.no_hp,
    frequent_services: mergeDistinctServices(local.frequent_services, durable.frequent_services),
    total_complaints: Math.max(local.total_complaints, durable.total_complaints),
    total_service_requests: Math.max(local.total_service_requests, durable.total_service_requests),
    first_interaction: new Date(Math.min(local.first_interaction.getTime(), durable.first_interaction.getTime())),
    last_interaction: new Date(Math.max(local.last_interaction.getTime(), durable.last_interaction.getTime())),
    total_messages: Math.max(local.total_messages, durable.total_messages),
    avg_sentiment_score: local.total_messages >= durable.total_messages
      ? local.avg_sentiment_score
      : durable.avg_sentiment_score,
    frustration_count: Math.max(local.frustration_count, durable.frustration_count),
    created_at: new Date(Math.min(local.created_at.getTime(), durable.created_at.getTime())),
    updated_at: new Date(Math.max(local.updated_at.getTime(), durable.updated_at.getTime())),
  };
}

function scheduleProfilePersist(wa_user_id: string): void {
  const existing = profilePersistTimers.get(wa_user_id);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    profilePersistTimers.delete(wa_user_id);
    persistProfileToDurableStore(wa_user_id).catch((error: any) => {
      logger.warn('Failed to persist durable user profile', {
        wa_user_id,
        error: error.message,
      });
    });
  }, PROFILE_PERSIST_DEBOUNCE_MS);

  profilePersistTimers.set(wa_user_id, timer);
}

async function persistProfileToDurableStore(wa_user_id: string): Promise<void> {
  const localProfile = profileCache.get(wa_user_id);
  if (!localProfile) {
    return;
  }

  const profile = mergeProfiles(
    localProfile,
    await loadProfileFromDurableStore(wa_user_id, { cacheResult: false }),
  );
  profileCache.set(wa_user_id, profile);

  await prisma.durable_user_profiles.upsert({
    where: { wa_user_id },
    update: {
      preferred_language: profile.preferred_language,
      communication_style: profile.communication_style,
      response_detail: profile.response_detail,
      data_consent: profile.data_consent,
      data_consent_at: profile.data_consent_at ?? null,
      data_consent_version: profile.data_consent_version ?? null,
      default_address: profile.default_address ?? null,
      default_rt_rw: profile.default_rt_rw ?? null,
      default_kelurahan: profile.default_kelurahan ?? null,
      nama_lengkap: profile.nama_lengkap ?? null,
      nik: profile.nik ?? null,
      no_hp: profile.no_hp ?? null,
      frequent_services: profile.frequent_services,
      total_complaints: profile.total_complaints,
      total_service_requests: profile.total_service_requests,
      first_interaction: profile.first_interaction,
      last_interaction: profile.last_interaction,
      total_messages: profile.total_messages,
      avg_sentiment_score: profile.avg_sentiment_score,
      frustration_count: profile.frustration_count,
      created_at: profile.created_at,
    },
    create: {
      wa_user_id,
      preferred_language: profile.preferred_language,
      communication_style: profile.communication_style,
      response_detail: profile.response_detail,
      data_consent: profile.data_consent,
      data_consent_at: profile.data_consent_at ?? null,
      data_consent_version: profile.data_consent_version ?? null,
      default_address: profile.default_address ?? null,
      default_rt_rw: profile.default_rt_rw ?? null,
      default_kelurahan: profile.default_kelurahan ?? null,
      nama_lengkap: profile.nama_lengkap ?? null,
      nik: profile.nik ?? null,
      no_hp: profile.no_hp ?? null,
      frequent_services: profile.frequent_services,
      total_complaints: profile.total_complaints,
      total_service_requests: profile.total_service_requests,
      first_interaction: profile.first_interaction,
      last_interaction: profile.last_interaction,
      total_messages: profile.total_messages,
      avg_sentiment_score: profile.avg_sentiment_score,
      frustration_count: profile.frustration_count,
      created_at: profile.created_at,
    },
  });
}

async function loadProfileFromDurableStore(
  wa_user_id: string,
  options: { cacheResult?: boolean } = {},
): Promise<UserProfile | null> {
  try {
    const stored = await prisma.durable_user_profiles.findUnique({
      where: { wa_user_id },
    });

    if (!stored) {
      return null;
    }

    const profile: UserProfile = {
      wa_user_id: stored.wa_user_id,
      preferred_language: stored.preferred_language as PreferredLanguage,
      communication_style: stored.communication_style as CommunicationStyle,
      response_detail: stored.response_detail as 'brief' | 'detailed' | 'auto',
      data_consent: stored.data_consent,
      data_consent_at: stored.data_consent_at ?? undefined,
      data_consent_version: stored.data_consent_version ?? undefined,
      default_address: stored.default_address ?? undefined,
      default_rt_rw: stored.default_rt_rw ?? undefined,
      default_kelurahan: stored.default_kelurahan ?? undefined,
      nama_lengkap: stored.nama_lengkap ?? undefined,
      nik: stored.nik ?? undefined,
      no_hp: stored.no_hp ?? undefined,
      frequent_services: stored.frequent_services || [],
      total_complaints: stored.total_complaints,
      total_service_requests: stored.total_service_requests,
      first_interaction: stored.first_interaction,
      last_interaction: stored.last_interaction,
      total_messages: stored.total_messages,
      avg_sentiment_score: stored.avg_sentiment_score,
      frustration_count: stored.frustration_count,
      created_at: stored.created_at,
      updated_at: stored.updated_at,
    };

    if (options.cacheResult !== false) {
      profileCache.set(wa_user_id, profile);
    }
    return profile;
  } catch (error: any) {
    logger.warn('Failed to load durable user profile', {
      wa_user_id,
      error: error.message,
    });
    return null;
  }
}

function maybeHydrateProfileCache(wa_user_id: string): void {
  if (profileHydrationInFlight.has(wa_user_id)) {
    return;
  }

  const loadPromise = loadProfileFromDurableStore(wa_user_id, { cacheResult: false })
    .then((durableProfile) => {
      if (!durableProfile) {
        return;
      }

      const cached = profileCache.get(wa_user_id);
      if (!cached) {
        profileCache.set(wa_user_id, durableProfile);
        return;
      }

      profileCache.set(wa_user_id, mergeProfiles(cached, durableProfile));
    })
    .catch((error: any) => {
      logger.debug('Durable profile hydration skipped', {
        wa_user_id,
        error: error.message,
      });
    })
    .finally(() => {
      profileHydrationInFlight.delete(wa_user_id);
    });

  profileHydrationInFlight.set(wa_user_id, loadPromise);
}

// ==================== CORE FUNCTIONS ====================

/**
 * Get or create user profile
 */
export function getProfile(wa_user_id: string): UserProfile {
  let profile = profileCache.get(wa_user_id);
  
  if (!profile) {
    profile = createDefaultProfile(wa_user_id);
    profileCache.set(wa_user_id, profile);
    maybeHydrateProfileCache(wa_user_id);
    
    logger.info('👤 New user profile created', { wa_user_id });
  }
  
  return profile;
}

export async function getProfileWithFallback(wa_user_id: string): Promise<UserProfile> {
  const cached = profileCache.get(wa_user_id);
  if (cached) {
    return cached;
  }

  const durable = await loadProfileFromDurableStore(wa_user_id);
  if (durable) {
    return durable;
  }

  const profile = createDefaultProfile(wa_user_id);
  profileCache.set(wa_user_id, profile);
  return profile;
}

/**
 * Create default profile for new user
 */
function createDefaultProfile(wa_user_id: string): UserProfile {
  const now = new Date();
  
  return {
    wa_user_id,
    preferred_language: 'auto',
    communication_style: 'auto',
    response_detail: 'auto',
    data_consent: false,
    frequent_services: [],
    total_complaints: 0,
    total_service_requests: 0,
    first_interaction: now,
    last_interaction: now,
    total_messages: 0,
    avg_sentiment_score: 0,
    frustration_count: 0,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Clear/reset user profile — removes all personal data (name, phone, etc.)
 * Used when admin clears a conversation or user resets their chat.
 */
export function clearProfile(wa_user_id: string): void {
  const existing = profileCache.get(wa_user_id);
  if (existing) {
    // Reset personal fields but keep interaction stats
    existing.nama_lengkap = undefined;
    existing.nik = undefined;
    existing.no_hp = undefined;
    existing.default_address = undefined;
    existing.default_rt_rw = undefined;
    existing.default_kelurahan = undefined;
    existing.updated_at = new Date();
    scheduleProfilePersist(wa_user_id);
    logger.info('👤 Profile cleared (personal data reset)', { wa_user_id });
  }
}

/**
 * Fully delete user profile from cache — removes the entire entry.
 * Used when admin deletes a conversation so AI has zero memory of the user.
 * Tidak ada persistence durable di layer ini; penghapusan hanya membersihkan cache aktif.
 */
export function deleteProfile(wa_user_id: string): boolean {
  const existingTimer = profilePersistTimers.get(wa_user_id);
  if (existingTimer) {
    clearTimeout(existingTimer);
    profilePersistTimers.delete(wa_user_id);
  }

  const existed = profileCache.delete(wa_user_id);
  if (existed) {
    logger.info('🗑️ Profile fully deleted', { wa_user_id });
  }

  prisma.durable_user_profiles.deleteMany({
    where: { wa_user_id },
  }).catch(() => {});
  deleteAllMemories(wa_user_id).catch(() => {});

  return existed;
}

export function recordComplaintCreated(wa_user_id: string, category?: string): UserProfile {
  const profile = getProfile(wa_user_id);
  profile.total_complaints += 1;
  profile.last_interaction = new Date();
  profile.updated_at = new Date();

  if (category) {
    if (!profile.frequent_services.includes(category)) {
      profile.frequent_services.push(category);
      if (profile.frequent_services.length > 10) {
        profile.frequent_services.shift();
      }
    } else {
      profile.frequent_services = profile.frequent_services.filter((item) => item !== category);
      profile.frequent_services.push(category);
    }
  }

  scheduleProfilePersist(wa_user_id);
  return profile;
}

/**
 * Update user profile
 */
export function updateProfile(wa_user_id: string, updates: ProfileUpdate): UserProfile {
  const profile = getProfile(wa_user_id);
  
  // Apply updates
  if (updates.preferred_language !== undefined) profile.preferred_language = updates.preferred_language;
  if (updates.communication_style !== undefined) profile.communication_style = updates.communication_style;
  if (updates.response_detail !== undefined) profile.response_detail = updates.response_detail;
  if (updates.default_address !== undefined) profile.default_address = updates.default_address;
  if (updates.default_rt_rw !== undefined) profile.default_rt_rw = updates.default_rt_rw;
  if (updates.default_kelurahan !== undefined) profile.default_kelurahan = updates.default_kelurahan;
  if (updates.nama_lengkap !== undefined) profile.nama_lengkap = updates.nama_lengkap;
  if (updates.nik !== undefined) profile.nik = encryptPii(updates.nik);
  if (updates.no_hp !== undefined) profile.no_hp = encryptPii(updates.no_hp);
  
  profile.updated_at = new Date();
  scheduleProfilePersist(wa_user_id);
  
  logger.debug('👤 Profile updated', { wa_user_id, updates: Object.keys(updates) });
  
  return profile;
}

/**
 * Record user interaction (call on every message)
 */
export function recordInteraction(
  wa_user_id: string,
  sentimentScore: number,
  intent?: string
): void {
  const profile = getProfile(wa_user_id);
  
  profile.total_messages++;
  profile.last_interaction = new Date();
  
  // Update average sentiment (rolling average)
  const oldAvg = profile.avg_sentiment_score;
  const n = Math.min(profile.total_messages, 100); // Cap at 100 for rolling average
  profile.avg_sentiment_score = oldAvg + (sentimentScore - oldAvg) / n;
  
  // Track frustration
  if (sentimentScore < -0.5) {
    profile.frustration_count++;
  }

  scheduleProfilePersist(wa_user_id);
}

/**
 * Record service usage (untuk tracking frequent services)
 */
export function recordServiceUsage(wa_user_id: string, serviceCode: string): void {
  const profile = getProfile(wa_user_id);
  
  // Add to frequent services if not already there
  if (!profile.frequent_services.includes(serviceCode)) {
    profile.frequent_services.push(serviceCode);
    
    // Keep only last 10 services
    if (profile.frequent_services.length > 10) {
      profile.frequent_services.shift();
    }
  } else {
    // Move to end (most recent)
    profile.frequent_services = profile.frequent_services.filter(s => s !== serviceCode);
    profile.frequent_services.push(serviceCode);
  }
  
  profile.updated_at = new Date();
  scheduleProfilePersist(wa_user_id);
}

/**
 * Learn user data from message (auto-extract and save)
 */
export function learnFromMessage(wa_user_id: string, message: string): void {
  const profile = getProfile(wa_user_id);
  let updated = false;
  
  // NIK extraction REMOVED — chat never asks for NIK, passive extraction
  // causes false positives (any 16-digit number) and privacy concerns.
  // NIK is only collected via public service form (Case Service).
  
  // Extract phone if not already saved
  if (!profile.no_hp) {
    const phoneMatch = message.match(/\b(08\d{8,12})\b/);
    if (phoneMatch) {
      profile.no_hp = encryptPii(phoneMatch[1]);
      updated = true;
      logger.debug('👤 Learned phone from message (encrypted)', { wa_user_id });
    }
  }
  
  // Detect communication style from message
  if (profile.communication_style === 'auto') {
    const informalPatterns = /\b(gw|gue|gua|lu|lo|elu|elo|bro|sis|gan|cuy|wkwk|haha|dong|deh|sih|nih)\b/i;
    const formalPatterns = /\b(saya|anda|bapak|ibu|mohon|terima kasih|dengan hormat)\b/i;
    
    if (informalPatterns.test(message)) {
      profile.communication_style = 'informal';
      updated = true;
    } else if (formalPatterns.test(message)) {
      profile.communication_style = 'formal';
      updated = true;
    }
  }
  
  if (updated) {
    profile.updated_at = new Date();
    scheduleProfilePersist(wa_user_id);
  }
}

/**
 * Save address from successful complaint (untuk auto-fill berikutnya)
 */
export function saveDefaultAddress(wa_user_id: string, alamat: string, rt_rw?: string): void {
  const profile = getProfile(wa_user_id);
  
  // Only save if address is specific enough
  if (alamat && alamat.length >= 10) {
    profile.default_address = alamat;
    if (rt_rw) {
      profile.default_rt_rw = rt_rw;
    }
    profile.updated_at = new Date();
    scheduleProfilePersist(wa_user_id);

    logger.debug('👤 Saved default address', { wa_user_id, alamat: alamat.substring(0, 30) });
  }
}

// ==================== CONTEXT HELPERS ====================

/**
 * Get profile context for LLM prompt
 */
export function getProfileContext(wa_user_id: string): string {
  const profile = getProfile(wa_user_id);
  
  const parts: string[] = [];
  
  // Communication style hint
  if (profile.communication_style === 'informal') {
    parts.push('User berkomunikasi dengan gaya INFORMAL/santai. Gunakan bahasa yang santai dan friendly.');
  } else if (profile.communication_style === 'formal') {
    parts.push('User berkomunikasi dengan gaya FORMAL. Gunakan bahasa yang sopan dan profesional.');
  }
  
  // Returning user context
  if (profile.total_messages > 5) {
    parts.push(`User ini sudah pernah berinteraksi ${profile.total_messages}x sebelumnya.`);
    
    if (profile.total_complaints > 0) {
      parts.push(`Sudah membuat ${profile.total_complaints} laporan sebelumnya.`);
    }
    if (profile.total_service_requests > 0) {
      parts.push(`Sudah membuat ${profile.total_service_requests} layanan sebelumnya.`);
    }
  }
  
  // Frustration warning
  if (profile.frustration_count >= 3 || profile.avg_sentiment_score < -0.3) {
    parts.push('⚠️ User ini pernah menunjukkan frustasi. Berikan response yang lebih empati dan helpful.');
  }
  
  // Known data (Temuan 6: mask full name before sending to LLM)
  if (profile.nama_lengkap) {
    const masked = maskName(profile.nama_lengkap);
    parts.push(`Nama user: ${masked}`);
  }
  
  if (parts.length === 0) {
    return '';
  }
  
  return `\n[USER PROFILE]\n${parts.join('\n')}`;
}

/**
 * Get auto-fill suggestions for forms
 */
export function getAutoFillSuggestions(wa_user_id: string): {
  alamat?: string;
  rt_rw?: string;
  nama_lengkap?: string;
  nik?: string;
  no_hp?: string;
} {
  const profile = getProfile(wa_user_id);
  
  return {
    alamat: profile.default_address,
    rt_rw: profile.default_rt_rw,
    nama_lengkap: profile.nama_lengkap,
    nik: profile.nik ? decryptPii(profile.nik) : undefined,
    no_hp: profile.no_hp ? decryptPii(profile.no_hp) : undefined,
  };
}

export async function getAutoFillSuggestionsWithFallback(wa_user_id: string): Promise<{
  alamat?: string;
  rt_rw?: string;
  nama_lengkap?: string;
  nik?: string;
  no_hp?: string;
}> {
  const profile = await getProfileWithFallback(wa_user_id);

  return {
    alamat: profile.default_address,
    rt_rw: profile.default_rt_rw,
    nama_lengkap: profile.nama_lengkap,
    nik: profile.nik ? decryptPii(profile.nik) : undefined,
    no_hp: profile.no_hp ? decryptPii(profile.no_hp) : undefined,
  };
}

/**
 * Check if user is a returning user
 */
export function isReturningUser(wa_user_id: string): boolean {
  const profile = profileCache.get(wa_user_id);
  return profile !== undefined && profile.total_messages > 1;
}

/**
 * Get user's most frequent service
 */
export function getMostFrequentService(wa_user_id: string): string | null {
  const profile = getProfile(wa_user_id);
  
  if (profile.frequent_services.length === 0) {
    return null;
  }
  
  // Return most recent (last in array)
  return profile.frequent_services[profile.frequent_services.length - 1];
}

// ==================== UU PDP CONSENT (Fase 3.6) ====================

const CONSENT_VERSION = '1.0';

/**
 * Record user data processing consent
 */
export function recordConsent(wa_user_id: string): UserProfile {
  const profile = getProfile(wa_user_id);
  profile.data_consent = true;
  profile.data_consent_at = new Date();
  profile.data_consent_version = CONSENT_VERSION;
  profile.updated_at = new Date();
  profileCache.set(wa_user_id, profile);
  scheduleProfilePersist(wa_user_id);
  logger.info('📋 User data consent recorded', { wa_user_id, version: CONSENT_VERSION });
  return profile;
}

/**
 * Revoke user data processing consent and delete PII
 */
export function revokeConsent(wa_user_id: string): void {
  const profile = getProfile(wa_user_id);
  profile.data_consent = false;
  profile.data_consent_at = undefined;
  profile.nama_lengkap = undefined;
  profile.nik = undefined;
  profile.no_hp = undefined;
  profile.updated_at = new Date();
  profileCache.set(wa_user_id, profile);
  scheduleProfilePersist(wa_user_id);
  logger.info('📋 User consent revoked, PII deleted', { wa_user_id });
}

/**
 * Check if user has given consent for PII storage
 */
export function hasConsent(wa_user_id: string): boolean {
  const profile = profileCache.get(wa_user_id);
  return profile?.data_consent === true;
}

// ==================== CLEANUP ====================

export default {
  getProfile,
  getProfileWithFallback,
  updateProfile,
  deleteProfile,
  recordInteraction,
  recordComplaintCreated,
  recordServiceUsage,
  learnFromMessage,
  saveDefaultAddress,
  getProfileContext,
  getAutoFillSuggestions,
  getAutoFillSuggestionsWithFallback,
  isReturningUser,
  getMostFrequentService,
  recordConsent,
  revokeConsent,
  hasConsent,
};
