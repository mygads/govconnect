/**
 * Unified Message Processor Service
 * 
 * SINGLE SOURCE OF TRUTH untuk memproses pesan dari berbagai channel:
 * - WhatsApp (via RabbitMQ)
 * - Webchat (via HTTP)
 * - Future channels (Telegram, etc.)
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
import { createComplaint, getComplaintStatus, cancelComplaint, getUserHistory, HistoryItem } from './case-client.service';
import { searchKnowledge, getRAGContext, getKelurahanInfoContext } from './knowledge.service';
import { shouldRetrieveContext, isSpamMessage } from './rag.service';
import { detectLanguage, getLanguageContext } from './language-detection.service';
import { analyzeSentiment, getSentimentContext, needsHumanEscalation } from './sentiment-analysis.service';
import { rateLimiterService } from './rate-limiter.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { RAGContext } from '../types/embedding.types';
import { caseServiceClient } from '../clients/case-service.client';

// AI Optimization imports
import { 
  preProcessMessage, 
  postProcessResponse, 
  shouldUseFastPath, 
  buildFastPathResponse,
  enhanceLLMFields,
  OptimizationResult,
} from './ai-optimizer.service';
import { fastClassifyIntent } from './fast-intent-classifier.service';
import { extractAllEntities } from './entity-extractor.service';

// User Profile & Context imports
import { 
  getProfile, 
  recordInteraction, 
  learnFromMessage, 
  saveDefaultAddress,
  getProfileContext,
  recordServiceUsage,
} from './user-profile.service';
import { 
  getEnhancedContext, 
  updateContext, 
  recordClarification,
  recordDataCollected,
  recordCompletedAction,
  getContextForLLM,
} from './conversation-context.service';
import { 
  adaptResponse, 
  buildAdaptationContext,
} from './response-adapter.service';

// Cross-channel context imports
import {
  linkUserToPhone,
  recordChannelActivity,
  updateSharedData,
  getCrossChannelContextForLLM,
  extractPhoneNumber,
} from './cross-channel-context.service';

// ==================== TYPES ====================

export type ChannelType = 'whatsapp' | 'webchat' | 'telegram' | 'other';

export interface ProcessMessageInput {
  /** Unique user identifier (wa_user_id for WhatsApp, session_id for webchat) */
  userId: string;
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
  timestamp: number;
  foto_url?: string;
}> = new Map();

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
}, 60 * 1000);

// ==================== TYPO CORRECTIONS ====================

/**
 * Common Indonesian typo corrections
 * Centralized so all channels use the same corrections
 */
