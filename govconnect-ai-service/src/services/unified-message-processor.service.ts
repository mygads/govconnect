/**
 * Unified Message Processor Service
 * 
 * SINGLE SOURCE OF TRUTH untuk memproses pesan dari berbagai channel:
 * - WhatsApp (via RabbitMQ)
 * - Webchat (via HTTP)
 * - Channel lain (opsional)
 * 
 * Semua logic NLU, intent detection, RAG, prompt building, dan action handling
 * dipusatkan di sini agar response konsisten di semua channel.
 * 
 * IMPORTANT: File ini berisi semua logic yang sudah di-test dan dilatih dengan baik.
 * Jangan ubah tanpa testing yang memadai.
 * 
 * OPTIMIZATIONS (December 2025):
 * - Fast Intent Classification: Skip LLM untuk intent yang jelas
 * - Response Caching: Cache response untuk pertanyaan berulang
 * - Entity Pre-extraction: Ekstrak data sebelum LLM
 */

import logger from '../utils/logger';
import { buildContext, buildKnowledgeQueryContext, sanitizeUserInput } from './context-builder.service';
import { callGemini } from './llm.service';
import {
  createComplaint,
  cancelComplaint,
  cancelServiceRequest,
  getComplaintTypes,
  getUserHistory,
  updateComplaintByUser,
  getServiceRequestStatusWithOwnership,
  requestServiceRequestEditToken,
  getServiceRequirements,
  ServiceRequirementDefinition,
  HistoryItem,
} from './case-client.service';
import { getImportantContacts } from './important-contacts.service';
import { searchKnowledge, searchKnowledgeKeywordsOnly, getRAGContext, getKelurahanInfoContext, getVillageProfileSummary } from './knowledge.service';
import { shouldRetrieveContext, isSpamMessage } from './rag.service';
import { detectLanguage, getLanguageContext } from './language-detection.service';
import { analyzeSentiment, getSentimentContext, needsHumanEscalation } from './sentiment-analysis.service';
import { rateLimiterService } from './rate-limiter.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { RAGContext } from '../types/embedding.types';
import { preProcessMessage, postProcessResponse, shouldUseFastPath, buildFastPathResponse } from './ai-optimizer.service';
import { learnFromMessage, recordInteraction, saveDefaultAddress, getProfileContext, recordServiceUsage, updateProfile, getProfile } from './user-profile.service';
import { getEnhancedContext, updateContext, recordDataCollected, recordCompletedAction, getContextForLLM } from './conversation-context.service';
import { adaptResponse, buildAdaptationContext } from './response-adapter.service';
import { linkUserToPhone, recordChannelActivity, updateSharedData, getCrossChannelContextForLLM } from './cross-channel-context.service';
import { normalizeText } from './text-normalizer.service';
import {
  appendAntiHallucinationInstruction,
  hasKnowledgeInPrompt,
  logAntiHallucinationEvent,
  needsAntiHallucinationRetry,
} from './anti-hallucination.service';

// ==================== TYPES ====================

export type ChannelType = 'whatsapp' | 'webchat' | 'other';

export interface ProcessMessageInput {
  /** Unique user identifier (wa_user_id for WhatsApp, session_id for webchat) */
  userId: string;
  /** Optional tenant context (GovConnect village_id) */
  villageId?: string;
  /** The message text from user */
  message: string;
  /** Channel source */
  channel: ChannelType;
  /** Optional conversation history (for webchat that doesn't use Channel Service) */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Optional media URL (for complaints with photos) */
  mediaUrl?: string;
  /** Optional media type */
  mediaType?: string;
}

export interface ProcessMessageResult {
  success: boolean;
  /** Main response text */
  response: string;
  /** Optional guidance/follow-up text (sent as separate bubble in WhatsApp) */
  guidanceText?: string;
  /** Detected intent */
  intent: string;
  /** Extracted fields from NLU */
  fields?: Record<string, any>;
  /** Processing metadata */
  metadata: {
    processingTimeMs: number;
    model?: string;
    hasKnowledge: boolean;
    knowledgeConfidence?: string;
    sentiment?: string;
    language?: string;
  };
  /** Error message if failed */
  error?: string;
}

// ==================== IN-MEMORY CACHES ====================

// Address confirmation state cache
// Key: userId, Value: { alamat, kategori, deskripsi, timestamp, foto_url }
const pendingAddressConfirmation: Map<string, {
  alamat: string;
  kategori: string;
  deskripsi: string;
  village_id?: string;
  timestamp: number;
  foto_url?: string;
}> = new Map();

// Cancellation confirmation state cache
// Key: userId, Value: { type, id, reason, timestamp }
const pendingCancelConfirmation: Map<string, {
  type: 'laporan' | 'layanan';
  id: string;
  reason?: string;
  timestamp: number;
}> = new Map();

// Name confirmation state cache
// Key: userId, Value: { name, timestamp }
const pendingNameConfirmation: Map<string, {
  name: string;
  timestamp: number;
}> = new Map();

// Online service form offer state cache
// Key: userId, Value: { service_slug, village_id, timestamp }
const pendingServiceFormOffer: Map<string, {
  service_slug: string;
  village_id?: string;
  timestamp: number;
}> = new Map();

// Complaint types cache (per village)
const complaintTypeCache: Map<string, { data: any[]; timestamp: number }> = new Map();

// Cleanup expired confirmations (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  const expireMs = 10 * 60 * 1000; // 10 minutes
  for (const [key, value] of pendingAddressConfirmation.entries()) {
    if (now - value.timestamp > expireMs) {
      pendingAddressConfirmation.delete(key);
      logger.debug('Cleaned up expired address confirmation', { userId: key });
    }
  }
  for (const [key, value] of pendingCancelConfirmation.entries()) {
    if (now - value.timestamp > expireMs) {
      pendingCancelConfirmation.delete(key);
      logger.debug('Cleaned up expired cancel confirmation', { userId: key });
    }
  }
  for (const [key, value] of pendingNameConfirmation.entries()) {
    if (now - value.timestamp > expireMs) {
      pendingNameConfirmation.delete(key);
      logger.debug('Cleaned up expired name confirmation', { userId: key });
    }
  }
  for (const [key, value] of pendingServiceFormOffer.entries()) {
    if (now - value.timestamp > expireMs) {
      pendingServiceFormOffer.delete(key);
      logger.debug('Cleaned up expired service form offer', { userId: key });
    }
  }
}, 60 * 1000);

// ==================== RESPONSE VALIDATION ====================

/**
 * Profanity patterns to filter from AI response
 */
const PROFANITY_PATTERNS = [
  /\b(anjing|babi|bangsat|kontol|memek|ngentot|jancok|kampret|tai|asu|bajingan|keparat)\b/gi,
  /\b(bodoh|tolol|idiot|goblok|bego|dungu)\b/gi,
];

/**
 * Validate and sanitize AI response before sending to user
 */
