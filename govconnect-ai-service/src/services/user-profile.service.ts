/**
 * User Profile & Preference Memory Service
 * 
 * Menyimpan dan mengelola preferensi user untuk personalisasi response:
 * - Bahasa/gaya komunikasi (formal/informal)
 * - Alamat default (untuk laporan)
 * - Layanan yang sering digunakan
 * - Riwayat interaksi
 * 
 * Data disimpan di file JSON (production: gunakan Redis/Database)
 */

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

// ==================== TYPES ====================

export type CommunicationStyle = 'formal' | 'informal' | 'auto';
export type PreferredLanguage = 'indonesian' | 'sundanese' | 'javanese' | 'auto';

export interface UserProfile {
  wa_user_id: string;
  
  // Communication preferences
  preferred_language: PreferredLanguage;
  communication_style: CommunicationStyle;
  response_detail: 'brief' | 'detailed' | 'auto';
  
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

// ==================== STORAGE ====================

const PROFILES_FILE_PATH = path.join(process.cwd(), 'data', 'user-profiles.json');
const SAVE_INTERVAL_MS = 60000; // Save every 1 minute

// In-memory cache
const profileCache = new Map<string, UserProfile>();
let isDirty = false;
let saveInterval: ReturnType<typeof setInterval> | null = null;

// ==================== INITIALIZATION ====================

/**
 * Load profiles from file
 */
function loadProfiles(): void {
  try {
    const dataDir = path.dirname(PROFILES_FILE_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(PROFILES_FILE_PATH)) {
      const data = fs.readFileSync(PROFILES_FILE_PATH, 'utf-8');
      const profiles = JSON.parse(data) as UserProfile[];
      
      for (const profile of profiles) {
        // Convert date strings back to Date objects
        profile.first_interaction = new Date(profile.first_interaction);
        profile.last_interaction = new Date(profile.last_interaction);
        profile.created_at = new Date(profile.created_at);
        profile.updated_at = new Date(profile.updated_at);

        if ((profile as any).total_service_requests === undefined) {
          (profile as any).total_service_requests = 0;
        }
        
        profileCache.set(profile.wa_user_id, profile);
      }
      
      logger.info('👤 User profiles loaded', { count: profileCache.size });
    }
  } catch (error) {
    logger.warn('⚠️ Could not load user profiles, starting fresh', {
      error: (error as Error).message,
    });
  }
}

/**
 * Save profiles to file
 */
function saveProfiles(): void {
  if (!isDirty) return;
  
  try {
    const dataDir = path.dirname(PROFILES_FILE_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const profiles = Array.from(profileCache.values());
    fs.writeFileSync(PROFILES_FILE_PATH, JSON.stringify(profiles, null, 2));
    isDirty = false;
    
    logger.debug('💾 User profiles saved', { count: profiles.length });
  } catch (error) {
    logger.error('❌ Failed to save user profiles', {
      error: (error as Error).message,
    });
  }
}

/**
 * Start periodic save
 */
function startPeriodicSave(): void {
  if (saveInterval) return;
  
  saveInterval = setInterval(() => {
    saveProfiles();
  }, SAVE_INTERVAL_MS);
}

// Initialize on module load
loadProfiles();
startPeriodicSave();

// ==================== CORE FUNCTIONS ====================

/**
 * Get or create user profile
 */
export function getProfile(wa_user_id: string): UserProfile {
  let profile = profileCache.get(wa_user_id);
  
  if (!profile) {
    profile = createDefaultProfile(wa_user_id);
    profileCache.set(wa_user_id, profile);
    isDirty = true;
    
    logger.info('👤 New user profile created', { wa_user_id });
  }
  
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
  if (updates.nik !== undefined) profile.nik = updates.nik;
  if (updates.no_hp !== undefined) profile.no_hp = updates.no_hp;
  
  profile.updated_at = new Date();
  isDirty = true;
  
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
  
  // Track frequent services
  if (intent) {
    if (intent === 'CREATE_COMPLAINT') {
      profile.total_complaints++;
    } else if (intent === 'CREATE_SERVICE_REQUEST') {
      profile.total_service_requests++;
    }
  }
  
  profile.updated_at = new Date();
  isDirty = true;
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
  isDirty = true;
}

/**
 * Learn user data from message (auto-extract and save)
 */
export function learnFromMessage(wa_user_id: string, message: string): void {
  const profile = getProfile(wa_user_id);
  let updated = false;
  
  // Extract NIK if not already saved
  if (!profile.nik) {
    const nikMatch = message.match(/\b(\d{16})\b/);
    if (nikMatch) {
      profile.nik = nikMatch[1];
      updated = true;
      logger.debug('👤 Learned NIK from message', { wa_user_id });
    }
  }
  
  // Extract phone if not already saved
  if (!profile.no_hp) {
    const phoneMatch = message.match(/\b(08\d{8,12})\b/);
    if (phoneMatch) {
      profile.no_hp = phoneMatch[1];
      updated = true;
      logger.debug('👤 Learned phone from message', { wa_user_id });
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
    isDirty = true;
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
    isDirty = true;
    
    logger.debug('👤 Saved default address', { wa_user_id, alamat: alamat.substring(0, 30) });
  }
}

/**
 * Get last known address for auto-fill context
 */
export function getLastAddress(wa_user_id: string): string | null {
  const profile = getProfile(wa_user_id);
  if (profile.default_address) {
    return profile.default_address;
  }
  return null;
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
  
  // Known data
  if (profile.nama_lengkap) {
    parts.push(`Nama user: ${profile.nama_lengkap}`);
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
    nik: profile.nik,
    no_hp: profile.no_hp,
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

// ==================== CLEANUP ====================

/**
 * Force save (for shutdown)
 */
export function forceSave(): void {
  isDirty = true;
  saveProfiles();
}

/**
 * Shutdown cleanup
 */
export function shutdown(): void {
  if (saveInterval) {
    clearInterval(saveInterval);
  }
  forceSave();
  logger.info('👤 User Profile Service shutdown complete');
}

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default {
  getProfile,
  updateProfile,
  recordInteraction,
  recordServiceUsage,
  learnFromMessage,
  saveDefaultAddress,
  getProfileContext,
  getAutoFillSuggestions,
  isReturningUser,
  getMostFrequentService,
  forceSave,
  shutdown,
};