const TYPO_CORRECTIONS: Record<string, string> = {
  // Document typos
  'srat': 'surat',
  'sktm': 'SKTM',
  'skd': 'SKD',
  
  // Informal language
  'gw': 'saya',
  'gue': 'saya', 
  'gua': 'saya',
  'aku': 'saya',
  
  // Time expressions
  'bsk': 'besok',
  
  // Location/address
  'jln': 'jalan',
  'jl': 'jalan',
  'gg': 'gang',
  'rt': 'RT',
  'rw': 'RW',
  
  // Greetings
  'hlo': 'halo',
  'hai': 'halo',
  'hi': 'halo',
  'hello': 'halo',
  
  // Common words
  'pengen': 'ingin',
  'butuh': 'perlu',
  'bikin': 'buat',
  'gimana': 'bagaimana',
  'gmn': 'bagaimana',
  
  // Negation
  'ga': 'tidak',
  'gak': 'tidak',
  'nggak': 'tidak',
  'engga': 'tidak',
  'enggak': 'tidak',
  
  // Common typos
  'ok': 'oke',
  'okay': 'oke',
};

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
  
  // Remove any profanity
  for (const pattern of PROFANITY_PATTERNS) {
    cleaned = cleaned.replace(pattern, '***');
  }
  
  // Ensure response isn't too long
  if (cleaned.length > 4000) {
    cleaned = cleaned.substring(0, 3950) + '...\n\nPesan terpotong karena terlalu panjang.';
  }
  
  // Remove raw JSON/code artifacts
  if (cleaned.includes('```') || cleaned.includes('{\"')) {
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


// ==================== ACTION HANDLERS ====================

/**
 * Handle complaint creation
 */
export async function handleComplaintCreation(
  userId: string, 
  llmResponse: any, 
  currentMessage: string, 
  mediaUrl?: string
): Promise<string> {
  const { kategori, rt_rw } = llmResponse.fields;
  let { alamat, deskripsi } = llmResponse.fields;
  
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
    deskripsi = kategoriMap[kategori] || `Laporan ${kategori.replace(/_/g, ' ')}`;
  }
  
  // Check if we have enough information
  if (!kategori || !alamat) {
    logger.info('Incomplete complaint data, asking for more info', {
      userId,
      hasKategori: !!kategori,
      hasAlamat: !!alamat,
      hasDeskripsi: !!deskripsi,
    });
    
    if (!kategori) {
      return 'Mohon jelaskan jenis masalah yang ingin dilaporkan (contoh: jalan rusak, lampu mati, sampah, dll).';
    }
    if (!alamat) {
      const kategoriLabel = kategori.replace(/_/g, ' ');
      return `Baik, saya akan catat laporan ${kategoriLabel} Anda. Boleh sebutkan alamat lengkapnya?`;
    }
    
    return llmResponse.reply_text;
  }
  
  // Check if alamat is too vague - ask for confirmation
  if (isVagueAddress(alamat)) {
    logger.info('Address is vague, asking for confirmation', { userId, alamat, kategori });
    
    pendingAddressConfirmation.set(userId, {
      alamat,
      kategori,
      deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
      timestamp: Date.now(),
      foto_url: mediaUrl,
    });
    
    const kategoriLabel = kategori.replace(/_/g, ' ');
    const photoNote = mediaUrl ? '\n\n📷 Foto Anda sudah kami terima.' : '';
    return `📍 Alamat "${alamat}" sepertinya kurang spesifik untuk laporan ${kategoriLabel}.${photoNote}\n\nApakah Anda ingin menambahkan detail alamat (nomor rumah, RT/RW, nama jalan lengkap) atau ketik "ya" untuk tetap menggunakan alamat ini?`;
  }
  
  // Check if this is an emergency complaint
  const isEmergency = detectEmergencyComplaint(deskripsi, currentMessage, kategori);
  
  // Create complaint in Case Service
  const complaintId = await createComplaint({
    wa_user_id: userId,
    kategori,
    deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
    alamat: alamat,
    rt_rw: rt_rw || '',
    foto_url: mediaUrl,
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
    recordDataCollected(userId, 'alamat', alamat);
    
    const withPhoto = mediaUrl ? ' 📷' : '';
    
    if (isEmergency) {
      logger.info('🚨 Emergency complaint detected', { userId, complaintId, kategori, deskripsi });
      return `🚨 PRIORITAS TINGGI\n\nTerima kasih laporannya Kak! Ini situasi darurat yang perlu penanganan segera.\n\nSaya sudah catat sebagai LAPORAN PRIORITAS dengan nomor ${complaintId}.${withPhoto}\n\nTim kami akan segera ke lokasi ${alamat}.\n\n⚠️ Untuk keamanan, mohon hindari area tersebut dulu ya Kak.`;
    } else {
      return `✅ Terima kasih! Laporan Anda telah kami terima dengan nomor ${complaintId}.${withPhoto}\n\nPetugas akan survey lokasi dalam 1-3 hari kerja di ${alamat}.`;
    }
  } else {
    aiAnalyticsService.recordFailure('CREATE_COMPLAINT');
    throw new Error('Failed to create complaint in Case Service');
  }
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
  const lowerMessage = message.toLowerCase();
  
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
      const fullMatch = message.match(new RegExp(`((?:depan|dekat|belakang|samping|sekitar)\\s+${match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'));
      const alamat = fullMatch ? fullMatch[1].trim() : match[1].trim();
      
      if (alamat.length >= 5) {
        logger.info('Smart alamat detection: landmark address extracted', { userId, detectedAlamat: alamat });
        return alamat;
      }
    }
  }
  
  // Pattern 2: "di [jalan/jln/jl] [nama jalan]"
  const streetPatterns = [
    /(?:di|lokasi|alamat|tempat)\s+((?:jalan|jln|jl\.?)\s+[^,]+(?:no\.?\s*\d+)?(?:\s+\w+)?)/i,
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
 * Handle reservation creation
 */
export async function handleReservationCreation(userId: string, llmResponse: any, conversationHistory?: Array<{role: string; content: string}>): Promise<string> {
  logger.info('[Reservation] Handler called', { userId, fields: llmResponse.fields, reply_text: llmResponse.reply_text?.substring(0, 100), hasConversationHistory: !!conversationHistory });
  
  const fields = llmResponse.fields || {};
  let { service_code, citizen_data, reservation_date, reservation_time, missing_info } = fields;
  service_code = service_code || fields.service_code;
  
  const VALID_SERVICE_CODES = ['SKD', 'SKU', 'SKTM', 'SKBM', 'IKR', 'SPKTP', 'SPKK', 'SPSKCK', 'SPAKTA', 'SKK', 'SPP'];
  
  let cleanServiceCode = '';
  let isValidServiceCode = false;
  
  if (Array.isArray(service_code)) {
    const validService = service_code.find(code => 
      typeof code === 'string' && VALID_SERVICE_CODES.includes(code.trim().toUpperCase())
    );
    if (validService) {
      cleanServiceCode = validService.trim().toUpperCase();
      isValidServiceCode = true;
    }
  } else if (typeof service_code === 'string') {
    cleanServiceCode = service_code.trim().toUpperCase();
    isValidServiceCode = VALID_SERVICE_CODES.includes(cleanServiceCode);
  }
  
  // Smart extraction from reply_text
  const replyText = llmResponse.reply_text || '';
  
  if (!reservation_date && replyText) {
    reservation_date = extractDateFromText(replyText);
  }
  
  if (!reservation_time && replyText) {
    reservation_time = extractTimeFromText(replyText);
  }
  
  const hasCitizenData = citizen_data && Object.keys(citizen_data).length > 0;
  let hasRequiredCitizenData = hasCitizenData && citizen_data.nama_lengkap && citizen_data.nik;
  
  // Always try to extract from history to fill missing data
  citizen_data = citizen_data || {};
  
  const namaMatch = replyText.match(/Nama:\s*([^\n•]+)/i);
  if (namaMatch && !citizen_data.nama_lengkap) {
    citizen_data.nama_lengkap = namaMatch[1].trim();
  }
  
  // First try to extract from conversationHistory (for webchat)
  if (conversationHistory && conversationHistory.length > 0) {
    const userMessages = conversationHistory
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ');
    
    logger.info('[Reservation] Extracting from conversationHistory', { userId, userMessagesLength: userMessages.length });
    
    // Extract NIK
    if (!citizen_data.nik) {
      const nikMatch = userMessages.match(/\b(\d{16})\b/);
      if (nikMatch) citizen_data.nik = nikMatch[1];
    }
    
    // Extract phone
    if (!citizen_data.no_hp) {
      const phoneMatch = userMessages.match(/\b(08\d{8,12})\b/);
      if (phoneMatch) citizen_data.no_hp = phoneMatch[1];
    }
    
    // Extract name - look for standalone name messages
    if (!citizen_data.nama_lengkap) {
      const namePatterns = [
        /nama\s+(?:saya|aku)\s+(?:adalah\s+)?([A-Za-z]+(?:\s+[A-Za-z]+){0,3})/i,
        /(?:saya|aku)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,3})(?:\s+(?:mau|ingin|nik|alamat)|\s*$)/i,
      ];
      for (const pattern of namePatterns) {
        const match = userMessages.match(pattern);
        if (match && match[1] && match[1].length >= 2) {
          citizen_data.nama_lengkap = match[1].trim();
          break;
        }
      }
      
      // Also check individual messages for standalone names
      if (!citizen_data.nama_lengkap) {
        const excludeWords = ['ya', 'iya', 'ok', 'oke', 'tidak', 'bukan', 'mau', 'ingin', 'sudah', 'belum', 'sip', 'siap', 'baik', 'terima', 'kasih', 'halo', 'hai', 'hi'];
        for (const msg of conversationHistory.filter(m => m.role === 'user')) {
          const content = msg.content.trim();
          if (/^[A-Za-z]+(?:\s+[A-Za-z]+){0,3}$/.test(content) && content.length >= 2 && content.length <= 50) {
            if (!excludeWords.includes(content.toLowerCase())) {
              citizen_data.nama_lengkap = content;
              break;
            }
          }
        }
      }
    }
    
    // Extract address
    if (!citizen_data.alamat) {
      const addressMatch = userMessages.match(/(?:alamat|tinggal|domisili)\s+(?:di\s+)?(.+?)(?:\s*,?\s*(?:untuk|mau|nik|hp)|\s*$)/i);
      if (addressMatch && addressMatch[1] && addressMatch[1].length >= 5) {
        citizen_data.alamat = addressMatch[1].trim();
      }
    }
    
    logger.info('[Reservation] Extracted from conversationHistory', { userId, citizen_data });
  }
  
  // Then try to extract from channel-service history (for WhatsApp)
  try {
    const historyData = await extractCitizenDataFromHistory(userId);
    logger.info('[Reservation] Extracted citizen data from channel-service', { userId, historyData });
    
    if (historyData) {
      if (!citizen_data.nama_lengkap && historyData.nama_lengkap) citizen_data.nama_lengkap = historyData.nama_lengkap;
      if (!citizen_data.nik && historyData.nik) citizen_data.nik = historyData.nik;
      if (!citizen_data.alamat && historyData.alamat) citizen_data.alamat = historyData.alamat;
      if (!citizen_data.no_hp && historyData.no_hp) citizen_data.no_hp = historyData.no_hp;
      if (!citizen_data.keperluan && historyData.keperluan) citizen_data.keperluan = historyData.keperluan;
    }
  } catch (err: any) {
    logger.warn('Failed to extract citizen data from channel-service', { userId, error: err.message });
  }
  
  hasRequiredCitizenData = citizen_data.nama_lengkap && citizen_data.nik;
  
  logger.info('[Reservation] Data check', { 
    userId, 
    isValidServiceCode, 
    hasRequiredCitizenData,
    citizen_data,
    reservation_date,
    reservation_time,
    missing_info
  });
  
  // Check if we have enough info
  if (!isValidServiceCode || !hasRequiredCitizenData || !reservation_date || !reservation_time || (missing_info && missing_info.length > 0)) {
    logger.info('[Reservation] Missing required data, returning LLM reply', { 
      userId,
      missingServiceCode: !isValidServiceCode,
      missingCitizenData: !hasRequiredCitizenData,
      missingDate: !reservation_date,
      missingTime: !reservation_time,
      hasMissingInfo: missing_info && missing_info.length > 0
    });
    return llmResponse.reply_text;
  }
  
  try {
    const cleanedCitizenData = {
      nama_lengkap: citizen_data.nama_lengkap?.trim() || '',
      nik: citizen_data.nik?.trim() || '',
      alamat: citizen_data.alamat?.trim() || '',
      no_hp: citizen_data.no_hp?.trim() || '',
      keperluan: citizen_data.keperluan?.trim() || '',
    };
    
    const response = await caseServiceClient.post('/reservasi/create', {
      wa_user_id: userId,
      service_code: cleanServiceCode,
      citizen_data: cleanedCitizenData,
      reservation_date,
      reservation_time,
    });
    
    const reservation = response.data?.data;
    
    if (reservation?.reservation_id) {
      aiAnalyticsService.recordSuccess('CREATE_RESERVATION');
      
      const dateStr = new Date(reservation_date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const serviceName = reservation.service?.name || cleanServiceCode;
      
      let successMessage = `✅ Reservasi berhasil dibuat!\n\n📋 *Detail Reservasi:*\n• Nomor: ${reservation.reservation_id}\n• Layanan: ${serviceName}\n• Tanggal: ${dateStr}\n• Jam: ${reservation_time} WIB\n• Antrian: #${reservation.queue_number}\n\n`;
      
      if (['SKD', 'SKTM', 'SKU'].includes(cleanServiceCode)) {
        successMessage += `📄 *Jangan lupa bawa:*\n• KTP asli + fotokopi\n• Kartu Keluarga (KK)\n• Surat Pengantar RT/RW\n\n`;
      }
      
      successMessage += `Sampai jumpa di kelurahan! 👋\n\n💡 Simpan nomor reservasi ini ya Kak`;
      
      return successMessage;
    } else {
      throw new Error('No reservation ID returned');
    }
  } catch (error: any) {
    aiAnalyticsService.recordFailure('CREATE_RESERVATION');
    logger.error('Failed to create reservation', { userId, error: error.message });
    
    if (error.response?.status === 400) {
      return `Mohon maaf Kak, ada kesalahan dalam data yang diberikan 🙏\n\nSilakan periksa kembali:\n• NIK (16 digit)\n• Tanggal (hari kerja)\n• Jam (08:00-15:00)\n\nMau coba lagi?`;
    }
    
    return 'Mohon maaf Kak, terjadi kendala teknis saat membuat reservasi 🙏\n\nSilakan coba lagi dalam beberapa saat.';
  }
}

/**
 * Handle reservation cancellation
 */
export async function handleReservationCancellation(userId: string, llmResponse: any): Promise<string> {
  const { reservation_id, cancel_reason } = llmResponse.fields;
  
  if (!reservation_id) {
    return llmResponse.reply_text || 'Mohon berikan nomor reservasi yang ingin dibatalkan (contoh: RSV-20251208-001)';
  }
  
  try {
    const response = await caseServiceClient.post(`/reservasi/${reservation_id}/cancel`, {
      wa_user_id: userId,
      cancel_reason: cancel_reason || 'Dibatalkan oleh pemohon',
    });
    
    if (response.data?.success) {
      return `✅ Reservasi ${reservation_id} berhasil dibatalkan.`;
    } else {
      return response.data?.message || 'Gagal membatalkan reservasi.';
    }
  } catch (error: any) {
    logger.error('Failed to cancel reservation', { error: error.message });
    return 'Mohon maaf, terjadi kesalahan saat membatalkan reservasi. Pastikan nomor reservasi benar.';
  }
}

/**
 * Handle status check for complaints and reservations
 */
export async function handleStatusCheck(userId: string, llmResponse: any): Promise<string> {
  const { complaint_id, reservation_id } = llmResponse.fields;
  
  if (!complaint_id && !reservation_id) {
    if (llmResponse.reply_text) return llmResponse.reply_text;
    return 'Halo Kak! Untuk cek status, boleh sebutkan nomornya ya (contoh: LAP-20251201-001 atau RSV-20251201-001) 📋';
  }
  
  if (complaint_id) {
    const complaint = await getComplaintStatus(complaint_id);
    
    if (!complaint) {
      return `Hmm, kami tidak menemukan laporan dengan nomor *${complaint_id}* nih Kak 🤔\n\nCoba cek lagi ya, format nomor laporan biasanya seperti ini: LAP-20251201-001`;
    }
    
    return buildNaturalStatusResponse(complaint);
  }
  
  if (reservation_id) {
    try {
      const response = await caseServiceClient.get(`/reservasi/${reservation_id}`);
      const reservation = response.data?.data;
      
      if (!reservation) {
        return `Hmm, kami tidak menemukan reservasi dengan nomor *${reservation_id}* nih Kak 🤔`;
      }
      
      return buildNaturalReservationStatusResponse(reservation);
    } catch (error) {
      return `Hmm, kami tidak menemukan reservasi dengan nomor *${reservation_id}* nih Kak 🤔`;
    }
  }
  
  return 'Maaf Kak, ada kendala saat mengecek status. Coba lagi ya! 🙏';
}

/**
 * Handle cancellation of complaints
 */
export async function handleCancellation(userId: string, llmResponse: any): Promise<string> {
  const { complaint_id, cancel_reason } = llmResponse.fields;
  
  if (!complaint_id) {
    if (llmResponse.reply_text) return llmResponse.reply_text;
    return 'Halo Kak! Untuk membatalkan laporan, mohon sertakan nomornya ya (contoh: LAP-20251201-001) 📋';
  }
  
  const result = await cancelComplaint(complaint_id, userId, cancel_reason);
  
  if (!result.success) {
    return buildCancelErrorResponse('laporan', complaint_id, result.error, result.message);
  }
  
  return buildCancelSuccessResponse('laporan', complaint_id, result.message);
}

/**
 * Handle user history request
 */
export async function handleHistory(userId: string): Promise<string> {
  logger.info('Handling history request', { userId });
  
  const history = await getUserHistory(userId);
  
  if (!history || history.total === 0) {
    return `📋 *Riwayat Anda*\n\nBelum ada laporan atau tiket.\nKetik pesan untuk memulai.`;
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
    const knowledgeResult = await searchKnowledge(message, categories);
    
    if (knowledgeResult.total === 0) {
      return 'Maaf, saya belum memiliki informasi tentang hal tersebut. Untuk informasi lebih lanjut, silakan hubungi kantor kelurahan langsung atau datang pada jam kerja.';
    }
    
    const { systemPrompt } = await buildKnowledgeQueryContext(userId, message, knowledgeResult.context);
    const knowledgeResult2 = await callGemini(systemPrompt);
    
    if (!knowledgeResult2) {
      return 'Maaf, terjadi kendala teknis. Silakan coba lagi dalam beberapa saat.';
    }
    
    return knowledgeResult2.response.reply_text;
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
 * Extract citizen data from conversation history
 */
async function extractCitizenDataFromHistory(userId: string): Promise<{
  nama_lengkap?: string;
  nik?: string;
  alamat?: string;
  no_hp?: string;
  keperluan?: string;
} | null> {
  try {
    const axios = (await import('axios')).default;
    const { config } = await import('../config/env');
    
    const url = `${config.channelServiceUrl}/internal/messages`;
    const response = await axios.get(url, {
      params: { wa_user_id: userId, limit: 30 },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    });
    
    const messages = response.data?.data?.messages || response.data?.messages || [];
    const result: { nama_lengkap?: string; nik?: string; alamat?: string; no_hp?: string; keperluan?: string } = {};
    
    // Get individual user messages for better extraction
    const userMessagesList = messages
      .filter((m: any) => m.direction === 'IN')
      .map((m: any) => m.message_text?.trim())
      .filter((m: string) => m && m.length > 0);
    
    const userMessages = userMessagesList.join(' ');
    
    logger.debug('[ExtractHistory] User messages', { userId, messageCount: userMessagesList.length, userMessages: userMessages.substring(0, 200) });
    
    // Extract NIK (16 digit number)
    const nikMatch = userMessages.match(/(?:nik|NIK)[\s:]+(\d{16})/);
    if (nikMatch) {
      result.nik = nikMatch[1];
    } else {
      const standaloneNik = userMessages.match(/\b(\d{16})\b/);
      if (standaloneNik) result.nik = standaloneNik[1];
    }
    
    // Extract phone (Indonesian format)
    const phoneMatch = userMessages.match(/\b(08\d{8,12})\b/);
    if (phoneMatch) result.no_hp = phoneMatch[1];
    
    // Extract name - more flexible patterns
    const namePatterns = [
      /nama\s+(?:saya|aku|gw|gue|gua)\s+(?:adalah\s+)?([A-Za-z]+(?:\s+[A-Za-z]+){0,3})/i,
      /(?:saya|aku|gw|gue|gua)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,3})(?:\s+(?:mau|ingin|nik|alamat|tinggal)|\s*[,.]|\s*$)/i,
      /(?:panggil\s+(?:saya|aku)\s+)([A-Za-z]+(?:\s+[A-Za-z]+)?)/i,
    ];
    
    for (const pattern of namePatterns) {
      const match = userMessages.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        if (name.length >= 2 && name.length <= 50 && !/\d/.test(name)) {
          result.nama_lengkap = name;
          break;
        }
      }
    }
    
    // If no name found with patterns, check for standalone name after AI asks for name
    // Look for short messages that could be just a name (after AI asked "siapa nama lengkap")
    if (!result.nama_lengkap) {
      for (let i = 0; i < userMessagesList.length; i++) {
        const msg = userMessagesList[i];
        // Check if message is a potential name (1-4 words, all letters, 2-50 chars)
        if (msg && /^[A-Za-z]+(?:\s+[A-Za-z]+){0,3}$/.test(msg) && msg.length >= 2 && msg.length <= 50) {
          // Exclude common words that are not names
          const excludeWords = ['ya', 'iya', 'ok', 'oke', 'tidak', 'bukan', 'mau', 'ingin', 'sudah', 'belum', 'sip', 'siap', 'baik', 'terima', 'kasih'];
          if (!excludeWords.includes(msg.toLowerCase())) {
            result.nama_lengkap = msg;
            break;
          }
        }
      }
    }
    
    // Extract address - more flexible patterns
    const addressPatterns = [
      /(?:alamat|tinggal|domisili)\s+(?:di\s+)?(.+?)(?:\s*,?\s*(?:untuk|mau|nik|hp|nomor)|\s*$)/i,
      /(?:di|daerah)\s+([A-Za-z]+(?:\s+[A-Za-z]+){1,5})(?:\s+(?:mau|untuk|nik)|\s*$)/i,
    ];
    
    for (const pattern of addressPatterns) {
      const match = userMessages.match(pattern);
      if (match && match[1] && match[1].length >= 5) {
        result.alamat = match[1].trim().replace(/,\s*$/, '');
        break;
      }
    }
    
    logger.debug('[ExtractHistory] Extracted data', { userId, result });
    
    return Object.keys(result).length > 0 ? result : null;
  } catch (error: any) {
    logger.warn('Failed to extract citizen data from history', { userId, error: error.message });
    return null;
  }
}