export function validateResponse(response: string): string {
  if (!response || response.trim().length === 0) {
    return 'Ada yang bisa saya bantu lagi?';
  }
  
  let cleaned = response;
  for (const pattern of PROFANITY_PATTERNS) {
    cleaned = cleaned.replace(pattern, '***');
  }
  
  // Ensure response isn't too long
  if (cleaned.length > 4000) {
    cleaned = cleaned.substring(0, 3950) + '...\n\nPesan terpotong karena terlalu panjang.';
  }
  
  // Remove raw JSON/code artifacts
  if (cleaned.includes('```') || cleaned.includes('{"')) {
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    cleaned = cleaned.replace(/\{\"[\s\S]*?\}/g, '');
    cleaned = cleaned.trim();
    
    if (cleaned.length < 10) {
      return 'Maaf, terjadi kesalahan. Silakan ulangi pertanyaan Anda.';
    }
  }
  
  return cleaned;
}

// ==================== ADDRESS VALIDATION ====================

/**
 * Check if an address is too vague/incomplete
 * Returns true if address needs confirmation
 * 
 * NOTE: We are MORE LENIENT now - informal addresses with landmarks are ACCEPTED
 */
export function isVagueAddress(alamat: string): boolean {
  if (!alamat) return true;
  
  const cleanAlamat = alamat.toLowerCase().trim();
  
  // If the "address" contains complaint keywords, it's not an address at all!
  const complaintKeywords = [
    /menumpuk/i, /tumpukan/i, /berserakan/i,
    /rusak/i, /berlubang/i, /retak/i,
    /mati/i, /padam/i, /tidak\s+menyala/i,
    /tersumbat/i, /banjir/i, /genangan/i,
    /tumbang/i, /roboh/i, /patah/i,
    /menghalangi/i, /menutupi/i,
    /sampah/i, /limbah/i, /kotoran/i,
  ];
  
  if (complaintKeywords.some(pattern => pattern.test(cleanAlamat))) {
    return true;
  }
  
  // Check if address contains a LANDMARK - if so, it's VALID!
  const landmarkPatterns = [
    /masjid\s+\w+/i, /mushola/i, /gereja\s+\w+/i,
    /sekolah\s+\w+/i, /sd\s*n?\s*\d*/i, /smp\s*n?\s*\d*/i, /sma\s*n?\s*\d*/i, /smk\s*n?\s*\d*/i,
    /warung\s+\w+/i, /toko\s+\w+/i, /pasar\s+\w+/i, /kantor\s+\w+/i,
    /puskesmas/i, /posyandu/i, /lapangan\s+\w*/i, /taman\s+\w+/i,
    /makam\s+\w*/i, /kuburan/i, /pertigaan/i, /perempatan/i, /bundaran/i,
    /jembatan\s+\w*/i, /terminal\s+\w*/i, /stasiun\s+\w*/i,
    /bank\s+\w+/i, /atm\s+\w*/i, /alfamart/i, /indomaret/i, /spbu/i,
  ];
  
  if (landmarkPatterns.some(pattern => pattern.test(cleanAlamat))) {
    return false;
  }
  
  // Check for street/location identifiers
  const hasLocationIdentifiers = [
    /\bno\.?\s*\d+/i, /\bnomor\s*\d+/i,
    /\brt\s*\.?\s*\d+/i, /\brw\s*\.?\s*\d+/i,
    /\bblok\s*[a-z0-9]+/i, /\bgang\s+\w+/i, /\bgg\.?\s*\w+/i,
    /\bkomplek\s+\w+/i, /\bperumahan\s+\w+/i,
    /\bjalan\s+[a-z]+/i, /\bjln\.?\s+[a-z]+/i, /\bjl\.?\s+[a-z]+/i,
    /depan\s+\w+\s+\w+/i, /sebelah\s+\w+/i, /belakang\s+\w+/i, /samping\s+\w+/i,
  ].some(pattern => pattern.test(cleanAlamat));
  
  if (hasLocationIdentifiers) {
    return false;
  }
  
  // List of patterns that are truly TOO vague
  const vaguePatterns = [
    /^jalan\s*raya$/i, /^jln\s*raya$/i, /^jl\.?\s*raya$/i,
    /^kelurahan$/i, /^kecamatan$/i, /^desa$/i,
    /^di\s*sini$/i, /^sini$/i,
  ];
  
  if (vaguePatterns.some(pattern => pattern.test(cleanAlamat))) {
    return true;
  }
  
  // If address is very short (< 5 chars), it's probably too vague
  if (cleanAlamat.length < 5) {
    return true;
  }
  
  // Default: Accept the address (be lenient)
  return false;
}

/**
 * Check if message is a confirmation response
 */
export function isConfirmationResponse(message: string): boolean {
  const cleanMessage = message.trim().toLowerCase();
  
  const confirmPatterns = [
    /^ya$/i, /^iya$/i, /^yap$/i, /^yup$/i,
    /^ok$/i, /^oke$/i, /^okey$/i, /^okay$/i,
    /^baik$/i, /^lanjut$/i, /^lanjutkan$/i, /^setuju$/i, /^boleh$/i, /^silakan$/i, /^siap$/i,
    /^buat\s*(saja|aja)?$/i, /^proses\s*(saja|aja)?$/i, /^kirim\s*(saja|aja)?$/i,
    /^ya,?\s*(lanjutkan|lanjut|buat|proses)/i,
    /^sudah\s*(cukup)?$/i, /^cukup$/i, /^itu\s*(saja|aja)$/i,
    /^(itu|ini)\s*(sudah|udah)$/i, /^(sudah|udah)$/i, /^(sudah|udah)\s*(itu|ini)$/i,
    /^(udah|sudah)\s*(cukup|lengkap)$/i, /^segitu\s*(saja|aja)?$/i, /^ya\s*(sudah|udah|cukup)/i,
    /^tidak\s*(perlu)?\s*(tambah|detail)/i, /^ga\s*(perlu|usah)/i, /^gak\s*(perlu|usah)/i,
    /^nggak\s*(perlu|usah)/i, /^engga[k]?\s*(perlu|usah)/i,
  ];
  
  return confirmPatterns.some(pattern => pattern.test(cleanMessage));
}

function isNegativeConfirmation(message: string): boolean {
  const cleanMessage = message.trim().toLowerCase();
  const rejectPatterns = [
    /^tidak$/i, /^ga$/i, /^gak$/i, /^nggak$/i, /^engga(k)?$/i,
    /^batal$/i, /^jangan$/i, /^gak jadi$/i, /^ga jadi$/i, /^nggak jadi$/i,
    /^tidak jadi$/i, /^belum$/i,
  ];
  return rejectPatterns.some(pattern => pattern.test(cleanMessage));
}

/**
 * Detect emergency complaint
 */
export function detectEmergencyComplaint(deskripsi: string, currentMessage: string, kategori: string): boolean {
  const combinedText = `${deskripsi} ${currentMessage}`.toLowerCase();
  
  const emergencyKeywords = [
    /darurat/i, /urgent/i, /segera/i, /bahaya/i, /berbahaya/i,
    /kecelakaan/i, /korban/i, /luka/i, /terluka/i,
    /kebakaran/i, /api/i, /terbakar/i,
    /banjir\s+besar/i, /air\s+naik/i, /tenggelam/i,
    /roboh/i, /ambruk/i, /runtuh/i,
    /listrik\s+konslet/i, /kabel\s+putus/i, /tersengat/i,
    /gas\s+bocor/i, /bau\s+gas/i,
  ];
  
  const hasEmergencyKeyword = emergencyKeywords.some(pattern => pattern.test(combinedText));
  
  const highPriorityCategories = ['pohon_tumbang', 'banjir', 'fasilitas_rusak'];
  const isHighPriorityCategory = highPriorityCategories.includes(kategori);
  
  const blockingKeywords = [
    /menghalangi/i, /menutupi/i, /menutup/i, /memblokir/i,
    /tidak\s+bisa\s+lewat/i, /jalan\s+tertutup/i,
  ];
  const hasBlockingKeyword = blockingKeywords.some(pattern => pattern.test(combinedText));
  
  return hasEmergencyKeyword || (isHighPriorityCategory && hasBlockingKeyword);
}

type HandlerResult = string | { replyText: string; guidanceText?: string };

function normalizeHandlerResult(result: HandlerResult): { replyText: string; guidanceText?: string } {
  if (typeof result === 'string') {
    return { replyText: result };
  }
  return {
    replyText: result.replyText,
    guidanceText: result.guidanceText,
  };
}

function normalizeLookupKey(value: string): string {
  return normalizeText(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function resolveServiceSlugFromSearch(query: string, villageId?: string): Promise<{ slug: string; name?: string } | null> {
  const trimmedQuery = (query || '').trim();
  if (!trimmedQuery) return null;

  try {
    const { config } = await import('../config/env');
    const axios = (await import('axios')).default;
    const response = await axios.get(`${config.caseServiceUrl}/services/search`, {
      params: {
        village_id: villageId,
        q: trimmedQuery,
        limit: 5,
      },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    });

    const services = Array.isArray(response.data?.data) ? response.data.data : [];
    if (!services.length) return null;

    const queryKey = normalizeLookupKey(trimmedQuery);

    const synonymMap: Record<string, string[]> = {
      ktp: ['kartu tanda penduduk', 'e ktp', 'ektp', 'ktpel', 'ktp el'],
      kk: ['kartu keluarga'],
      domisili: ['surat domisili', 'keterangan domisili', 'alamat tinggal'],
      pindah: ['mutasi', 'pindah datang', 'pindah keluar'],
      usaha: ['sku', 'surat keterangan usaha'],
      kelahiran: ['akta lahir', 'akte lahir'],
      kematian: ['akta mati', 'akte mati'],
      nikah: ['kawin', 'pernikahan'],
      pengantar: ['antar', 'surat pengantar'],
      kehilangan: ['hilang', 'kehilangan', 'rusak', 'penggantian'],
    };

    const buildSynonymSet = (text: string): Set<string> => {
      const base = normalizeLookupKey(text);
      const tokens = new Set(base.split(' ').filter(Boolean));
      const expanded = new Set<string>(tokens);

      for (const token of tokens) {
        const synonyms = synonymMap[token];
        if (synonyms) {
          for (const syn of synonyms) {
            const synKey = normalizeLookupKey(syn);
            synKey.split(' ').filter(Boolean).forEach(t => expanded.add(t));
          }
        }
      }

      for (const [key, synonyms] of Object.entries(synonymMap)) {
        if (base.includes(key)) {
          for (const syn of synonyms) {
            const synKey = normalizeLookupKey(syn);
            synKey.split(' ').filter(Boolean).forEach(t => expanded.add(t));
          }
        }
        for (const syn of synonyms) {
          if (base.includes(normalizeLookupKey(syn))) {
            expanded.add(key);
            const synKey = normalizeLookupKey(syn);
            synKey.split(' ').filter(Boolean).forEach(t => expanded.add(t));
          }
        }
      }

      return expanded;
    };

    const queryTokens = buildSynonymSet(queryKey);

    const scoreService = (service: any): number => {
      const name = normalizeLookupKey(service?.name || '');
      const slug = normalizeLookupKey(service?.slug || '');
      const desc = normalizeLookupKey(service?.description || '');
      const combined = `${name} ${slug} ${desc}`.trim();
      if (!combined) return 0;

      let score = 0;
      if (queryKey && combined.includes(queryKey)) score += 20;
      if (queryKey && name.includes(queryKey)) score += 15;
      if (queryKey && slug.includes(queryKey)) score += 12;

      const serviceTokens = new Set(combined.split(' ').filter(Boolean));
      let overlap = 0;
      for (const token of queryTokens) {
        if (serviceTokens.has(token)) overlap += 1;
      }
      score += overlap * 8;

      // Synonym-driven boosts
      const boostedPairs: Array<[RegExp, RegExp]> = [
        [/\b(ktp|ektp|ktpel)\b/i, /\bktp\b/i],
        [/\b(kk|kartu\s+keluarga)\b/i, /\bkk\b/i],
        [/\b(domisili|tinggal|alamat)\b/i, /domisili/i],
        [/\b(pindah|mutasi)\b/i, /pindah|mutasi/i],
        [/\b(sku|usaha)\b/i, /usaha|sku/i],
        [/\b(akta|akte)\s+lahir\b/i, /lahir/i],
        [/\b(akta|akte)\s+mati\b/i, /mati|kematian/i],
        [/\b(kawin|nikah|pernikahan)\b/i, /nikah|kawin/i],
        [/\b(hilang|rusak|penggantian)\b/i, /penggantian|perubahan|rusak|hilang/i],
      ];

      for (const [qPattern, sPattern] of boostedPairs) {
        if (qPattern.test(queryKey) && sPattern.test(combined)) {
          score += 10;
        }
      }

      return score;
    };

    const best = services
      .map((s: any) => ({ s, score: scoreService(s) }))
      .sort((a: any, b: any) => b.score - a.score)[0];

    if (!best || best.score < 10) return null;
    if (!best.s?.slug) return null;

    return { slug: String(best.s.slug), name: String(best.s.name || '') };
  } catch (error: any) {
    logger.warn('Service search lookup failed', { error: error.message, villageId });
    return null;
  }
}

async function getCachedComplaintTypes(villageId?: string): Promise<any[]> {
  if (!villageId) return [];

  const cacheKey = villageId;
  const now = Date.now();
  const cached = complaintTypeCache.get(cacheKey);
  const ttlMs = 5 * 60 * 1000; // 5 minutes

  if (cached && now - cached.timestamp < ttlMs) {
    return cached.data;
  }

  const data = await getComplaintTypes(villageId);
  complaintTypeCache.set(cacheKey, { data, timestamp: now });
  return data;
}

async function resolveComplaintTypeConfig(kategori?: string, villageId?: string) {
  if (!kategori || !villageId) return null;

  const types = await getCachedComplaintTypes(villageId);
  if (!types.length) return null;

  const target = normalizeLookupKey(kategori);

  const directMatch = types.find(type => normalizeLookupKey(type?.name || '') === target);
  if (directMatch) return directMatch;

  const categoryMatches = types.filter(type => normalizeLookupKey(type?.category?.name || '') === target);
  if (categoryMatches.length === 1) {
    return categoryMatches[0];
  }

  return null;
}

function buildImportantContactsMessage(contacts: Array<{ name: string; phone: string; description?: string | null }>): string {
  if (!contacts.length) return '';

  const lines = contacts.map(contact => {
    const desc = contact.description ? ` (${contact.description})` : '';
    return `• ${contact.name}: ${contact.phone}${desc}`;
  });

  return `\n\n📞 *Nomor Penting Terkait*\n${lines.join('\n')}`;
}

// ==================== ACTION HANDLERS ====================

/**
 * Handle complaint creation
 */
export async function handleComplaintCreation(
  userId: string,
  channel: ChannelType,
  llmResponse: any,
  currentMessage: string,
  mediaUrl?: string
): Promise<string> {
  const { kategori, rt_rw } = llmResponse.fields || {};
  let { alamat, deskripsi } = llmResponse.fields || {};
  const villageId = llmResponse.fields?.village_id || process.env.DEFAULT_VILLAGE_ID;
  const complaintTypeConfig = await resolveComplaintTypeConfig(kategori, villageId);
  const requireAddress = complaintTypeConfig?.require_address ?? false;
  
  logger.info('LLM complaint fields', {
    userId,
    kategori,
    alamat,
    deskripsi,
    rt_rw,
    hasMedia: !!mediaUrl,
    currentMessage: currentMessage.substring(0, 100),
  });
  
  // SMART ALAMAT DETECTION: If LLM didn't extract alamat, try to detect from current message
  if (!alamat) {
    alamat = extractAddressFromMessage(currentMessage, userId);
  }
  
  // FALLBACK: Extract alamat from complaint message using pattern matching
  if (!alamat && currentMessage.length > 20) {
    alamat = extractAddressFromComplaintMessage(currentMessage, userId);
  }
  
  // Fallback: if deskripsi is empty but we have kategori, generate default description
  if (!deskripsi && kategori) {
    const kategoriMap: Record<string, string> = {
      'jalan_rusak': 'Laporan jalan rusak',
      'lampu_mati': 'Laporan lampu jalan mati',
      'sampah': 'Laporan masalah sampah',
      'drainase': 'Laporan saluran air tersumbat',
      'pohon_tumbang': 'Laporan pohon tumbang',
      'fasilitas_rusak': 'Laporan fasilitas umum rusak',
      'banjir': 'Laporan banjir',
      'lainnya': 'Laporan lainnya',
    };
    deskripsi = kategoriMap[kategori] || `Laporan ${String(kategori).replace(/_/g, ' ')}`;
  }
  
  // Check if we have enough information
  if (!kategori || (requireAddress && !alamat)) {
    logger.info('Incomplete complaint data, asking for more info', {
      userId,
      hasKategori: !!kategori,
      hasAlamat: !!alamat,
      hasDeskripsi: !!deskripsi,
      requireAddress,
    });
    
    if (!kategori) {
      return 'Mohon jelaskan jenis masalah yang ingin dilaporkan (contoh: jalan rusak, lampu mati, sampah, dll).';
    }
    if (!alamat) {
      const kategoriLabelMap: Record<string, string> = {
        jalan_rusak: 'jalan rusak',
        lampu_mati: 'lampu jalan yang mati',
        sampah: 'penumpukan sampah',
        drainase: 'selokan/saluran air yang tersumbat',
        banjir: 'banjir',
        pohon_tumbang: 'pohon tumbang',
        fasilitas_rusak: 'fasilitas umum yang rusak',
      };
      const kategoriLabel = kategoriLabelMap[kategori] || kategori.replace(/_/g, ' ');
      const isEmergencyNeedAddress = detectEmergencyComplaint(deskripsi || '', currentMessage, kategori);
      if (isEmergencyNeedAddress) {
        return 'Baik Pak/Bu, mohon segera kirimkan alamat lokasi kejadian.';
      }
      return `Baik Pak/Bu, mohon jelaskan lokasi ${kategoriLabel} tersebut.`;
    }
    
    return llmResponse.reply_text;
  }
  
  // Check if alamat is too vague - ask for confirmation
  if (alamat && isVagueAddress(alamat)) {
    logger.info('Address is vague, asking for confirmation', { userId, alamat, kategori });
    
    pendingAddressConfirmation.set(userId, {
      alamat,
      kategori,
      deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
      village_id: villageId,
      timestamp: Date.now(),
      foto_url: mediaUrl,
    });
    
    const kategoriLabel = kategori.replace(/_/g, ' ');
    const photoNote = mediaUrl ? '\n\nFoto Anda sudah kami terima.' : '';
    return `Alamat "${alamat}" sepertinya kurang spesifik untuk laporan ${kategoriLabel}.${photoNote}\n\nApakah Bapak/Ibu ingin menambahkan detail alamat (nomor rumah, RT/RW, nama jalan lengkap) atau balas "YA" untuk tetap menggunakan alamat ini?`;
  }
  
  // Check if this is an emergency complaint
  // PRIORITY RULE:
  // - Jika ada konfigurasi jenis pengaduan, gunakan itu sebagai sumber utama.
  // - Heuristic hanya dipakai sebagai fallback saat tidak ada konfigurasi.
  const isEmergency = typeof complaintTypeConfig?.is_urgent === 'boolean'
    ? complaintTypeConfig.is_urgent
    : detectEmergencyComplaint(deskripsi || '', currentMessage, kategori);
  
  // Create complaint in Case Service
  const isWebchatChannel = channel === 'webchat';
  const complaintId = await createComplaint({
    wa_user_id: isWebchatChannel ? undefined : userId,
    channel: isWebchatChannel ? 'WEBCHAT' : 'WHATSAPP',
    channel_identifier: userId,
    kategori,
    deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
    village_id: villageId,
    alamat: alamat || undefined,
    rt_rw: rt_rw || '',
    foto_url: mediaUrl,
    category_id: complaintTypeConfig?.category_id,
    type_id: complaintTypeConfig?.id,
    is_urgent: isEmergency,
    require_address: requireAddress,
  });
  
  if (complaintId) {
    rateLimiterService.recordReport(userId);
    aiAnalyticsService.recordSuccess('CREATE_COMPLAINT');
    
    // Save address to user profile for future auto-fill
    saveDefaultAddress(userId, alamat, rt_rw);
    
    // Record service usage for profile
    recordServiceUsage(userId, kategori);
    
    // Record completed action in conversation context
    recordCompletedAction(userId, 'CREATE_COMPLAINT', complaintId);
    
    // Record collected data
    recordDataCollected(userId, 'kategori', kategori);
    if (alamat) {
      recordDataCollected(userId, 'alamat', alamat);
    }
    
    const hasRtRw = Boolean(rt_rw) || /\brt\b|\brw\b/i.test(alamat || '');
    const withPhotoNote = mediaUrl ? '\nFoto pendukung sudah kami terima.' : '';
    
    let importantContactsMessage = '';
    if (complaintTypeConfig?.send_important_contacts && complaintTypeConfig?.important_contact_category) {
      const contacts = await getImportantContacts(
        villageId,
        complaintTypeConfig.important_contact_category,
        undefined
      );
      importantContactsMessage = buildImportantContactsMessage(contacts);
    }

    if (isEmergency) {
      logger.info('Emergency complaint detected', { userId, complaintId, kategori, deskripsi });
    }

    const statusLine = isEmergency || hasRtRw ? '\nStatus laporan saat ini: OPEN.' : '';
    return `Terima kasih.\nLaporan telah kami terima dengan nomor ${complaintId}.${statusLine}${withPhotoNote}${importantContactsMessage}`;
  }
  
  aiAnalyticsService.recordFailure('CREATE_COMPLAINT');
  throw new Error('Failed to create complaint in Case Service');
}

/**
 * Handle service information request - Query requirements from database
 */
function normalizeTo628(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function extractNameFromText(text: string): string | null {
  const cleaned = (text || '').trim().replace(/[.!?,]+$/g, '').trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  const stopWords = new Set(['ya', 'iya', 'y', 'tidak', 'gak', 'nggak', 'ok', 'oke', 'sip', 'siap', 'baik']);
  if (stopWords.has(lower)) return null;

  const patterns = [
    /^nama\s+([a-zA-Z\s]{2,30})$/i,
    /^nama\s*:\s*([a-zA-Z\s]{2,30})$/i,
    /nama\s+(?:saya|aku|gue|gw)\s+(?:adalah\s+)?([a-zA-Z\s]{2,30})/i,
    /^([a-zA-Z\s]{2,30})\s+itu\s+nama\s+saya$/i,
    /saya\s+([a-zA-Z\s]{2,30})/i,
    /panggil\s+saya\s+([a-zA-Z\s]{2,30})/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      const rawName = match[1].trim();
      const normalized = rawName.replace(/^(pak|bu|bapak|ibu)\s+/i, '').trim();
      const name = normalized.split(/\s+/).slice(0, 2).join(' ');
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }

  if (cleaned.length >= 2 && cleaned.length <= 30 && /^[a-zA-Z]+(?:\s+[a-zA-Z]+)?$/.test(cleaned)) {
    const normalized = cleaned.replace(/^(pak|bu|bapak|ibu)\s+/i, '').trim();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
  }

  return null;
}

function extractNameFromHistory(history?: Array<{ role: 'user' | 'assistant'; content: string }>): string | null {
  if (!history || history.length === 0) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item.role !== 'user') continue;
    const name = extractNameFromText(item.content);
    if (name) return name;
  }
  return null;
}

function getLastAssistantMessage(history?: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  if (!history || history.length === 0) return '';
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item.role === 'assistant') return item.content || '';
  }
  return '';
}

function extractNameFromAssistantPrompt(text?: string): string | null {
  const cleaned = (text || '').trim();
  if (!cleaned) return null;
  const match = cleaned.match(/(?:dengan|ini)\s+(?:Bapak|Ibu|Pak|Bu|Bapak\/Ibu)\s+([a-zA-Z\s]{2,30})/i);
  if (!match?.[1]) return null;
  const name = match[1].trim().split(/\s+/).slice(0, 2).join(' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function wasNamePrompted(history?: Array<{ role: 'user' | 'assistant'; content: string }>): boolean {
  if (!history || history.length === 0) return false;
  const lastAssistant = [...history].reverse().find(item => item.role === 'assistant');
  if (!lastAssistant) return false;
  return /(nama|dengan\s+siapa|siapa\s+nama)/i.test(lastAssistant.content);
}

async function fetchConversationHistoryFromChannel(
  wa_user_id: string,
  village_id?: string
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  try {
    const { config } = await import('../config/env');
    const axios = (await import('axios')).default;
    const response = await axios.get(`${config.channelServiceUrl}/internal/messages`, {
      params: { wa_user_id, limit: 30, ...(village_id ? { village_id } : {}) },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 3000,
    });

    const messages = Array.isArray(response.data?.messages) ? response.data.messages : [];
    const ordered = [...messages].sort((a: any, b: any) => {
      const aTime = new Date(a.timestamp || a.created_at || 0).getTime();
      const bTime = new Date(b.timestamp || b.created_at || 0).getTime();
      return aTime - bTime;
    });

    return ordered.map((m: any) => ({
      role: m.direction === 'IN' ? 'user' : 'assistant',
      content: m.message_text || '',
    }));
  } catch (error: any) {
    logger.warn('Failed to load WhatsApp history for name detection', {
      wa_user_id,
      error: error.message,
    });
    return [];
  }
}

function buildChannelParams(
  channel: ChannelType,
  userId: string
): { channel: 'WEBCHAT' | 'WHATSAPP'; wa_user_id?: string; channel_identifier?: string } {
  const isWebchat = channel === 'webchat';
  return {
    channel: isWebchat ? 'WEBCHAT' : 'WHATSAPP',
    wa_user_id: isWebchat ? undefined : userId,
    channel_identifier: isWebchat ? userId : undefined,
  };
}

function isValidCitizenWaNumber(value: string): boolean {
  return /^628\d{8,12}$/.test(value);
}

function getPublicFormBaseUrl(): string {
  return (process.env.PUBLIC_FORM_BASE_URL
    || process.env.PUBLIC_BASE_URL
    || 'https://govconnect.my.id'
  ).replace(/\/$/, '');
}

function buildPublicServiceFormUrl(
  baseUrl: string,
  villageSlug: string,
  serviceSlug: string,
  userId: string,
  channel: 'whatsapp' | 'webchat'
): string {
  const url = `${baseUrl}/form/${villageSlug}/${serviceSlug}`;
  if (channel === 'webchat') {
    return `${url}?session=${encodeURIComponent(userId)}`;
  }
  const waUser = normalizeTo628(userId);
  if (!isValidCitizenWaNumber(waUser)) return url;
  return `${url}?wa=${encodeURIComponent(waUser)}`;
}

function buildEditServiceFormUrl(
  baseUrl: string,
  requestNumber: string,
  token: string,
  userId: string,
  channel: 'whatsapp' | 'webchat'
): string {
  const url = `${baseUrl}/form/edit/${encodeURIComponent(requestNumber)}`;
  const params = new URLSearchParams();
  params.set('token', token);
  if (channel === 'webchat') {
    params.set('session', userId);
  } else {
    const waUser = normalizeTo628(userId);
    if (isValidCitizenWaNumber(waUser)) {
      params.set('wa', waUser);
    }
  }
  return `${url}?${params.toString()}`;
}

async function resolveVillageSlugForPublicForm(villageId?: string): Promise<string> {
  if (!villageId) return process.env.DEFAULT_VILLAGE_SLUG || 'desa';
  try {
    const profile = await getVillageProfileSummary(villageId);
    if (profile?.short_name) return profile.short_name;
  } catch {
    // ignore
  }
  return process.env.DEFAULT_VILLAGE_SLUG || 'desa';
}

export async function handleServiceInfo(userId: string, llmResponse: any): Promise<HandlerResult> {
  let { service_slug, service_id } = llmResponse.fields || {};
  const villageId = llmResponse.fields?.village_id || process.env.DEFAULT_VILLAGE_ID || '';
  const rawMessage = llmResponse.fields?._original_message || llmResponse.fields?.service_name || llmResponse.fields?.service_query || '';

  if (!service_slug && !service_id && rawMessage) {
    const resolved = await resolveServiceSlugFromSearch(rawMessage, villageId);
    if (resolved?.slug) {
      service_slug = resolved.slug;
      llmResponse.fields = {
        ...(llmResponse.fields || {}),
        service_slug: resolved.slug,
        service_name: resolved.name || llmResponse.fields?.service_name,
      } as any;
    }
  }
  
  if (!service_slug && !service_id) {
    return { replyText: llmResponse.reply_text || 'Baik Pak/Bu, layanan apa yang ingin ditanyakan?' };
  }
  
  try {
    const { config } = await import('../config/env');
    const axios = (await import('axios')).default;
    
    // Query service details from case-service
    let serviceUrl = '';
    
    if (service_id) {
      serviceUrl = `${config.caseServiceUrl}/services/${service_id}`;
    } else if (service_slug) {
      serviceUrl = `${config.caseServiceUrl}/services/by-slug?village_id=${villageId}&slug=${service_slug}`;
    }
    
    const response = await axios.get(serviceUrl, {
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    });
    
    const service = response.data?.data;
    
    if (!service) {
      return llmResponse.reply_text || 'Mohon maaf Pak/Bu, layanan tersebut tidak ditemukan. Silakan tanyakan layanan lain.';
    }
    
    // Build requirements list
    const requirements = service.requirements || [];
    let requirementsList = '';
    if (requirements.length > 0) {
      requirementsList = requirements
        .sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0))
        .map((req: any, i: number) => {
          const required = req.is_required ? ' (wajib)' : ' (opsional)';
          return `${i + 1}. ${req.label}${required}`;
        })
        .join('\n');
    }
    
    // Check if service is available online
    const isOnline = service.mode === 'online' || service.mode === 'both';
    const baseUrl = getPublicFormBaseUrl();
    const villageSlug = await resolveVillageSlugForPublicForm(villageId);
    
    let replyText = `Baik Pak/Bu, untuk pembuatan ${service.name} persyaratannya antara lain:\n\n`;
    let guidanceText = '';

    if (requirementsList) {
      replyText += `${requirementsList}\n\n`;
    } else if (service.description) {
      replyText += `${service.description}\n\n`;
    }

    if (isOnline) {
      // Offer first, then send the form link only when the user confirms.
      setPendingServiceFormOffer(userId, {
        service_slug: service.slug,
        village_id: villageId,
        timestamp: Date.now(),
      });

      guidanceText = 'Apakah Bapak/Ibu ingin mengajukan layanan ini secara online?';
    } else {
      replyText += 'Layanan ini diproses secara offline di kantor kelurahan.\n\nSilakan datang ke kantor dengan membawa persyaratan di atas.';
    }
    
    return { replyText, guidanceText: guidanceText || undefined };
  } catch (error: any) {
    logger.error('Failed to fetch service info', { error: error.message, service_slug, service_id });
    return { replyText: llmResponse.reply_text || 'Baik Pak/Bu, saya cek dulu info layanan tersebut ya.' };
  }
}