/**
 * Build natural response for complaint status
 */
function buildNaturalStatusResponse(complaint: any): string {
  const updatedAt = new Date(complaint.updated_at);
  const relativeTime = formatRelativeTime(updatedAt);
  const kategoriText = formatKategori(complaint.kategori);
  const statusInfo = getStatusInfo(complaint.status);
  
  let message = `Halo Kak! 👋\n\n`;
  message += `Berikut info laporan *${complaint.complaint_id}*:\n\n`;
  message += `📌 *Jenis Laporan:* ${kategoriText}\n`;
  if (complaint.alamat) message += `📍 *Lokasi:* ${complaint.alamat}\n`;
  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;
  message += `\n${statusInfo.description}`;
  if (complaint.admin_notes) message += `\n\n💬 _Catatan petugas: "${complaint.admin_notes}"_`;
  message += `\n\n🕐 _Terakhir diupdate ${relativeTime}_`;
  
  return message;
}

/**
 * Build natural response for reservation status
 */
function buildNaturalReservationStatusResponse(reservation: any): string {
  const reservationDate = new Date(reservation.reservation_date);
  const dateStr = reservationDate.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const statusMap: Record<string, { emoji: string; text: string }> = {
    'pending': { emoji: '⏳', text: 'Menunggu Konfirmasi' },
    'confirmed': { emoji: '✅', text: 'Dikonfirmasi' },
    'arrived': { emoji: '🏢', text: 'Sudah Hadir' },
    'completed': { emoji: '✅', text: 'Selesai' },
    'cancelled': { emoji: '❌', text: 'Dibatalkan' },
  };
  
  const statusInfo = statusMap[reservation.status] || { emoji: '📋', text: reservation.status };
  
  let message = `Halo Kak! 👋\n\n`;
  message += `Berikut info reservasi *${reservation.reservation_id}*:\n\n`;
  message += `📌 *Layanan:* ${reservation.service?.name || 'Layanan'}\n`;
  message += `📅 *Tanggal:* ${dateStr}\n`;
  message += `🕐 *Jam:* ${reservation.reservation_time} WIB\n`;
  message += `🎫 *Nomor Antrian:* #${reservation.queue_number}\n`;
  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;
  
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
    'baru': { emoji: '🆕', text: 'Baru Diterima', description: 'Laporan Kakak baru kami terima dan akan segera kami tindak lanjuti ya!' },
    'pending': { emoji: '⏳', text: 'Menunggu Verifikasi', description: 'Saat ini sedang dalam tahap verifikasi oleh tim kami. Mohon ditunggu ya!' },
    'proses': { emoji: '🔄', text: 'Sedang Diproses', description: 'Kabar baik! Petugas kami sudah menangani laporan ini.' },
    'selesai': { emoji: '✅', text: 'Selesai', description: 'Yeay! Laporan sudah selesai ditangani. Terima kasih sudah melapor! 🙏' },
    'ditolak': { emoji: '❌', text: 'Tidak Dapat Diproses', description: 'Mohon maaf, laporan ini tidak dapat kami proses.' },
  };
  return statusMap[status] || { emoji: '📋', text: status, description: 'Silakan tunggu update selanjutnya ya!' };
}

function buildCancelSuccessResponse(type: 'laporan' | 'reservasi', id: string, reason: string): string {
  return `Halo Kak! 👋\n\n✅ ${type === 'laporan' ? 'Laporan' : 'Reservasi'} *${id}* sudah berhasil dibatalkan ya.\n\n📝 *Alasan:* ${reason}\n\nKalau ada yang mau dilaporkan atau direservasi lagi, langsung chat aja ya Kak! 😊`;
}

function buildCancelErrorResponse(type: 'laporan' | 'reservasi', id: string, error?: string, message?: string): string {
  switch (error) {
    case 'NOT_FOUND':
      return `Hmm, kami tidak menemukan ${type} dengan nomor *${id}* nih Kak 🤔`;
    case 'NOT_OWNER':
      return `Maaf Kak, ${type} *${id}* ini bukan milik Kakak, jadi tidak bisa dibatalkan ya 🙏`;
    case 'ALREADY_COMPLETED':
      return `Maaf Kak, ${type} *${id}* sudah tidak bisa dibatalkan karena statusnya sudah final 📋`;
    default:
      return `Maaf Kak, ada kendala saat membatalkan ${type}. ${message || 'Coba lagi ya!'} 🙏`;
  }
}

function buildHistoryResponse(items: HistoryItem[], total: number): string {
  let message = `📋 *Riwayat Anda* (${total})\n`;
  
  const complaints = items.filter(i => i.type === 'complaint');
  const reservations = items.filter(i => i.type === 'reservation');
  
  if (complaints.length > 0) {
    message += `\n*LAPORAN*\n`;
    for (const item of complaints.slice(0, 5)) {
      const statusEmoji = getStatusEmoji(item.status);
      message += `• *${item.display_id}* ${statusEmoji}\n  ${item.description.substring(0, 20)}...\n`;
    }
  }
  
  if (reservations.length > 0) {
    message += `\n*RESERVASI*\n`;
    for (const item of reservations.slice(0, 5)) {
      const statusEmoji = getStatusEmoji(item.status);
      message += `• *${item.display_id}* ${statusEmoji}\n  ${item.description.substring(0, 20)}...\n`;
    }
  }
  
  message += `\n💡 Ketik nomor untuk cek detail`;
  return message;
}