/**
 * Handle service request creation (send public form link)
 */
export async function handleServiceRequestCreation(userId: string, channel: ChannelType, llmResponse: any): Promise<string> {
  const { service_slug } = llmResponse.fields || {};
  
  if (!service_slug) {
    return llmResponse.reply_text || 'Mohon sebutkan nama layanan yang ingin diajukan ya Pak/Bu.';
  }

  const villageId = llmResponse.fields?.village_id || process.env.DEFAULT_VILLAGE_ID || '';

  try {
    const { config } = await import('../config/env');
    const axios = (await import('axios')).default;

    const response = await axios.get(`${config.caseServiceUrl}/services/by-slug`, {
      params: { village_id: villageId, slug: service_slug },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    });

    const service = response.data?.data;
    if (!service) {
      return 'Mohon maaf Pak/Bu, layanan tersebut tidak ditemukan. Silakan tanyakan layanan lain.';
    }

    const isOnline = service.mode === 'online' || service.mode === 'both';
    if (!isOnline) {
      return `${service.name} saat ini hanya bisa diproses secara offline di kantor kelurahan/desa.\n\nSilakan datang ke kantor dengan membawa persyaratan yang diperlukan.`;
    }

    const baseUrl = getPublicFormBaseUrl();
    const villageSlug = await resolveVillageSlugForPublicForm(villageId);
    const formUrl = buildPublicServiceFormUrl(baseUrl, villageSlug, service.slug || service_slug, userId, channel === 'webchat' ? 'webchat' : 'whatsapp');

    return `Baik Pak/Bu, silakan mengisi permohonan melalui link berikut:\n${formUrl}\n\nSetelah dikirim, Bapak/Ibu akan mendapatkan nomor layanan.`;
  } catch (error: any) {
    logger.error('Failed to validate service before sending form link', { error: error.message, service_slug, villageId });
    return llmResponse.reply_text || 'Mohon maaf Pak/Bu, saya belum bisa menyiapkan link formulirnya sekarang. Coba lagi sebentar ya.';
  }
}

/**
 * Handle service request edit (send edit link with token)
 */
export async function handleServiceRequestEditLink(userId: string, channel: ChannelType, llmResponse: any): Promise<string> {
  const { request_number } = llmResponse.fields || {};

  if (!request_number) {
    return llmResponse.reply_text || 'Baik Pak/Bu, link tersebut sudah tidak berlaku. Apakah Bapak/Ibu ingin kami kirimkan link pembaruan yang baru?';
  }

  const tokenResult = await requestServiceRequestEditToken(request_number, buildChannelParams(channel, userId));

  if (!tokenResult.success) {
    if (tokenResult.error === 'NOT_FOUND') {
      return `Permohonan layanan *${request_number}* tidak ditemukan. Mohon cek nomor layanan ya Pak/Bu.`;
    }
    if (tokenResult.error === 'NOT_OWNER') {
      return `Mohon maaf Pak/Bu, permohonan *${request_number}* bukan milik Anda, jadi tidak bisa diubah.`;
    }
    if (tokenResult.error === 'LOCKED') {
      return `Mohon maaf Pak/Bu, layanan *${request_number}* sudah selesai/dibatalkan/ditolak sehingga tidak dapat diperbarui.`;
    }
    return tokenResult.message || 'Mohon maaf Pak/Bu, ada kendala saat menyiapkan link edit.';
  }

  const baseUrl = (process.env.PUBLIC_FORM_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://govconnect.my.id').replace(/\/$/, '');
  const editUrl = buildEditServiceFormUrl(
    baseUrl,
    request_number,
    tokenResult.edit_token || '',
    userId,
    channel === 'webchat' ? 'webchat' : 'whatsapp'
  );

  return `Baik Pak/Bu, perubahan data layanan hanya dapat dilakukan melalui website.\n\nSilakan lakukan pembaruan melalui link berikut:\n${editUrl}\n\nLink ini hanya berlaku satu kali.`;
}

/**
 * Extract address from message using smart detection
 * IMPROVED: More strict validation to avoid false positives
 */
function extractAddressFromMessage(currentMessage: string, userId: string): string {
  const complaintKeywords = /menumpuk|tumpukan|rusak|berlubang|mati|padam|tersumbat|banjir|tumbang|roboh|sampah|limbah|genangan|menghalangi/i;
  
  // Clean message: remove common prefixes like "alamatnya", "alamat saya", etc.
  let cleanedMessage = currentMessage.trim()
    .replace(/^(alamatnya|alamat\s*nya|alamat\s*saya|alamat\s*di|itu\s*alamat|ini\s*alamat)\s*/i, '')
    .replace(/^(di|ke)\s+/i, '')
    .trim();
  
  const isJustAddress = !complaintKeywords.test(cleanedMessage) && cleanedMessage.length < 100;
  
  // IMPROVED: Reject ONLY if the entire message is just these words (no address content)
  const pureNonAddressPhrases = /^(itu|ini|ya|iya|yak|yup|oke|ok|siap|sudah|cukup|proses|lanjut|hadeh|aduh|wah|ah|oh|hm|hmm|tolol|bodoh|goblok|bego|tidak|bukan|bener|benar|salah|gimana|bagaimana|apa|kenapa|mengapa|kapan|dimana|siapa|mana|sini|situ|sana|gitu|gini|dong|deh|sih|nih|tuh|lah|kan|kah|pun|juga|jadi|terus|lalu|kemudian|makanya|soalnya|karena|sebab)$/i;
  if (pureNonAddressPhrases.test(cleanedMessage)) {
    return '';
  }
  
  if (isJustAddress && cleanedMessage.length >= 5) {
    const addressPatterns = [
      /jalan/i, /jln/i, /jl\./i,
      /\bno\b/i, /nomor/i,
      /\brt\b/i, /\brw\b/i,
      /gang/i, /gg\./i,
      /komplek/i, /perumahan/i, /blok/i,
    ];
    
    const looksLikeFormalAddress = addressPatterns.some(pattern => pattern.test(cleanedMessage));
    
    if (looksLikeFormalAddress) {
      logger.info('Smart alamat detection: formal address detected', { userId, detectedAlamat: cleanedMessage });
      return cleanedMessage;
    }
    
    const informalAddressPatterns = [
      /dekat\s+\w{3,}|depan\s+\w{3,}|belakang\s+\w{3,}|samping\s+\w{3,}/i,
      /margahayu|cimahi|bandung|jakarta|surabaya|semarang/i,
      /masjid\s+\w+|mushola\s+\w+|sekolah\s+\w+|kantor\s+\w+|warung\s+\w+|toko\s+\w+/i,
    ];
    
    const looksLikeInformalAddress = informalAddressPatterns.some(pattern => pattern.test(cleanedMessage));
    
    if (looksLikeInformalAddress && cleanedMessage.length >= 10) {
      let alamat = cleanedMessage.replace(/kak$/i, '').trim();
      
      if (alamat.length >= 5 && /[a-zA-Z]/.test(alamat)) {
        logger.info('Smart alamat detection: informal address/location detected', { userId, detectedAlamat: alamat });
        return alamat;
      }
    }
  }
  
  return '';
}

/**
 * Extract address from complaint message that contains both complaint and address
 * Example: "lampu mati di jalan sudirman no 10 bandung"
 * Example: "banjir di depan sman 1 margahayu"
 * 
 * IMPROVED: Better detection for landmarks like schools, mosques, etc.
 */
function extractAddressFromComplaintMessage(message: string, userId: string): string {
  // Pattern 1: "di depan/dekat/belakang/samping [landmark]"
  // This catches: "di depan sman 1 margahayu", "di dekat masjid al-ikhlas"
  const landmarkPatterns = [
    /(?:di\s+)?(?:depan|dekat|belakang|samping|sekitar)\s+((?:sman?|smpn?|sdn?|smkn?|sd|smp|sma|smk)\s*\d*\s*\w+(?:\s+\w+)?)/i,
    /(?:di\s+)?(?:depan|dekat|belakang|samping|sekitar)\s+(masjid\s+[\w\s]+)/i,
    /(?:di\s+)?(?:depan|dekat|belakang|samping|sekitar)\s+(gereja\s+[\w\s]+)/i,
    /(?:di\s+)?(?:depan|dekat|belakang|samping|sekitar)\s+(kantor\s+[\w\s]+)/i,
    /(?:di\s+)?(?:depan|dekat|belakang|samping|sekitar)\s+(pasar\s+[\w\s]+)/i,
    /(?:di\s+)?(?:depan|dekat|belakang|samping|sekitar)\s+(terminal\s+[\w\s]+)/i,
    /(?:di\s+)?(?:depan|dekat|belakang|samping|sekitar)\s+(stasiun\s+[\w\s]+)/i,
    /(?:di\s+)?(?:depan|dekat|belakang|samping|sekitar)\s+(puskesmas\s*[\w\s]*)/i,
    /(?:di\s+)?(?:depan|dekat|belakang|samping|sekitar)\s+([\w\s]+(?:margahayu|bandung|cimahi|jakarta|surabaya|semarang))/i,
  ];
  
  for (const pattern of landmarkPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      // Include the preposition (depan/dekat/etc) for context
      const fullMatch = message.match(new RegExp(`((?:depan|dekat|belakang|samping|sekitar)\\s+${match[1].replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')})`, 'i'));
      const alamat = fullMatch ? fullMatch[1].trim() : match[1].trim();
      
      if (alamat.length >= 5) {
        logger.info('Smart alamat detection: landmark address extracted', { userId, detectedAlamat: alamat });
        return alamat;
      }
    }
  }
  
  // Pattern 2: "di [jalan/jln/jl] [nama jalan]"
  const streetPatterns = [
    /(?:di|lokasi|alamat|tempat)\s+((?:jalan|jln|jl\.?)[^,]+(?:no\.?\s*\d+)?(?:\s+\w+)?)/i,
  ];
  
  for (const pattern of streetPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const alamat = match[1].trim();
      if (alamat.length >= 10 && /[a-zA-Z]/.test(alamat)) {
        logger.info('Smart alamat detection: street address extracted', { userId, detectedAlamat: alamat });
        return alamat;
      }
    }
  }
  
  // Pattern 3: Generic "di [location]" with city names
  const cityPatterns = [
    /(?:di|lokasi)\s+([\w\s]+(?:bandung|jakarta|surabaya|semarang|cimahi|margahayu))/i,
  ];
  
  for (const pattern of cityPatterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const alamat = match[1].trim();
      // Filter out complaint keywords from the extracted address
      const complaintKeywords = /menumpuk|tumpukan|rusak|berlubang|mati|padam|tersumbat|banjir|tumbang|roboh|sampah|limbah|genangan|menghalangi|macet|kendala/gi;
      const cleanAlamat = alamat.replace(complaintKeywords, '').trim();
      
      if (cleanAlamat.length >= 5 && /[a-zA-Z]/.test(cleanAlamat)) {
        logger.info('Smart alamat detection: city-based address extracted', { userId, detectedAlamat: cleanAlamat });
        return cleanAlamat;
      }
    }
  }
  
  return '';
}

/**
 * Handle status check for complaints dan permohonan layanan
 * Now includes ownership validation - user can only check their own records
 */
export async function handleStatusCheck(userId: string, channel: ChannelType, llmResponse: any, currentMessage: string = ''): Promise<string> {
  const { complaint_id, request_number } = llmResponse.fields;
  const detailMode = !!(llmResponse.fields?.detail_mode || llmResponse.fields?.detail);
  
  if (!complaint_id && !request_number) {
    if (llmResponse.reply_text) return llmResponse.reply_text;
    const ctx = getEnhancedContext(userId);
    const lastComplaint = ctx.keyPoints
      .slice()
      .reverse()
      .find(point => /CREATE_COMPLAINT berhasil:/i.test(point));
    const inferredComplaintId = lastComplaint?.split('berhasil:')[1]?.trim();
    if (inferredComplaintId) {
      llmResponse.fields.complaint_id = inferredComplaintId;
    } else {
      return 'Untuk cek status, mohon sebutkan nomor laporan atau layanan ya Pak/Bu (contoh: LAP-20251201-001 atau LAY-20251201-001).';
    }
  }
  
  if (complaint_id) {
    // Use ownership validation - user can only check their own complaints
    const { getComplaintStatusWithOwnership } = await import('./case-client.service');
    const result = await getComplaintStatusWithOwnership(complaint_id, buildChannelParams(channel, userId));
    
    if (!result.success) {
      if (result.error === 'NOT_FOUND') {
        return `Mohon maaf Pak/Bu, kami tidak menemukan laporan dengan nomor *${complaint_id}*.\n\nSilakan cek ulang format nomor laporan (contoh: LAP-20251201-001).`;
      }
      if (result.error === 'NOT_OWNER') {
        return `Mohon maaf Pak/Bu, laporan *${complaint_id}* bukan milik Anda.\n\nSilakan cek kembali nomor laporan Anda. Jika lupa, ketik "riwayat" untuk melihat daftar laporan Anda.`;
      }
      return 'Mohon maaf Pak/Bu, ada kendala saat mengecek status. Silakan coba lagi.';
    }

    if (!result.data) {
      return 'Mohon maaf Pak/Bu, ada kendala saat menampilkan detail laporan. Silakan coba lagi.';
    }
    
    if (!detailMode) {
      const isExplicitCheck = /(cek|status|cek\s+laporan|cek\s+lagi)/i.test(currentMessage || '');
      const statusInfo = getStatusInfo(result.data.status);
      if (!isExplicitCheck && statusInfo.text === 'PROCESS') {
        return `Mohon maaf Pak/Bu, laporan ${complaint_id} masih dalam proses penanganan oleh petugas desa.`;
      }
      if (!isExplicitCheck && statusInfo.text === 'OPEN') {
        return `Mohon maaf Pak/Bu, laporan ${complaint_id} masih menunggu untuk diproses oleh petugas desa.`;
      }
    }
    return detailMode ? buildComplaintDetailResponse(result.data) : buildNaturalStatusResponse(result.data);
  }
  
  if (request_number) {
    const result = await getServiceRequestStatusWithOwnership(request_number, buildChannelParams(channel, userId));
    
    if (!result.success) {
      if (result.error === 'NOT_FOUND') {
        return `Mohon maaf Pak/Bu, kami tidak menemukan permohonan layanan dengan nomor *${request_number}*.\n\nSilakan cek ulang format nomor layanan (contoh: LAY-20251201-001).`;
      }
      if (result.error === 'NOT_OWNER') {
        return `Mohon maaf Pak/Bu, permohonan layanan *${request_number}* bukan milik Anda.\n\nSilakan cek kembali nomor layanan Anda. Jika lupa, ketik "riwayat" untuk melihat daftar layanan Anda.`;
      }
      return 'Mohon maaf Pak/Bu, ada kendala saat mengecek status layanan. Silakan coba lagi.';
    }
    
    if (!result.data) {
      return 'Mohon maaf Pak/Bu, ada kendala saat menampilkan detail layanan. Silakan coba lagi.';
    }

    if (!detailMode) return buildNaturalServiceStatusResponse(result.data);

    let requirementDefs: ServiceRequirementDefinition[] = [];
    const serviceId: string | undefined = result.data?.service_id || result.data?.serviceId;
    if (serviceId) {
      requirementDefs = await getServiceRequirements(String(serviceId));
    }

    return buildServiceRequestDetailResponse(result.data, requirementDefs);
  }
  
  return 'Mohon maaf Pak/Bu, ada kendala saat mengecek status. Silakan coba lagi.';
}

/**
 * Handle cancellation of complaints
 */
export async function handleCancellation(userId: string, channel: ChannelType, llmResponse: any): Promise<string> {
  const { complaint_id, cancel_reason } = llmResponse.fields;
  
  if (!complaint_id) {
    if (llmResponse.reply_text) return llmResponse.reply_text;
    return 'Untuk membatalkan laporan, mohon sertakan nomornya ya Pak/Bu (contoh: LAP-20251201-001).';
  }
  
  const result = await cancelComplaint(complaint_id, buildChannelParams(channel, userId), cancel_reason);
  
  if (!result.success) {
    return buildCancelErrorResponse('laporan', complaint_id, result.error, result.message);
  }
  
  return buildCancelSuccessResponse('laporan', complaint_id, result.message);
}

export async function handleCancellationRequest(
  userId: string,
  type: 'laporan' | 'layanan',
  llmResponse: any
): Promise<string> {
  const { complaint_id, request_number, cancel_reason } = llmResponse.fields || {};
  const targetId = type === 'laporan' ? complaint_id : request_number;

  if (!targetId) {
    if (llmResponse.reply_text) return llmResponse.reply_text;
    return type === 'laporan'
      ? 'Untuk membatalkan laporan, mohon sertakan nomornya ya Pak/Bu (contoh: LAP-20251201-001).'
      : 'Untuk membatalkan layanan, mohon sertakan nomornya ya Pak/Bu (contoh: LAY-20251201-001).';
  }

  setPendingCancelConfirmation(userId, {
    type,
    id: targetId,
    reason: cancel_reason,
    timestamp: Date.now(),
  });

  const label = type === 'laporan' ? 'laporan' : 'layanan';
  return `Apakah Bapak/Ibu yakin ingin membatalkan ${label} ${targetId}?\nBalas YA untuk konfirmasi.`;
}

/**
 * Handle cancellation of service requests
 */
export async function handleServiceRequestCancellation(userId: string, channel: ChannelType, llmResponse: any): Promise<string> {
  const { request_number, cancel_reason } = llmResponse.fields || {};

  if (!request_number) {
    return llmResponse.reply_text || 'Untuk membatalkan layanan, mohon sertakan nomornya ya Pak/Bu (contoh: LAY-20251201-001).';
  }

  const result = await cancelServiceRequest(request_number, buildChannelParams(channel, userId), cancel_reason);

  if (!result.success) {
    return buildCancelErrorResponse('layanan', request_number, result.error, result.message);
  }

  return buildCancelSuccessResponse('layanan', request_number, result.message);
}

/**
 * Handle complaint update by user
 */
export async function handleComplaintUpdate(userId: string, channel: ChannelType, llmResponse: any, currentMessage: string = ''): Promise<string> {
  const { complaint_id, alamat, deskripsi, rt_rw } = llmResponse.fields || {};

  if (!complaint_id) {
    return llmResponse.reply_text || 'Mohon sebutkan nomor laporan yang ingin diperbarui (contoh: LAP-20251201-001).';
  }

  const wantsPhoto = /(kirim|kirimkan|unggah|upload).*(foto|gambar)/i.test(currentMessage || '');
  if (wantsPhoto) {
    return 'Baik, silakan kirimkan foto pendukung laporan tersebut.';
  }

  if (!alamat && !deskripsi && !rt_rw) {
    return 'Baik, silakan sampaikan keterangan tambahan yang ingin ditambahkan.';
  }

  const result = await updateComplaintByUser(complaint_id, buildChannelParams(channel, userId), { alamat, deskripsi, rt_rw });

  if (!result.success) {
    if (result.error === 'NOT_FOUND') {
      return `Hmm, laporan *${complaint_id}* tidak ditemukan. Coba cek kembali nomor laporan ya.`;
    }
    if (result.error === 'NOT_OWNER') {
      return `Mohon maaf Pak/Bu, laporan *${complaint_id}* bukan milik Anda, jadi tidak bisa diubah.`;
    }
    if (result.error === 'LOCKED') {
      return `Laporan *${complaint_id}* sudah selesai/dibatalkan/ditolak sehingga tidak bisa diubah.`;
    }
    return result.message || 'Maaf, terjadi kendala saat memperbarui laporan.';
  }

  return `Terima kasih.\nKeterangan laporan ${complaint_id} telah diperbarui.`;
}

/**
 * Handle user history request
 */
export async function handleHistory(userId: string, channel: ChannelType): Promise<string> {
  logger.info('Handling history request', { userId });
  
  const history = await getUserHistory(buildChannelParams(channel, userId));
  
  if (!history || history.total === 0) {
    return 'Belum ada laporan atau layanan. Silakan kirim pesan untuk memulai.';
  }
  
  return buildHistoryResponse(history.combined, history.total);
}

/**
 * Handle knowledge query
 */