function getStatusEmoji(status: string): string {
  const emojiMap: Record<string, string> = {
    'baru': '🆕', 'pending': '⏳', 'proses': '🔄', 'selesai': '✅', 'ditolak': '❌', 'dibatalkan': '🔴',
  };
  return emojiMap[status] || '📌';
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
  timestamp: number;
  foto_url?: string;
}) {
  pendingAddressConfirmation.set(userId, data);
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
  const { userId, message, channel, conversationHistory, mediaUrl } = input;
  
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
    
    // Step 2: Check pending address confirmation
    const pendingConfirm = pendingAddressConfirmation.get(userId);
    if (pendingConfirm) {
      const confirmResult = await handlePendingAddressConfirmation(userId, message, pendingConfirm, mediaUrl);
      if (confirmResult) {
        return {
          success: true,
          response: confirmResult,
          intent: 'CREATE_COMPLAINT',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }
    }
    
    // Step 2.5: AI Optimization - Pre-process message
    const historyString = conversationHistory?.map(m => `${m.role}: ${m.content}`).join('\n') || '';
    const optimization = preProcessMessage(message, userId, historyString);
    
    // Step 2.6: Check if we can use fast path (skip LLM)
    if (shouldUseFastPath(optimization, !!pendingConfirm)) {
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
    for (const [typo, correct] of Object.entries(TYPO_CORRECTIONS)) {
      const regex = new RegExp(`\\b${typo}\\b`, 'gi');
      sanitizedMessage = sanitizedMessage.replace(regex, correct);
    }
    
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
    const isGreeting = /^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam)|assalamualaikum|permisi)/i.test(sanitizedMessage.trim());
    const looksLikeQuestion = shouldRetrieveContext(sanitizedMessage);
    
    if (isGreeting) {
      try {
        const kelurahanInfo = await getKelurahanInfoContext();
        if (kelurahanInfo) preloadedRAGContext = kelurahanInfo;
      } catch (error: any) {
        logger.warn('[UnifiedProcessor] Failed to fetch kelurahan info', { error: error.message });
      }
    } else if (looksLikeQuestion) {
      try {
        const ragContext = await getRAGContext(sanitizedMessage);
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
    
    if (channel === 'webchat' && conversationHistory) {
      const contextResult = await buildContextWithHistory(userId, sanitizedMessage, conversationHistory, preloadedRAGContext);
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
    
    // Track analytics
    aiAnalyticsService.recordIntent(
      userId,
      llmResponse.intent,
      metrics.durationMs,
      systemPrompt.length,
      llmResponse.reply_text.length,
      metrics.model
    );
    
    logger.info('[UnifiedProcessor] LLM response received', {
      userId,
      channel,
      intent: llmResponse.intent,
      durationMs: metrics.durationMs,
    });
    
    // Update status: preparing response
    tracker.preparing();
    
    // Step 9: Handle intent
    let finalReplyText = llmResponse.reply_text;
    let guidanceText = llmResponse.guidance_text || '';
    
    switch (llmResponse.intent) {
      case 'CREATE_COMPLAINT':
        const rateLimitCheck = rateLimiterService.checkRateLimit(userId);
        if (!rateLimitCheck.allowed) {
          finalReplyText = rateLimitCheck.message || 'Anda telah mencapai batas laporan hari ini.';
        } else {
          finalReplyText = await handleComplaintCreation(userId, llmResponse, message, mediaUrl);
        }
        break;
      
      case 'CREATE_RESERVATION':
        finalReplyText = await handleReservationCreation(userId, llmResponse, conversationHistory);
        break;
      
      case 'CANCEL_RESERVATION':
        finalReplyText = await handleReservationCancellation(userId, llmResponse);
        break;
      
      case 'CHECK_STATUS':
        finalReplyText = await handleStatusCheck(userId, llmResponse);
        break;
      
      case 'CANCEL_COMPLAINT':
        finalReplyText = await handleCancellation(userId, llmResponse);
        break;
      
      case 'HISTORY':
        finalReplyText = await handleHistory(userId);
        break;
      
      case 'KNOWLEDGE_QUERY':
        if (preloadedRAGContext && typeof preloadedRAGContext === 'object' && 
            preloadedRAGContext.contextString && llmResponse.reply_text?.length > 20) {
          logger.info('[UnifiedProcessor] Using pre-loaded knowledge response');
        } else {
          finalReplyText = await handleKnowledgeQuery(userId, message, llmResponse);
        }
        break;
      
      case 'QUESTION':
      case 'UNKNOWN':
      default:
        // GREETING and other intents - use LLM reply as-is
        break;
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
      currentIntent: llmResponse.intent,
      intentConfidence: optimization?.fastIntent?.confidence || 0.8,
      collectedData: llmResponse.fields,
      missingFields: llmResponse.fields?.missing_info || [],
    });
    
    // Step 10.7: Post-process - Cache response for future use (only for cacheable intents)
    if (['KNOWLEDGE_QUERY', 'GREETING', 'QUESTION'].includes(llmResponse.intent)) {
      postProcessResponse(message, finalResponse, llmResponse.intent, finalGuidance);
    }
    
    const processingTimeMs = Date.now() - startTime;
    
    // Update status: complete
    tracker.complete();
    
    logger.info('✅ [UnifiedProcessor] Message processed', {
      userId,
      channel,
      intent: llmResponse.intent,
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
  pendingConfirm: { alamat: string; kategori: string; deskripsi: string; timestamp: number; foto_url?: string },
  mediaUrl?: string
): Promise<string | null> {
  // Check if user confirmed
  if (isConfirmationResponse(message)) {
    logger.info('User confirmed vague address, creating complaint', { userId, alamat: pendingConfirm.alamat });
    
    pendingAddressConfirmation.delete(userId);
    
    const complaintId = await createComplaint({
      wa_user_id: userId,
      kategori: pendingConfirm.kategori,
      deskripsi: pendingConfirm.deskripsi,
      alamat: pendingConfirm.alamat,
      rt_rw: '',
      foto_url: pendingConfirm.foto_url,
    });
    
    if (!complaintId) {
      throw new Error('Failed to create complaint after address confirmation');
    }
    
    const withPhoto = pendingConfirm.foto_url ? ' 📷' : '';
    return `✅ Terima kasih! Laporan Anda telah kami terima dengan nomor ${complaintId}.${withPhoto}\n\nPetugas akan segera menindaklanjuti laporan Anda.`;
  }
  
  // Check if user provides more specific address
  const looksLikeAddress = [
    /jalan/i, /jln/i, /jl\./i, /\bno\b/i, /nomor/i, /\brt\b/i, /\brw\b/i, /gang/i, /gg\./i, /komplek/i, /perumahan/i, /blok/i,
  ].some(pattern => pattern.test(message));
  
  if (looksLikeAddress && !isVagueAddress(message)) {
    logger.info('User provided more specific address', { userId, newAlamat: message });
    
    pendingAddressConfirmation.delete(userId);
    
    const complaintId = await createComplaint({
      wa_user_id: userId,
      kategori: pendingConfirm.kategori,
      deskripsi: pendingConfirm.deskripsi,
      alamat: message.trim(),
      rt_rw: '',
      foto_url: pendingConfirm.foto_url,
    });
    
    if (!complaintId) {
      throw new Error('Failed to create complaint with updated address');
    }
    
    const withPhoto = pendingConfirm.foto_url ? ' 📷' : '';
    return `✅ Terima kasih! Laporan Anda telah kami terima dengan nomor ${complaintId}.${withPhoto}\n\nPetugas akan segera menindaklanjuti laporan di ${message.trim()}.`;
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
  const { getFullSystemPrompt } = await import('../prompts/system-prompt');
  
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
  
  const systemPrompt = getFullSystemPrompt()
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
  
  if (lowerMessage.includes('surat') || lowerMessage.includes('dokumen') || lowerMessage.includes('keterangan') || lowerMessage.includes('reservasi')) {
    return getFallbackByIntent('CREATE_RESERVATION');
  }
  
  if (lowerMessage.includes('lapor') || lowerMessage.includes('keluhan') || lowerMessage.includes('aduan') || lowerMessage.includes('rusak') || lowerMessage.includes('mati')) {
    return getFallbackByIntent('CREATE_COMPLAINT');
  }
  
  if (lowerMessage.includes('status') || lowerMessage.includes('cek') || /LAP-|RSV-/i.test(lowerMessage)) {
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
  handleReservationCreation,
  handleReservationCancellation,
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