export async function handleKnowledgeQuery(userId: string, message: string, llmResponse: any): Promise<string> {
  logger.info('Handling knowledge query', { userId, knowledgeCategory: llmResponse.fields?.knowledge_category });
  
  try {
    const categories = llmResponse.fields?.knowledge_category ? [llmResponse.fields.knowledge_category] : undefined;
    const villageId: string | undefined = llmResponse.fields?.village_id || process.env.DEFAULT_VILLAGE_ID;

    const normalizedQuery = (message || '').toLowerCase();
    const profile = await getVillageProfileSummary(villageId);
    const officeName = profile?.name || 'kantor desa/kelurahan';

    // Deterministic (no-LLM) answers for profile/office info to prevent hallucination.
    // If the data isn't in DB, we explicitly say it's unavailable.
    const isAskingAddress = /(alamat|lokasi|maps|google\s*maps)/i.test(normalizedQuery);
    const isAskingHours = /(jam|operasional|buka|tutup|hari\s*kerja)/i.test(normalizedQuery);
    const isTrackingNumberQuestion = /(\b(LAP|LAY)-\d{8}-\d{3}\b)/i.test(message) || /\bnomor\s+(layanan|pengaduan)\b/i.test(normalizedQuery);
    // Avoid treating generic mentions of "WA/Webchat" as a contact request.
    // Only route to contact lookup when user explicitly asks for a number/contact/hotline.
    const isAskingContact =
      !isTrackingNumberQuestion &&
      /(kontak|hubungi|telepon|telp|call\s*center|hotline|\bnomor\b(\s+(wa|whatsapp|telp|telepon|kontak|hp))?)/i.test(normalizedQuery);

    if (isAskingAddress) {
      if (!profile?.address && !profile?.gmaps_url) {
        return 'Mohon maaf Pak/Bu, informasi alamat kantor belum tersedia. Silakan datang langsung ke kantor desa pada jam kerja.';
      }

      if (profile?.address && profile?.gmaps_url) {
        return `Kantor ${officeName} beralamat di ${profile.address}.\nLokasi Google Maps:\n${profile.gmaps_url}`;
      }

      if (profile?.address) {
        return `Alamat Kantor ${officeName} adalah ${profile.address}.`;
      }

      return `Tentu Pak/Bu. Berikut lokasi Kantor ${officeName} di Google Maps:\n${profile.gmaps_url}`;
    }

    if (isAskingHours) {
      const hours: any = profile?.operating_hours;
      if (!hours || typeof hours !== 'object') {
        return 'Mohon maaf Pak/Bu, informasi jam operasional belum tersedia. Silakan datang langsung ke kantor desa pada jam kerja.';
      }

      const dayKeys = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'] as const;
      const requestedDay = dayKeys.find(d => new RegExp(`\\b${d}\\b`, 'i').test(normalizedQuery));

      const formatDay = (day: string, schedule: any): string => {
        const open = schedule?.open ?? null;
        const close = schedule?.close ?? null;
        if (!open || !close) return `${day.charAt(0).toUpperCase() + day.slice(1)}: Tutup`;
        return `${day.charAt(0).toUpperCase() + day.slice(1)}: ${open}–${close}`;
      };

      if (requestedDay) {
        const daySchedule = (hours as any)[requestedDay];
        if (!daySchedule?.open || !daySchedule?.close) {
          const dayLabel = requestedDay.charAt(0).toUpperCase() + requestedDay.slice(1);
          if (requestedDay === 'sabtu' || requestedDay === 'minggu') {
            return 'Mohon maaf Pak/Bu, kantor desa tidak beroperasi pada hari Sabtu dan Minggu.';
          }
          return `Mohon maaf Pak/Bu, kantor desa tidak beroperasi pada hari ${dayLabel}.`;
        }
        const dayLabel = requestedDay.charAt(0).toUpperCase() + requestedDay.slice(1);
        return `Kantor ${officeName} buka hari ${dayLabel} pukul ${daySchedule.open}–${daySchedule.close}.`;
      }

      const weekdayKeys = ['senin', 'selasa', 'rabu', 'kamis', 'jumat'];
      const weekendKeys = ['sabtu', 'minggu'];
      const firstWeekday = (hours as any)[weekdayKeys[0]];
      const allWeekdaysSame = weekdayKeys.every(day => {
        const h = (hours as any)[day];
        return h?.open === firstWeekday?.open && h?.close === firstWeekday?.close;
      });
      const weekendsClosed = weekendKeys.every(day => {
        const h = (hours as any)[day];
        return !h?.open || !h?.close;
      });

      if (allWeekdaysSame && firstWeekday?.open && firstWeekday?.close && weekendsClosed) {
        return `Kantor ${officeName} buka Senin–Jumat, pukul ${firstWeekday.open}–${firstWeekday.close} WIB.`;
      }

      const lines: string[] = [`Jam operasional ${officeName}:`];
      for (const day of dayKeys) {
        lines.push(formatDay(day, (hours as any)[day]));
      }
      return lines.join('\n');
    }

    if (isAskingContact) {
      const wantsPengaduan = /pengaduan/i.test(normalizedQuery);
      const wantsPelayanan = /pelayanan|layanan/i.test(normalizedQuery);

      const categoryName = wantsPengaduan ? 'Pengaduan' : wantsPelayanan ? 'Pelayanan' : null;
      let contacts = await getImportantContacts(villageId || '', categoryName);
      if ((!contacts || contacts.length === 0) && categoryName) {
        contacts = await getImportantContacts(villageId || '');
      }

      if (!contacts || contacts.length === 0) {
        return `Mohon maaf Pak/Bu, informasi kontak untuk ${officeName} belum tersedia.`;
      }

      const profileNameLower = (profile?.name || '').toLowerCase();
      const scored = contacts
        .map(c => {
          const nameLower = (c.name || '').toLowerCase();
          const categoryLower = (c.category?.name || '').toLowerCase();
          let score = 0;
          if (profileNameLower && nameLower.includes(profileNameLower)) score += 5;
          if (wantsPengaduan && categoryLower.includes('pengaduan')) score += 3;
          if (wantsPelayanan && categoryLower.includes('pelayanan')) score += 3;
          if (/admin/i.test(nameLower)) score += 1;
          return { c, score };
        })
        .sort((a, b) => b.score - a.score);

      const top = scored.slice(0, 3).map(s => s.c);
      const lines: string[] = [`Kontak ${officeName}:`];
      for (const c of top) {
        const extra = c.description ? ` — ${c.description}` : '';
        lines.push(`- ${c.name}: ${c.phone}${extra}`);
      }
      return lines.join('\n');
    }

    const tryAnswerFromServiceCatalog = async (): Promise<string | null> => {
      const queryLower = normalizedQuery;
      const isServiceRelated = /(kartu\s+keluarga|\bkk\b|kartu\s+tanda\s+penduduk|\bktp\b|e-?ktp|ktp-?el|pergantian|ganti\s+kk|kk\s+baru|kk\s+hilang|kk\s+rusak|surat\s+keterangan|surat\s+pengantar|izin\s+keramaian|domisili|tidak\s+mampu|usaha|dukcapil)/i.test(queryLower);
      if (!isServiceRelated) return null;

      try {
        const { config } = await import('../config/env');
        const axios = (await import('axios')).default;
        const response = await axios.get(`${config.caseServiceUrl}/services`, {
          params: { village_id: villageId },
          headers: { 'x-internal-api-key': config.internalApiKey },
          timeout: 5000,
        });

        const services = Array.isArray(response.data?.data) ? response.data.data : [];
        if (!services.length) return null;

        const scoreService = (service: any): number => {
          const name = String(service?.name || '').toLowerCase();
          const desc = String(service?.description || '').toLowerCase();
          const slug = String(service?.slug || '').toLowerCase();
          let score = 0;
          if (/(kartu\s+keluarga|\bkk\b)/i.test(queryLower)) {
            if (/(kartu\s+keluarga|\bkk\b)/i.test(name)) score += 5;
            if (/(kartu\s+keluarga|\bkk\b)/i.test(desc)) score += 3;
            if (/(kartu\s+keluarga|\bkk\b)/i.test(slug)) score += 3;
          }
          if (/(kartu\s+tanda\s+penduduk|\bktp\b|e-?ktp|ktp-?el)/i.test(queryLower)) {
            if (/(kartu\s+tanda\s+penduduk|\bktp\b|e-?ktp|ktp-?el)/i.test(name)) score += 5;
            if (/(kartu\s+tanda\s+penduduk|\bktp\b|e-?ktp|ktp-?el)/i.test(desc)) score += 3;
            if (/(kartu\s+tanda\s+penduduk|\bktp\b|e-?ktp|ktp-?el)/i.test(slug)) score += 3;
          }
          if (/(pergantian|ganti|hilang|rusak|barcode|baru)/i.test(queryLower)) {
            if (/(pergantian|ganti|hilang|rusak|barcode|baru)/i.test(name)) score += 3;
            if (/(pergantian|ganti|hilang|rusak|barcode|baru)/i.test(desc)) score += 2;
            if (/(pergantian|ganti|hilang|rusak|barcode|baru)/i.test(slug)) score += 2;
          }
          if (/(surat\s+keterangan\s+usaha|\bsku\b)/i.test(queryLower)) {
            if (/\bsku\b|surat\s+keterangan\s+usaha/i.test(name)) score += 5;
            if (/\bsku\b|surat\s+keterangan\s+usaha/i.test(desc)) score += 3;
          }
          return score;
        };

        const ranked = services
          .map((s: any) => ({ s, score: scoreService(s) }))
          .filter((x: any) => x.score > 0)
          .sort((a: any, b: any) => b.score - a.score);

        const best = ranked[0]?.s;
        if (!best) return null;

        const requirements = best.requirements || [];
        let requirementsList = '';
        if (requirements.length > 0) {
          requirementsList = requirements
            .sort((a: any, b: any) => (a.order_index || 0) - (b.order_index || 0))
            .map((req: any, i: number) => {
              const required = req.is_required ? ' (wajib)' : ' (opsional)';
              return `${i + 1}. ${req.label}${required}`;
            })
            .join('\n');
        }

        const isOnline = best.mode === 'online' || best.mode === 'both';
        let replyText = `Baik Pak/Bu, untuk ${best.name} persyaratannya antara lain:\n\n`;

        if (requirementsList) {
          replyText += `${requirementsList}\n\n`;
        } else if (best.description) {
          replyText += `${best.description}\n\n`;
        }

        if (isOnline) {
          setPendingServiceFormOffer(userId, {
            service_slug: best.slug,
            village_id: villageId,
            timestamp: Date.now(),
          });
          replyText += 'Apakah Bapak/Ibu ingin mengajukan layanan ini secara online?';
        } else {
          replyText += 'Layanan ini diproses secara offline di kantor kelurahan/desa.\n\nSilakan datang ke kantor dengan membawa persyaratan di atas.';
        }

        return replyText;
      } catch (error: any) {
        logger.warn('Service catalog lookup failed', { error: error.message });
        return null;
      }
    };

    const catalogAnswer = await tryAnswerFromServiceCatalog();
    if (catalogAnswer) {
      return catalogAnswer;
    }

    const preloadedContext: string | undefined = llmResponse.fields?._preloaded_knowledge_context;
    let contextString = preloadedContext;
    let total = contextString ? 1 : 0;

    if (!contextString) {
      const knowledgeResult = await searchKnowledge(message, categories, villageId);
      total = knowledgeResult.total;
      contextString = knowledgeResult.context;
    }

    const tryExtractDeterministicKbAnswer = (queryLower: string, ctx: string): string | null => {
      const context = ctx || '';

      // 5W1H
      if (/\b5w1h\b/i.test(queryLower) && /(\bwhat\b\s*:|\bwhere\b\s*:|\bwhen\b\s*:|\bwho\b\s*:)/i.test(context)) {
        const labels = ['What', 'Where', 'When', 'Who', 'Why/How'] as const;
        const lines: string[] = ['Prinsip 5W1H untuk laporan:'];
        for (const label of labels) {
          const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const match = context.match(new RegExp(`(^|\\n)\\s*[-*]\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*([^\\n]+)`, 'i'));
          if (match?.[2]) {
            lines.push(`- ${label}: ${match[2].trim()}`);
          }
        }
        if (lines.length >= 3) return lines.join('\n');
      }

      // Prioritas penanganan
      if (/prioritas/i.test(queryLower) && /(tinggi\s*:|sedang\s*:|rendah\s*:)/i.test(context)) {
        const labels = ['Tinggi', 'Sedang', 'Rendah'] as const;
        const lines: string[] = ['Prioritas penanganan pengaduan:'];
        for (const label of labels) {
          const match = context.match(new RegExp(`(^|\\n)\\s*[-*]\\s*(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*([^\\n]+)`, 'i'));
          if (match?.[2]) {
            lines.push(`- ${label}: ${match[2].trim()}`);
          }
        }
        if (lines.length >= 3) return lines.join('\n');
      }

      // Embedding (glossary)
      if (/\bembedding\b/i.test(queryLower)) {
        const match = context.match(/(^|\n)\s*[-*]\s*(?:\*\*)?Embedding(?:\*\*)?\s*:\s*([^\n]+)/i);
        if (match?.[2]) {
          return `Embedding: ${match[2].trim()}`;
        }
      }

      // Data usage purpose
      if (/\bdata\b/i.test(queryLower) && /(digunakan|tujuan)/i.test(queryLower)) {
        // Prefer the KB phrasing that includes "proses layanan" when available.
        const usedForProses = context.match(/data\s+digunakan\s+untuk\s+(proses\s+layanan[^\n]*)/i);
        const usedForGeneric = context.match(/data\s+digunakan\s+untuk\s+([^\n]+)/i);
        const usedTail = (usedForProses?.[1] || usedForGeneric?.[1])?.trim();
        const accessedBy = context.match(/data\s+hanya\s+diakses\s+oleh\s+([^\n]+)/i);
        if (usedTail || accessedBy?.[1]) {
          const lines: string[] = ['Tujuan penggunaan data layanan digital:'];
          if (usedTail) lines.push(`- Data digunakan untuk ${usedTail}`);
          if (accessedBy?.[1]) lines.push(`- Data hanya diakses oleh ${accessedBy[1].trim()}`);
          return lines.join('\n');
        }
      }

      return null;
    };

    const appendServiceOfferIfNeeded = (text: string): string => {
      if (!text) return text;
      if (/(ajukan|mengajukan|link|formulir)/i.test(text)) return text;
      const looksLikeServiceQuery = /(sku|skd|sktm|spktp|spkk|spskck|spakta|ikr|surat\s+keterangan\s+usaha|surat\s+keterangan\s+domisili|surat\s+keterangan\s+tidak\s+mampu|surat\s+pengantar|izin\s+keramaian)/i.test(normalizedQuery);
      if (!looksLikeServiceQuery) return text;
      return `${text}\n\nJika Bapak/Ibu ingin mengajukan layanan ini, kami bisa bantu kirimkan link pengajuan.`;
    };

    // Deterministic KB extraction for anchored terms (prevents the second LLM step from omitting key lines).
    const deterministicFromContext = contextString ? tryExtractDeterministicKbAnswer(normalizedQuery, contextString) : null;
    if (deterministicFromContext) {
      return appendServiceOfferIfNeeded(deterministicFromContext);
    }

    // If RAG context misses these anchored KB terms, force a keyword-only lookup and retry deterministic extraction.
    const wants5w1h = /\b5w1h\b/i.test(normalizedQuery);
    const wantsPriority = /prioritas/i.test(normalizedQuery);
    const wantsEmbedding = /\bembedding\b/i.test(normalizedQuery);
    const wantsDataPurpose = /\bdata\b/i.test(normalizedQuery) && /(digunakan|tujuan)/i.test(normalizedQuery);
    if (wants5w1h || wantsPriority || wantsEmbedding || wantsDataPurpose) {
      const forcedQuery = wants5w1h
        ? '5W1H What Where When Who Why How'
        : wantsPriority
          ? 'Prioritas Penanganan Tinggi Sedang Rendah'
          : wantsEmbedding
            ? 'Embedding vektor pencarian'
            : 'Tujuan Penggunaan Data proses layanan pengaduan diakses admin';

      const kw = await searchKnowledgeKeywordsOnly(forcedQuery, undefined, villageId);
      if (kw?.context) {
        const deterministicFromKeyword = tryExtractDeterministicKbAnswer(normalizedQuery, kw.context);
        if (deterministicFromKeyword) {
          return deterministicFromKeyword;
        }
        // Otherwise, enrich context for the LLM step.
        contextString = [contextString, kw.context].filter(Boolean).join('\n\n---\n\n');
        total = Math.max(total, kw.total || 0);
      }
    }

    if (!contextString || total === 0) {
      return `Maaf, saya belum memiliki informasi tentang hal tersebut untuk *${officeName}*. Jika perlu, silakan hubungi kantor desa/kelurahan pada jam kerja.`;
    }

    const { systemPrompt } = await buildKnowledgeQueryContext(userId, message, contextString);
    const knowledgeResult2 = await callGemini(systemPrompt);
    
    if (!knowledgeResult2) {
      return 'Maaf, terjadi kendala teknis. Silakan coba lagi dalam beberapa saat.';
    }
    
    return appendServiceOfferIfNeeded(knowledgeResult2.response.reply_text);
  } catch (error: any) {
    logger.error('Failed to handle knowledge query', { userId, error: error.message });
    return 'Maaf, terjadi kesalahan saat mencari informasi. Mohon coba lagi dalam beberapa saat.';
  }
}


// ==================== HELPER FUNCTIONS ====================

/**
 * Extract date from text
 */
function extractDateFromText(text: string): string | null {
  const today = new Date();
  const cleanText = text.toLowerCase();
  
  if (/besok/i.test(cleanText)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
  if (/lusa/i.test(cleanText)) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return dayAfter.toISOString().split('T')[0];
  }
  
  const dateMatch = text.match(/(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/i);
  if (dateMatch) {
    const months: Record<string, number> = {
      'januari': 0, 'februari': 1, 'maret': 2, 'april': 3, 'mei': 4, 'juni': 5,
      'juli': 6, 'agustus': 7, 'september': 8, 'oktober': 9, 'november': 10, 'desember': 11
    };
    const day = parseInt(dateMatch[1]);
    const month = months[dateMatch[2].toLowerCase()];
    const year = parseInt(dateMatch[3]);
    const date = new Date(year, month, day);
    return date.toISOString().split('T')[0];
  }
  
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];
  
  return null;
}

/**
 * Extract time from text
 */
function extractTimeFromText(text: string): string | null {
  const cleanText = text.toLowerCase();
  
  const jamMatch = cleanText.match(/jam\s*(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?/i);
  if (jamMatch) {
    let hour = parseInt(jamMatch[1]);
    const minute = jamMatch[2] ? parseInt(jamMatch[2]) : 0;
    const period = jamMatch[3]?.toLowerCase();
    
    if (period === 'sore' && hour < 12) hour += 12;
    if (period === 'malam' && hour < 12) hour += 12;
    if (period === 'pagi' && hour === 12) hour = 0;
    
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  
  const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2]);
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  
  return null;
}

/**
 * Build natural response for complaint status
 */
function buildNaturalStatusResponse(complaint: any): string {
  const statusInfo = getStatusInfo(complaint.status);
  const complaintId = complaint.complaint_id;

  if (statusInfo.text === 'DONE') {
    const note = complaint.admin_notes || '-';
    return `Laporan ${complaintId} telah SELESAI.\nCatatan penanganan: ${note}`;
  }

  if (statusInfo.text === 'REJECT') {
    return `Laporan ${complaintId} DITOLAK.\nAlasan penolakan: ${complaint.admin_notes || '-'}`;
  }

  if (statusInfo.text === 'CANCELED') {
    return `Laporan ${complaintId} telah DIBATALKAN.\nKeterangan: ${complaint.admin_notes || 'Dibatalkan oleh masyarakat'}`;
  }

  if (statusInfo.text === 'PROCESS') {
    return `Status laporan ${complaintId} saat ini adalah PROCESS.`;
  }

  return `Status laporan ${complaintId} saat ini adalah ${statusInfo.text}.`;
}

/**
 * Build natural response for service request status
 * Now includes result file and description from admin
 */
function buildNaturalServiceStatusResponse(serviceRequest: any): string {
  const statusMap: Record<string, { emoji: string; text: string }> = {
    'OPEN': { emoji: '🆕', text: 'OPEN' },
    'PROCESS': { emoji: '🔄', text: 'PROCESS' },
    'DONE': { emoji: '✅', text: 'DONE' },
    'CANCELED': { emoji: '🔴', text: 'CANCELED' },
    'REJECT': { emoji: '❌', text: 'REJECT' },
    'baru': { emoji: '🆕', text: 'OPEN' },
    'proses': { emoji: '🔄', text: 'PROCESS' },
    'selesai': { emoji: '✅', text: 'DONE' },
    'dibatalkan': { emoji: '🔴', text: 'CANCELED' },
  };

  const statusInfo = statusMap[serviceRequest.status] || { emoji: '📋', text: serviceRequest.status };

  let message = `Baik Pak/Bu, status layanan ${serviceRequest.request_number} saat ini adalah ${statusInfo.text}.`;

  if (statusInfo.text === 'OPEN') {
    message += `\nPermohonan sedang menunggu untuk diproses.`;
  }

  if (statusInfo.text === 'PROCESS') {
    message += `\nPermohonan Anda sedang diproses oleh petugas desa.`;
  }

  if (statusInfo.text === 'DONE') {
    if (serviceRequest.admin_notes) {
      message += `\n\nCatatan dari petugas desa:\n${serviceRequest.admin_notes}`;
    }
  }

  if (statusInfo.text === 'REJECT') {
    message += `\n\nAlasan penolakan:\n${serviceRequest.admin_notes || '-'}`;
  }

  if (statusInfo.text === 'CANCELED') {
    message += `\n\nKeterangan: ${serviceRequest.admin_notes || 'Dibatalkan'}`;
  }

  return message;
}

function maskSensitiveId(value: string, keepStart = 4, keepEnd = 4): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= keepStart + keepEnd) return text;
  const masked = '*'.repeat(Math.max(3, text.length - keepStart - keepEnd));
  return `${text.slice(0, keepStart)}${masked}${text.slice(-keepEnd)}`;
}

function toSafeDate(value: any): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateTimeId(date: Date | null): string {
  if (!date) return '-';
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function buildComplaintDetailResponse(complaint: any): string {
  const statusInfo = getStatusInfo(complaint.status);
  const createdAt = toSafeDate(complaint.created_at || complaint.createdAt);
  const updatedAt = toSafeDate(complaint.updated_at || complaint.updatedAt);
  const adminNoteSection = buildAdminNoteSection(complaint.status, complaint.admin_notes);

  let message = `📄 *Detail Laporan*\n\n`;
  message += `🆔 *Nomor:* ${complaint.complaint_id}\n`;
  message += `📌 *Jenis:* ${formatKategori(complaint.kategori)}\n`;
  if (complaint.alamat) message += `📍 *Lokasi:* ${complaint.alamat}\n`;
  if (complaint.rt_rw) message += `🏠 *RT/RW:* ${complaint.rt_rw}\n`;
  if (complaint.deskripsi) message += `\n📝 *Deskripsi:*\n${complaint.deskripsi}\n`;

  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;
  message += `${statusInfo.description}\n`;

  if (adminNoteSection) {
    message += adminNoteSection;
  }

  message += `\n🗓️ *Dibuat:* ${formatDateTimeId(createdAt)}\n`;
  message += `🕐 *Update terakhir:* ${formatDateTimeId(updatedAt)}\n`;

  return message;
}

function buildServiceRequestDetailResponse(serviceRequest: any, requirementDefs: ServiceRequirementDefinition[] = []): string {
  const statusMap: Record<string, { emoji: string; text: string }> = {
    'OPEN': { emoji: '🆕', text: 'OPEN' },
    'PROCESS': { emoji: '🔄', text: 'PROCESS' },
    'DONE': { emoji: '✅', text: 'DONE' },
    'CANCELED': { emoji: '🔴', text: 'CANCELED' },
    'REJECT': { emoji: '❌', text: 'REJECT' },
    'baru': { emoji: '🆕', text: 'OPEN' },
    'proses': { emoji: '🔄', text: 'PROCESS' },
    'selesai': { emoji: '✅', text: 'DONE' },
    'dibatalkan': { emoji: '🔴', text: 'CANCELED' },
  };
  const statusInfo = statusMap[serviceRequest.status] || { emoji: '📋', text: serviceRequest.status };
  const createdAt = toSafeDate(serviceRequest.created_at || serviceRequest.createdAt);
  const updatedAt = toSafeDate(serviceRequest.updated_at || serviceRequest.updatedAt);
  const adminNoteSection = buildAdminNoteSection(serviceRequest.status, serviceRequest.admin_notes);

  let message = `📄 *Detail Layanan*\n\n`;
  message += `🆔 *Nomor:* ${serviceRequest.request_number}\n`;
  message += `📌 *Layanan:* ${serviceRequest.service?.name || 'Layanan Administrasi'}\n`;
  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;

  if (adminNoteSection) {
    message += adminNoteSection;
  }

  if (serviceRequest.result_description) {
    message += `\n📝 *Hasil:* ${serviceRequest.result_description}\n`;
  }

  if (serviceRequest.result_file_url) {
    const fileName = serviceRequest.result_file_name || 'Dokumen Hasil';
    message += `\n📎 *Dokumen:* ${fileName}\n`;
    message += `🔗 Link download: ${serviceRequest.result_file_url}\n`;
  }

  const citizen = serviceRequest.citizen_data_json || {};
  const reqData = serviceRequest.requirement_data_json || {};
  const reqFilledCount = typeof reqData === 'object' && reqData ? Object.values(reqData).filter(Boolean).length : 0;

  message += `\n👤 *Data pemohon (ringkas):*\n`;
  if (citizen.nama_lengkap) message += `• Nama: ${citizen.nama_lengkap}\n`;
  if (citizen.nik) message += `• NIK: ${maskSensitiveId(String(citizen.nik), 4, 4)}\n`;
  if (citizen.alamat) message += `• Alamat: ${citizen.alamat}\n`;
  if (citizen.wa_user_id) message += `• WA: ${citizen.wa_user_id}\n`;

  const hasDefs = Array.isArray(requirementDefs) && requirementDefs.length > 0;
  if (!hasDefs) {
    message += `• Persyaratan terisi: ${reqFilledCount}\n`;
  }

  if (hasDefs) {
    const defsSorted = [...requirementDefs].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const totalRequired = defsSorted.filter(d => d.is_required).length;
    const filledRequired = defsSorted.filter(d => d.is_required && !!(reqData as any)?.[d.id]).length;
    message += `• Persyaratan wajib terisi: ${filledRequired}/${totalRequired}\n`;

    const isProbablyUrl = (value: unknown): boolean => {
      const s = typeof value === 'string' ? value : '';
      return /^https?:\/\//i.test(s) || /\.(pdf|jpg|jpeg|png|doc|docx)(\?|#|$)/i.test(s);
    };

    const safeValueSummary = (def: ServiceRequirementDefinition, rawValue: any): string | null => {
      if (!rawValue) return null;
      if (def.field_type === 'file') return 'Terlampir';
      if (isProbablyUrl(rawValue)) return 'Terlampir';
      const s = String(rawValue);
      const cleaned = s.replace(/\s+/g, ' ').trim();
      if (!cleaned) return null;
      if (cleaned.length > 60) return `${cleaned.slice(0, 57)}...`;
      return cleaned;
    };

    const missingRequired = defsSorted.filter(d => d.is_required && !(reqData as any)?.[d.id]);
    if (missingRequired.length > 0) {
      const missLines = missingRequired.map(d => `❌ ${d.label}`).join('\n');
      message += `\n⚠️ *Persyaratan wajib belum lengkap:*\n${missLines}\n`;
    } else if (totalRequired > 0) {
      message += `\n✅ *Semua persyaratan wajib sudah lengkap.*\n`;
    }

    const filledSummaries = defsSorted
      .map(d => {
        const raw = (reqData as any)?.[d.id];
        const summary = safeValueSummary(d, raw);
        if (!summary) return null;
        return `✅ ${d.label}: ${summary}`;
      })
      .filter(Boolean) as string[];

    // Keep the output compact: show up to 10 filled summaries.
    if (filledSummaries.length > 0) {
      message += `\n📎 *Ringkasan persyaratan terisi:*\n${filledSummaries.slice(0, 10).join('\n')}\n`;
      if (filledSummaries.length > 10) {
        message += `(${filledSummaries.length - 10} item lainnya disembunyikan)\n`;
      }
    }
  }

  message += `\n🗓️ *Dibuat:* ${formatDateTimeId(createdAt)}\n`;
  message += `🕐 *Update terakhir:* ${formatDateTimeId(updatedAt)}\n`;

  return message;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMinutes < 1) return 'baru saja';
  if (diffMinutes < 60) return `${diffMinutes} menit yang lalu`;
  if (diffHours < 24) return `${diffHours} jam yang lalu`;
  if (diffDays === 1) return 'kemarin';
  return `${diffDays} hari yang lalu`;
}

function formatKategori(kategori: string): string {
  const kategoriMap: Record<string, string> = {
    'jalan_rusak': 'Jalan Rusak',
    'lampu_mati': 'Lampu Jalan Mati',
    'sampah': 'Masalah Sampah',
    'drainase': 'Saluran Air/Drainase',
    'pohon_tumbang': 'Pohon Tumbang',
    'fasilitas_rusak': 'Fasilitas Umum Rusak',
    'banjir': 'Banjir',
    'lainnya': 'Lainnya',
  };
  return kategoriMap[kategori] || kategori.replace(/_/g, ' ');
}

function getStatusInfo(status: string): { emoji: string; text: string; description: string } {
  const statusMap: Record<string, { emoji: string; text: string; description: string }> = {
    'OPEN': { emoji: '🆕', text: 'OPEN', description: 'Laporan baru diterima dan menunggu diproses.' },
    'PROCESS': { emoji: '🔄', text: 'PROCESS', description: 'Laporan sedang diproses oleh petugas desa.' },
    'DONE': { emoji: '✅', text: 'DONE', description: 'Laporan sudah selesai ditangani.' },
    'CANCELED': { emoji: '🔴', text: 'CANCELED', description: 'Laporan dibatalkan sesuai keterangan.' },
    'REJECT': { emoji: '❌', text: 'REJECT', description: 'Laporan ditolak oleh petugas desa.' },
    'baru': { emoji: '🆕', text: 'OPEN', description: 'Laporan baru diterima dan menunggu diproses.' },
    'proses': { emoji: '🔄', text: 'PROCESS', description: 'Laporan sedang diproses oleh petugas desa.' },
    'selesai': { emoji: '✅', text: 'DONE', description: 'Laporan sudah selesai ditangani.' },
    'dibatalkan': { emoji: '🔴', text: 'CANCELED', description: 'Laporan dibatalkan sesuai keterangan.' },
  };
  return statusMap[status] || { emoji: '📋', text: status, description: 'Silakan tunggu update selanjutnya ya!' };
}

function buildAdminNoteSection(status: string, adminNotes?: string): string {
  const normalized = (status || '').toString().toUpperCase();
  const note = adminNotes ? String(adminNotes).trim() : '';

  if (normalized === 'DONE') {
    return note ? `\n\n💬 *Catatan petugas:*\n${note}\n` : '';
  }

  if (normalized === 'REJECT') {
    return `\n\n📝 *Alasan penolakan:*\n${note || '-'}\n`;
  }

  if (normalized === 'CANCELED') {
    return `\n\n📝 *Keterangan:* ${note || 'Dibatalkan'}\n`;
  }

  return note ? `\n\n💬 *Catatan petugas:*\n${note}\n` : '';
}

function buildCancelSuccessResponse(type: 'laporan' | 'layanan', id: string, reason: string): string {
  const label = type === 'laporan' ? 'Laporan' : 'Layanan';
  const note = reason || 'Dibatalkan oleh masyarakat';
  return `${label} ${id} telah DIBATALKAN.\nKeterangan: ${note}`;
}

function buildCancelErrorResponse(type: 'laporan' | 'layanan', id: string, error?: string, message?: string): string {
  const label = type === 'laporan' ? 'laporan' : 'layanan';
  switch (error) {
    case 'NOT_FOUND':
      return `Mohon maaf Pak/Bu, kami tidak menemukan ${label} dengan nomor *${id}*.`;
    case 'NOT_OWNER':
      return `Mohon maaf Pak/Bu, ${label} *${id}* ini bukan milik Anda, jadi tidak bisa dibatalkan.`;
    case 'ALREADY_COMPLETED':
    case 'LOCKED':
      return `Mohon maaf Pak/Bu, ${label} *${id}* sudah tidak bisa dibatalkan karena statusnya sudah final.`;
    default:
      return `Mohon maaf Pak/Bu, ada kendala saat membatalkan ${label}. ${message || 'Silakan coba lagi.'}`;
  }
}

function buildHistoryResponse(items: HistoryItem[], total: number): string {
  const complaints = items.filter(i => i.type === 'complaint');
  const services = items.filter(i => i.type === 'service');

  if (complaints.length > 0) {
    let message = 'Berikut laporan yang pernah Anda kirimkan:\n\n';
    for (const item of complaints.slice(0, 5)) {
      const statusLabel = getStatusLabel(item.status);
      const desc = (item.description || '').trim() || 'Laporan';
      message += `${item.display_id} – ${desc} – ${statusLabel}\n`;
    }
    return message.trim();
  }

  if (services.length > 0) {
    let message = 'Berikut layanan yang pernah Anda ajukan:\n\n';
    for (const item of services.slice(0, 5)) {
      const statusLabel = getStatusLabel(item.status);
      const desc = (item.description || '').trim() || 'Layanan';
      message += `${item.display_id} – ${desc} – ${statusLabel}\n`;
    }
    return message.trim();
  }

  return `Berikut riwayat Anda (${total}).`;
}

function getStatusLabel(status: string): string {
  const normalized = String(status || '').toUpperCase();
  const map: Record<string, string> = {
    OPEN: 'OPEN',
    PROCESS: 'PROCESS',
    DONE: 'SELESAI',
    CANCELED: 'DIBATALKAN',
    REJECT: 'DITOLAK',
    BARU: 'OPEN',
    PENDING: 'OPEN',
    PROSES: 'PROCESS',
    SELESAI: 'SELESAI',
    DIBATALKAN: 'DIBATALKAN',
    DITOLAK: 'DITOLAK',
  };
  return map[normalized] || normalized || 'UNKNOWN';
}


// ==================== MAIN PROCESSOR ====================

/**
 * Get pending address confirmation for a user
 */
export function getPendingAddressConfirmation(userId: string) {
  return pendingAddressConfirmation.get(userId);
}

/**
 * Clear pending address confirmation for a user
 */
export function clearPendingAddressConfirmation(userId: string) {
  pendingAddressConfirmation.delete(userId);
}

/**
 * Set pending address confirmation for a user
 */
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

/**
 * Process message from any channel
 * This is the SINGLE SOURCE OF TRUTH for message processing
 * 
 * OPTIMIZATION FLOW:
 * 1. Spam check
 * 2. Pending state check
 * 3. Fast intent classification (NEW)
 * 4. Response cache check (NEW)
 * 5. Entity pre-extraction (NEW)
 * 6. If fast path available → return cached/quick response
 * 7. Otherwise → full LLM processing
 */
export async function processUnifiedMessage(input: ProcessMessageInput): Promise<ProcessMessageResult> {
  const startTime = Date.now();
  const { userId, message, channel, conversationHistory, mediaUrl, villageId } = input;
  let resolvedHistory = conversationHistory;
  
  // Import processing status tracker
  const { createProcessingTracker } = await import('./processing-status.service');
  const tracker = createProcessingTracker(userId);
  
  logger.info('🎯 [UnifiedProcessor] Processing message', {
    userId,
    channel,
    messageLength: message.length,
    hasHistory: !!conversationHistory,
    hasMedia: !!mediaUrl,
  });
  
  try {
    // Update status: reading message
    tracker.reading();
    
    // Step 1: Spam check
    if (isSpamMessage(message)) {
      logger.warn('🚫 [UnifiedProcessor] Spam detected', { userId, channel });
      return {
        success: false,
        response: '',
        intent: 'SPAM',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        error: 'Spam message detected',
      };
    }

    const resolvedVillageId = villageId || process.env.DEFAULT_VILLAGE_ID;
    const greetingPattern = /^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam)|assalamualaikum|permisi)/i;

    if (channel === 'whatsapp' && (!resolvedHistory || resolvedHistory.length === 0)) {
      resolvedHistory = await fetchConversationHistoryFromChannel(userId, resolvedVillageId);
      logger.info('📚 [UnifiedProcessor] Loaded WhatsApp history', {
        userId,
        historyCount: resolvedHistory?.length || 0,
      });
    }

    const pendingName = pendingNameConfirmation.get(userId);
    if (pendingName) {
      if (isConfirmationResponse(message)) {
        pendingNameConfirmation.delete(userId);
        updateProfile(userId, { nama_lengkap: pendingName.name });
        return {
          success: true,
          response: `Baik, terima kasih Pak/Bu ${pendingName.name}. Ada yang bisa kami bantu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      if (isNegativeConfirmation(message)) {
        pendingNameConfirmation.delete(userId);
        return {
          success: true,
          response: 'Mohon maaf, boleh kami tahu nama yang benar?',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      return {
        success: true,
        response: `Baik, apakah benar ini dengan Bapak/Ibu ${pendingName.name}? Balas YA atau BUKAN ya.`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
      };
    }

    const lastPromptedName = extractNameFromAssistantPrompt(getLastAssistantMessage(resolvedHistory));
    if (lastPromptedName) {
      if (isConfirmationResponse(message)) {
        logger.info('🧭 [UnifiedProcessor] Name confirmation via history', {
          userId,
          name: lastPromptedName,
          source: 'history_prompt',
        });
        updateProfile(userId, { nama_lengkap: lastPromptedName });
        return {
          success: true,
          response: `Baik, terima kasih Pak/Bu ${lastPromptedName}. Ada yang bisa kami bantu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      if (isNegativeConfirmation(message)) {
        return {
          success: true,
          response: 'Mohon maaf, boleh kami tahu nama yang benar?',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }
    }

    // Step 2.2: Check pending online service form offer
    const pendingOffer = pendingServiceFormOffer.get(userId);
    if (pendingOffer) {
      const wantsFormLink = /\b(link|tautan|formulir|form|online)\b/i.test(message);
      if (isConfirmationResponse(message) || wantsFormLink) {
        clearPendingServiceFormOffer(userId);
        const llmLike = {
          intent: 'CREATE_SERVICE_REQUEST',
          fields: {
            service_slug: pendingOffer.service_slug,
            ...(pendingOffer.village_id ? { village_id: pendingOffer.village_id } : {}),
          },
          reply_text: '',
        };

        const linkReply = await handleServiceRequestCreation(userId, channel, llmLike);
        return {
          success: true,
          response: linkReply,
          intent: 'CREATE_SERVICE_REQUEST',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      if (isNegativeConfirmation(message)) {
        clearPendingServiceFormOffer(userId);
        return {
          success: true,
          response: 'Baik Pak/Bu, siap. Kalau Bapak/Ibu mau proses nanti, kabari kami ya.',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      return {
        success: true,
        response: 'Apakah Bapak/Ibu ingin kami kirim link formulirnya sekarang? Balas *iya* atau *tidak* ya.',
        intent: 'CREATE_SERVICE_REQUEST',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
      };
    }

    // Hard gate: wajib tahu nama sebelum proses apa pun
    const profileName = getProfile(userId).nama_lengkap || null;
    const knownName = extractNameFromHistory(resolvedHistory) || profileName;
    const currentName = extractNameFromText(message);
    if (!knownName && !currentName) {
      const askedNameBefore = wasNamePrompted(resolvedHistory);
      if (askedNameBefore) {
        return {
          success: true,
          response: 'Maaf Pak/Bu, saya belum menangkap nama Anda. Mohon tuliskan nama Anda, misalnya: "Nama saya Yoga".',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      if (greetingPattern.test(message.trim())) {
        const profile = await getVillageProfileSummary(resolvedVillageId);
        const villageLabel = profile?.name ? profile.name : 'Desa/Kelurahan';
        return {
          success: true,
          response: `Selamat datang di layanan GovConnect ${villageLabel}.
Boleh kami tahu nama Bapak/Ibu terlebih dahulu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      return {
        success: true,
        response: 'Baik Pak/Bu, sebelum melanjutkan boleh kami tahu nama Anda terlebih dahulu?',
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
      };
    }

    if (!knownName && currentName) {
      const explicitName = /(nama\s+(saya|aku|gue|gw)|panggil\s+saya)/i.test(message);
      if (explicitName) {
        updateProfile(userId, { nama_lengkap: currentName });
        return {
          success: true,
          response: `Baik, terima kasih Pak/Bu ${currentName}. Ada yang bisa kami bantu?`,
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      pendingNameConfirmation.set(userId, { name: currentName, timestamp: Date.now() });
      return {
        success: true,
        response: `Baik, apakah benar ini dengan Bapak/Ibu ${currentName}?`,
        intent: 'QUESTION',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
      };
    }
    
    // Step 2: Check pending address confirmation
    const pendingConfirm = pendingAddressConfirmation.get(userId);
    if (pendingConfirm) {
      const confirmResult = await handlePendingAddressConfirmation(userId, message, pendingConfirm, channel === 'webchat' ? 'webchat' : 'whatsapp', mediaUrl);
      if (confirmResult) {
        return {
          success: true,
          response: confirmResult,
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }
    }

    // Step 2.1: Check pending cancel confirmation
    const pendingCancel = pendingCancelConfirmation.get(userId);
    if (pendingCancel) {
      if (isConfirmationResponse(message)) {
        clearPendingCancelConfirmation(userId);
        if (pendingCancel.type === 'laporan') {
          const result = await cancelComplaint(pendingCancel.id, buildChannelParams(channel, userId), pendingCancel.reason);
          return {
            success: true,
            response: result.success
              ? buildCancelSuccessResponse('laporan', pendingCancel.id, result.message)
              : buildCancelErrorResponse('laporan', pendingCancel.id, result.error, result.message),
            intent: 'CANCEL_COMPLAINT',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
          };
        }

        const serviceResult = await cancelServiceRequest(pendingCancel.id, buildChannelParams(channel, userId), pendingCancel.reason);
        return {
          success: true,
          response: serviceResult.success
            ? buildCancelSuccessResponse('layanan', pendingCancel.id, serviceResult.message)
            : buildCancelErrorResponse('layanan', pendingCancel.id, serviceResult.error, serviceResult.message),
          intent: 'CANCEL_SERVICE_REQUEST',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      if (isNegativeConfirmation(message)) {
        clearPendingCancelConfirmation(userId);
        return {
          success: true,
          response: 'Baik Pak/Bu, pembatalan saya batalkan. Ada yang bisa kami bantu lagi?',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      return {
        success: true,
        response: 'Mohon konfirmasi ya Pak/Bu. Balas "YA" untuk melanjutkan pembatalan, atau "TIDAK" untuk membatalkan.',
        intent: pendingCancel.type === 'laporan' ? 'CANCEL_COMPLAINT' : 'CANCEL_SERVICE_REQUEST',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
      };
    }

    // Step 2.5: AI Optimization - Pre-process message
    const historyString = resolvedHistory?.map(m => `${m.role}: ${m.content}`).join('\n') || '';
    let templateContext: { villageName?: string | null; villageShortName?: string | null } | undefined;

    if (greetingPattern.test(message.trim())) {
      const profile = await getVillageProfileSummary(resolvedVillageId);
      if (profile?.name) {
        templateContext = {
          villageName: profile.name,
          villageShortName: profile.short_name || null,
        };
      }
    }

    const optimization = preProcessMessage(message, userId, historyString, templateContext);

    const forceLlmIntent = process.env.FORCE_LLM_INTENT === 'true';

    // Step 2.55: Deterministic status check fast-path (avoid LLM misclassification)
    if (
      !forceLlmIntent &&
      !pendingConfirm &&
      optimization.fastIntent?.intent === 'CHECK_STATUS' &&
      (optimization.fastIntent.extractedFields?.complaint_id || optimization.fastIntent.extractedFields?.request_number)
    ) {
      const fastFields = {
        ...(optimization.fastIntent.extractedFields || {}),
        ...(resolvedVillageId ? { village_id: resolvedVillageId } : {}),
      };

      const fastLlmLike = {
        intent: 'CHECK_STATUS',
        fields: fastFields,
        reply_text: '',
      };

      const responseText = await handleStatusCheck(userId, channel, fastLlmLike, message);
      return {
        success: true,
        response: responseText,
        intent: 'CHECK_STATUS',
        fields: fastFields,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          hasKnowledge: false,
        },
      };
    }
    
    // Step 2.6: Check if we can use fast path (skip LLM)
    const shouldBypassFastPath = /(alamat|lokasi|maps|google\s*maps|jam|operasional|buka|tutup|nomor|kontak|telepon|telp|hubungi)/i.test(message);
    if (!forceLlmIntent && !shouldBypassFastPath && shouldUseFastPath(optimization, !!pendingConfirm)) {
      const fastResult = buildFastPathResponse(optimization, startTime);
      if (fastResult) {
        logger.info('⚡ [UnifiedProcessor] Using fast path', {
          userId,
          intent: fastResult.intent,
          usedCache: fastResult.optimization?.usedCache,
          processingTimeMs: fastResult.metadata.processingTimeMs,
        });
        return fastResult;
      }
    }
    
    // Step 3: Sanitize and correct typos
    let sanitizedMessage = sanitizeUserInput(message);
    sanitizedMessage = normalizeText(sanitizedMessage);
    
    // Step 4: Language detection
    const languageDetection = detectLanguage(sanitizedMessage);
    const languageContext = getLanguageContext(languageDetection);
    
    // Step 5: Sentiment analysis
    const sentiment = analyzeSentiment(sanitizedMessage, userId);
    const sentimentContext = getSentimentContext(sentiment);
    
    // Step 5.5: User Profile & Context Enhancement
    // Learn from message (extract NIK, phone, detect style)
    learnFromMessage(userId, message);
    
    // Step 5.6: Cross-channel context
    // Record activity and try to link phone number
    recordChannelActivity(userId);
    const phoneFromMessage = message.match(/\b(08\d{8,11}|628\d{8,12})\b/)?.[1];
    if (phoneFromMessage) {
      linkUserToPhone(userId, phoneFromMessage);
      updateSharedData(userId, { name: undefined }); // Will be filled by profile
    }
    const crossChannelContext = getCrossChannelContextForLLM(userId);
    
    // Record interaction for profile
    recordInteraction(userId, sentiment.score, optimization?.fastIntent?.intent);
    
    // Get profile context for LLM
    const profileContext = getProfileContext(userId);
    
    // Get enhanced conversation context
    const conversationCtx = getEnhancedContext(userId);
    const conversationContextStr = getContextForLLM(userId);
    
    // Build adaptation context (sentiment + profile + conversation)
    const adaptationContext = buildAdaptationContext(userId, sentiment);
    
    // Check if user needs human escalation
    if (needsHumanEscalation(userId) || conversationCtx.needsHumanHelp) {
      logger.warn('🚨 User needs human escalation', { 
        userId, 
        sentiment: sentiment.level,
        clarificationCount: conversationCtx.clarificationCount,
        isStuck: conversationCtx.isStuck,
      });
    }
    
    // Step 6: Pre-fetch RAG context if needed
    // Update status: searching knowledge
    tracker.searching();
    
    let preloadedRAGContext: RAGContext | string | undefined;
    let graphContext = '';
    const isGreeting = greetingPattern.test(sanitizedMessage.trim());
    const looksLikeQuestion = shouldRetrieveContext(sanitizedMessage);
    const prefetchVillageId = resolvedVillageId;
    
    if (isGreeting) {
      try {
        const kelurahanInfo = await getKelurahanInfoContext(prefetchVillageId);
        if (kelurahanInfo) preloadedRAGContext = kelurahanInfo;
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] Failed to fetch kelurahan info', { error: error.message });
      }
    } else if (looksLikeQuestion) {
      try {
        const ragContext = await getRAGContext(sanitizedMessage, undefined, prefetchVillageId);
        if (ragContext.totalResults > 0) preloadedRAGContext = ragContext;
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] RAG fetch failed', { error: error.message });
      }
    }
    
    // Step 6.5: Get knowledge graph context for service-related queries
    if (optimization?.fastIntent?.intent) {
      try {
        const { getGraphContext, findNodeByKeyword } = await import('./knowledge-graph.service');
        
        // Try to find relevant service code from message
        const serviceCodeMatch = sanitizedMessage.match(/\b(SKD|SKTM|SKU|SPKTP|SPKK|SPSKCK|SPAKTA|IKR)\b/i);
        if (serviceCodeMatch) {
          graphContext = getGraphContext(serviceCodeMatch[1].toUpperCase());
        } else {
          // Try keyword matching
          const keywords = ['domisili', 'tidak mampu', 'usaha', 'ktp', 'kk', 'skck', 'akta', 'keramaian'];
          for (const kw of keywords) {
            if (sanitizedMessage.toLowerCase().includes(kw)) {
              const node = findNodeByKeyword(kw);
              if (node) {
                graphContext = getGraphContext(node.code);
                break;
              }
            }
          }
        }
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] Knowledge graph lookup failed', { error: error.message });
      }
    }
    
    // Step 7: Build context
    let systemPrompt: string;
    let messageCount: number;
    
    if (channel === 'webchat' && resolvedHistory) {
      const contextResult = await buildContextWithHistory(userId, sanitizedMessage, resolvedHistory, preloadedRAGContext);
      systemPrompt = contextResult.systemPrompt;
      messageCount = contextResult.messageCount;
    } else {
      const contextResult = await buildContext(userId, sanitizedMessage, preloadedRAGContext);
      systemPrompt = contextResult.systemPrompt;
      messageCount = contextResult.messageCount;
    }
    
    // Inject language, sentiment, profile, conversation, graph, and cross-channel context
    const allContexts = [
      languageContext,
      sentimentContext,
      profileContext,
      conversationContextStr,
      adaptationContext,
      graphContext,
      crossChannelContext,
    ].filter(Boolean).join('\n');
    
    if (allContexts) {
      systemPrompt = systemPrompt.replace(
        'PESAN TERAKHIR USER:',
        `${allContexts}\n\nPESAN TERAKHIR USER:`
      );
    }
    
    // Step 8: Call LLM
    // Update status: thinking
    tracker.thinking();
    const llmResult = await callGemini(systemPrompt);
    
    if (!llmResult) {
      throw new Error('LLM call failed - all models exhausted');
    }
    
    const { response: llmResponse, metrics } = llmResult;

    // Anti-hallucination gate (jam operasional/biaya) when knowledge is empty
    // NOTE: Knowledge context is embedded inside systemPrompt when available.
    const hasKnowledge = hasKnowledgeInPrompt(systemPrompt);
    const gate = needsAntiHallucinationRetry({
      replyText: llmResponse.reply_text,
      guidanceText: llmResponse.guidance_text,
      hasKnowledge,
    });

    if (gate.shouldRetry) {
      logAntiHallucinationEvent({
        userId,
        channel,
        reason: gate.reason,
        model: metrics.model,
      });

      const retryPrompt = appendAntiHallucinationInstruction(systemPrompt);
      const retryResult = await callGemini(retryPrompt);
      if (retryResult?.response?.reply_text) {
        llmResult.response = retryResult.response;
      }
    }
    
    // Track analytics
    aiAnalyticsService.recordIntent(
      userId,
      llmResult.response.intent,
      metrics.durationMs,
      systemPrompt.length,
      llmResult.response.reply_text.length,
      metrics.model
    );
    
    logger.info('[UnifiedProcessor] LLM response received', {
      userId,
      channel,
      intent: llmResult.response.intent,
      durationMs: metrics.durationMs,
    });
    
    // Update status: preparing response
    tracker.preparing();
    
    // Step 9: Handle intent
    const effectiveLlmResponse = llmResult.response;

    // If webhook already resolved tenant, enforce it deterministically.
    if (input.villageId) {
      effectiveLlmResponse.fields = {
        ...(effectiveLlmResponse.fields || {}),
        village_id: input.villageId,
      } as any;
    }

    effectiveLlmResponse.fields = {
      ...(effectiveLlmResponse.fields || {}),
      _original_message: message,
    } as any;

    let finalReplyText = effectiveLlmResponse.reply_text;
    let guidanceText = effectiveLlmResponse.guidance_text || '';

    // Deterministic override: office profile questions (address/hours/contact) must NEVER
    // turn into service request links or other hallucinated outputs.
    const isOfficeInfoQuestion = /(alamat|lokasi|maps|google\s*maps|jam|operasional|buka|tutup|nomor|kontak|telepon|telp|hubungi)/i.test(message);
    const hasTrackingId = /\b(LAP|LAY)-\d{8}-\d{3}\b/i.test(message);
    const looksLikeInfoQuestion = /(\?|\b(apa|bagaimana|gimana|cara|syarat|format|status|cek\s+status|berkas|dokumen|panduan|sop|alur|notifikasi|checklist)\b)/i.test(message);
    const looksLikeCreateService = /\b(ajukan|buat|bikin|minta)\b.*\b(surat|izin|layanan)\b/i.test(message);
    if (isOfficeInfoQuestion) {
      effectiveLlmResponse.intent = 'KNOWLEDGE_QUERY';
      finalReplyText = await handleKnowledgeQuery(userId, message, effectiveLlmResponse);
    } else if (looksLikeInfoQuestion && !hasTrackingId && !looksLikeCreateService) {
      // Ground informational Q&A (format/syarat/status/SOP/panduan/etc) via KB/RAG, even if LLM intent is misclassified.
      effectiveLlmResponse.intent = 'KNOWLEDGE_QUERY';
      if (preloadedRAGContext && typeof preloadedRAGContext === 'object' && preloadedRAGContext.contextString) {
        effectiveLlmResponse.fields = {
          ...(effectiveLlmResponse.fields || {}),
          _preloaded_knowledge_context: preloadedRAGContext.contextString,
        } as any;
      }
      finalReplyText = await handleKnowledgeQuery(userId, message, effectiveLlmResponse);
    } else {

    const infoInquiryPattern = /(\?|\b(syarat|persyaratan|berkas|dokumen|info|informasi|biaya|lama|alur|panduan|cara|prosedur)\b)/i;
    const applyVerbPattern = /\b(ajukan|daftar|buat|bikin|mohon|minta|proses|kirim|ajukan|submit)\b/i;
    const serviceNounPattern = /\b(layanan|surat|izin|permohonan|pelayanan)\b/i;
    const wantsFormPattern = /\b(link|tautan|formulir|form|online)\b/i;

    const looksLikeInquiry = infoInquiryPattern.test(message);
    const explicitApplyRequest = (applyVerbPattern.test(message) || wantsFormPattern.test(message)) && serviceNounPattern.test(message);

    if (effectiveLlmResponse.intent === 'CREATE_SERVICE_REQUEST' && looksLikeInquiry && !explicitApplyRequest) {
      effectiveLlmResponse.intent = 'SERVICE_INFO';
    }

    if (['SERVICE_INFO', 'CREATE_SERVICE_REQUEST'].includes(effectiveLlmResponse.intent)) {
      const hasServiceRef = !!(effectiveLlmResponse.fields?.service_slug || effectiveLlmResponse.fields?.service_id);
      if (!hasServiceRef) {
        const resolved = await resolveServiceSlugFromSearch(message, resolvedVillageId);
        if (resolved?.slug) {
          const existingServiceName = (effectiveLlmResponse.fields as any)?.service_name;
          effectiveLlmResponse.fields = {
            ...(effectiveLlmResponse.fields || {}),
            service_slug: resolved.slug,
            service_name: resolved.name || existingServiceName,
          } as any;
        }
      }

      if (effectiveLlmResponse.intent === 'SERVICE_INFO' && explicitApplyRequest && effectiveLlmResponse.fields?.service_slug) {
        effectiveLlmResponse.intent = 'CREATE_SERVICE_REQUEST';
      }
    }
    
    switch (effectiveLlmResponse.intent) {
      case 'CREATE_COMPLAINT':
        const rateLimitCheck = rateLimiterService.checkRateLimit(userId);
        if (!rateLimitCheck.allowed) {
          finalReplyText = rateLimitCheck.message || 'Anda telah mencapai batas laporan hari ini.';
        } else {
          finalReplyText = await handleComplaintCreation(userId, channel, effectiveLlmResponse, message, mediaUrl);
        }
        break;
      
      case 'SERVICE_INFO':
        // Guard: office profile questions sometimes get misclassified as SERVICE_INFO.
        // Route them to the grounded knowledge handler to avoid form-link hallucinations.
        if (/(alamat|lokasi|maps|google\s*maps|jam|operasional|buka|tutup|nomor|kontak|telepon|telp|hubungi)/i.test(message)) {
          finalReplyText = await handleKnowledgeQuery(userId, message, effectiveLlmResponse);
        } else {
          const serviceInfoResult = normalizeHandlerResult(await handleServiceInfo(userId, effectiveLlmResponse));
          finalReplyText = serviceInfoResult.replyText;
          if (serviceInfoResult.guidanceText && !guidanceText) {
            guidanceText = serviceInfoResult.guidanceText;
          }
        }
        break;
      
      case 'CREATE_SERVICE_REQUEST':
        finalReplyText = await handleServiceRequestCreation(userId, channel, effectiveLlmResponse);
        break;

      case 'UPDATE_COMPLAINT':
        finalReplyText = await handleComplaintUpdate(userId, channel, effectiveLlmResponse, message);
        break;

      case 'UPDATE_SERVICE_REQUEST':
        finalReplyText = await handleServiceRequestEditLink(userId, channel, effectiveLlmResponse);
        break;
      
      case 'CHECK_STATUS':
        finalReplyText = await handleStatusCheck(userId, channel, effectiveLlmResponse, message);
        break;
      
      case 'CANCEL_COMPLAINT':
        finalReplyText = await handleCancellationRequest(userId, 'laporan', effectiveLlmResponse);
        break;

      case 'CANCEL_SERVICE_REQUEST':
        finalReplyText = await handleCancellationRequest(userId, 'layanan', effectiveLlmResponse);
        break;
      
      case 'HISTORY':
        finalReplyText = await handleHistory(userId, channel);
        break;
      
      case 'KNOWLEDGE_QUERY':
        if (preloadedRAGContext && typeof preloadedRAGContext === 'object' && preloadedRAGContext.contextString) {
          effectiveLlmResponse.fields = {
            ...(effectiveLlmResponse.fields || {}),
            _preloaded_knowledge_context: preloadedRAGContext.contextString,
          } as any;
        }
        finalReplyText = await handleKnowledgeQuery(userId, message, effectiveLlmResponse);
        break;
      
      case 'QUESTION':
      case 'UNKNOWN':
      default:
        // GREETING and other intents - use LLM reply as-is
        break;
    }
    }
    
    // Step 10: Validate response
    const validatedReply = validateResponse(finalReplyText);
    const validatedGuidance = guidanceText ? validateResponse(guidanceText) : undefined;
    
    // Step 10.5: Adapt response based on sentiment, profile, and context
    const adaptedResult = adaptResponse(validatedReply, userId, sentiment, validatedGuidance);
    const finalResponse = adaptedResult.response;
    const finalGuidance = adaptedResult.guidanceText;
    
    // Step 10.6: Update conversation context
    updateContext(userId, {
      currentIntent: effectiveLlmResponse.intent,
      intentConfidence: optimization?.fastIntent?.confidence || 0.8,
      collectedData: effectiveLlmResponse.fields,
      missingFields: effectiveLlmResponse.fields?.missing_info || [],
    });
    
    // Step 10.7: Post-process - Cache response for future use (only for cacheable intents)
    if (['KNOWLEDGE_QUERY', 'GREETING', 'QUESTION'].includes(effectiveLlmResponse.intent)) {
      postProcessResponse(message, finalResponse, effectiveLlmResponse.intent, finalGuidance);
    }
    
    const processingTimeMs = Date.now() - startTime;
    
    // Update status: complete
    tracker.complete();
    
    logger.info('✅ [UnifiedProcessor] Message processed', {
      userId,
      channel,
      intent: effectiveLlmResponse.intent,
      processingTimeMs,
      fastClassified: !!optimization?.fastIntent,
    });
    
    return {
      success: true,
      response: finalResponse,
      guidanceText: finalGuidance,
      intent: llmResponse.intent,
      fields: llmResponse.fields,
      metadata: {
        processingTimeMs,
        model: metrics.model,
        hasKnowledge: !!preloadedRAGContext,
        knowledgeConfidence: typeof preloadedRAGContext === 'object' ? preloadedRAGContext.confidence?.level : undefined,
        sentiment: sentiment.level !== 'neutral' ? sentiment.level : undefined,
        language: languageDetection.primary !== 'indonesian' ? languageDetection.primary : undefined,
      },
    };
    
  } catch (error: any) {
    const processingTimeMs = Date.now() - startTime;
    
    // Update status: error
    tracker.error(error.message);
    
    logger.error('❌ [UnifiedProcessor] Processing failed', {
      userId,
      channel,
      error: error.message,
      processingTimeMs,
    });
    
    // Use smart fallback based on context
    const { getSmartFallback, getErrorFallback } = await import('./fallback-response.service');
    
    // Determine error type for better fallback
    let errorType: string | undefined;
    if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
      errorType = 'TIMEOUT';
    } else if (error.message?.includes('rate limit') || error.message?.includes('429')) {
      errorType = 'RATE_LIMIT';
    } else if (error.message?.includes('ECONNREFUSED') || error.message?.includes('503')) {
      errorType = 'SERVICE_DOWN';
    }
    
    // Get smart fallback - tries to continue conversation flow if possible
    const fallbackResponse = errorType 
      ? getErrorFallback(errorType)
      : getSmartFallback(userId, undefined, message);
    
    return {
      success: false,
      response: fallbackResponse,
      intent: 'ERROR',
      metadata: { processingTimeMs, hasKnowledge: false },
      error: error.message,
    };
  }
}

/**
 * Handle pending address confirmation
 */
async function handlePendingAddressConfirmation(
  userId: string,
  message: string,
  pendingConfirm: { alamat: string; kategori: string; deskripsi: string; village_id?: string; timestamp: number; foto_url?: string },
  channel: 'whatsapp' | 'webchat',
  mediaUrl?: string
): Promise<string | null> {
  // Check if user confirmed
  if (isConfirmationResponse(message)) {
    logger.info('User confirmed vague address, creating complaint', { userId, alamat: pendingConfirm.alamat });
    
    pendingAddressConfirmation.delete(userId);
    
    const complaintId = await createComplaint({
      wa_user_id: channel === 'webchat' ? undefined : userId,
      channel: channel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
      channel_identifier: userId,
      kategori: pendingConfirm.kategori,
      deskripsi: pendingConfirm.deskripsi,
      village_id: pendingConfirm.village_id,
      alamat: pendingConfirm.alamat,
      rt_rw: '',
      foto_url: pendingConfirm.foto_url,
    });
    
    if (!complaintId) {
      throw new Error('Failed to create complaint after address confirmation');
    }
    
    const withPhotoNote = pendingConfirm.foto_url ? '\nFoto pendukung sudah kami terima.' : '';
    return `Terima kasih.\nLaporan telah kami terima dengan nomor ${complaintId}.${withPhotoNote}`;
  }
  
  // Check if user provides more specific address
  const looksLikeAddress = [
    /jalan/i, /jln/i, /jl\./i, /\bno\b/i, /nomor/i, /\brt\b/i, /\brw\b/i, /gang/i, /gg\./i, /komplek/i, /perumahan/i, /blok/i,
  ].some(pattern => pattern.test(message));
  
  if (looksLikeAddress && !isVagueAddress(message)) {
    logger.info('User provided more specific address', { userId, newAlamat: message });
    
    pendingAddressConfirmation.delete(userId);
    
    const complaintId = await createComplaint({
      wa_user_id: channel === 'webchat' ? undefined : userId,
      channel: channel === 'webchat' ? 'WEBCHAT' : 'WHATSAPP',
      channel_identifier: userId,
      kategori: pendingConfirm.kategori,
      deskripsi: pendingConfirm.deskripsi,
      village_id: pendingConfirm.village_id,
      alamat: message.trim(),
      rt_rw: '',
      foto_url: pendingConfirm.foto_url,
    });
    
    if (!complaintId) {
      throw new Error('Failed to create complaint with updated address');
    }
    
    const withPhotoNote = pendingConfirm.foto_url ? '\nFoto pendukung sudah kami terima.' : '';
    return `Terima kasih.\nLaporan telah kami terima dengan nomor ${complaintId}.${withPhotoNote}`;
  }
  
  // User said something else, clear pending and continue normal flow
  logger.info('User response not confirmation, clearing pending and processing normally', { userId });
  pendingAddressConfirmation.delete(userId);
  return null;
}

/**
 * Build context with provided conversation history (for webchat)
 */
async function buildContextWithHistory(
  userId: string,
  currentMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ragContext?: RAGContext | string
): Promise<{ systemPrompt: string; messageCount: number }> {
  const promptModule = await import('../prompts/system-prompt') as any;
  const getPrompt = typeof promptModule.getFullSystemPrompt === 'function'
    ? promptModule.getFullSystemPrompt
    : () => promptModule.SYSTEM_PROMPT_WITH_KNOWLEDGE || '';

  const conversationHistory = history
    .slice(-10)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  
  let knowledgeSection = '';
  if (ragContext) {
    if (typeof ragContext === 'string') {
      knowledgeSection = ragContext ? `\n\nKNOWLEDGE BASE YANG TERSEDIA:\n${ragContext}` : '';
    } else if (ragContext.contextString) {
      const confidence = ragContext.confidence;
      let confidenceInstruction = '';
      if (confidence) {
        switch (confidence.level) {
          case 'high': confidenceInstruction = `\n[CONFIDENCE: TINGGI - ${confidence.reason}]`; break;
          case 'medium': confidenceInstruction = `\n[CONFIDENCE: SEDANG - ${confidence.reason}]`; break;
          case 'low': confidenceInstruction = `\n[CONFIDENCE: RENDAH - ${confidence.reason}]`; break;
        }
      }
      knowledgeSection = `\n\nKNOWLEDGE BASE YANG TERSEDIA:\n${ragContext.contextString}${confidenceInstruction}`;
    }
  }
  
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const currentDate = today.toISOString().split('T')[0];
  const tomorrowDate = tomorrow.toISOString().split('T')[0];
  
  const systemPrompt = getPrompt()
    .replace('{knowledge_context}', knowledgeSection)
    .replace('{history}', conversationHistory || '(Ini adalah percakapan pertama dengan user)')
    .replace('{user_message}', currentMessage)
    .replace(/\{\{current_date\}\}/g, currentDate)
    .replace(/\{\{tomorrow_date\}\}/g, tomorrowDate);
  
  return { systemPrompt, messageCount: history.length };
}

/**
 * Fallback responses when AI is unavailable
 * Now uses the smart fallback service for better context-aware responses
 */
function getFallbackResponse(message: string): string {
  // Import dynamically to avoid circular dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getFallbackByIntent } = require('./fallback-response.service');
  
  const lowerMessage = message.toLowerCase();
  
  // Detect intent from message for better fallback
  if (/^(halo|hai|hi|hello|selamat|assalam)/i.test(lowerMessage)) {
    return getFallbackByIntent('GREETING');
  }
  
  if (lowerMessage.includes('surat') || lowerMessage.includes('dokumen') || lowerMessage.includes('keterangan') || lowerMessage.includes('layanan') || lowerMessage.includes('permohonan')) {
    return getFallbackByIntent('CREATE_SERVICE_REQUEST');
  }
  
  if (lowerMessage.includes('lapor') || lowerMessage.includes('keluhan') || lowerMessage.includes('aduan') || lowerMessage.includes('rusak') || lowerMessage.includes('mati')) {
    return getFallbackByIntent('CREATE_COMPLAINT');
  }
  
  if (lowerMessage.includes('status') || lowerMessage.includes('cek') || /LAP-|LAY-/i.test(lowerMessage)) {
    return getFallbackByIntent('CHECK_STATUS');
  }
  
  if (lowerMessage.includes('jam') || lowerMessage.includes('buka') || lowerMessage.includes('operasional') || lowerMessage.includes('syarat')) {
    return getFallbackByIntent('KNOWLEDGE_QUERY');
  }
  
  if (lowerMessage.includes('terima kasih') || lowerMessage.includes('makasih')) {
    return getFallbackByIntent('THANKS');
  }
  
  return getFallbackByIntent('UNKNOWN');
}

export default {
  processUnifiedMessage,
  handleComplaintCreation,
  handleComplaintUpdate,
  handleServiceInfo,
  handleServiceRequestCreation,
  handleStatusCheck,
  handleCancellation,
  handleHistory,
  handleKnowledgeQuery,
  validateResponse,
  isVagueAddress,
  isConfirmationResponse,
  detectEmergencyComplaint,
  getPendingAddressConfirmation,
  clearPendingAddressConfirmation,
  setPendingAddressConfirmation,
};
