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
import { learnFromMessage, recordInteraction, saveDefaultAddress, getProfileContext, recordServiceUsage } from './user-profile.service';
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
  
  // Remove any profanity
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

function normalizeLookupKey(value: string): string {
  return normalizeText(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
      const kategoriLabel = kategori.replace(/_/g, ' ');
      return `Baik, saya akan catat laporan ${kategoriLabel} Anda. Boleh sebutkan alamat lengkapnya?`;
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
    const photoNote = mediaUrl ? '\n\n📷 Foto Anda sudah kami terima.' : '';
    return `📍 Alamat "${alamat}" sepertinya kurang spesifik untuk laporan ${kategoriLabel}.${photoNote}\n\nApakah Anda ingin menambahkan detail alamat (nomor rumah, RT/RW, nama jalan lengkap) atau ketik "ya" untuk tetap menggunakan alamat ini?`;
  }
  
  // Check if this is an emergency complaint
  // PRIORITY RULE:
  // - Jika ada konfigurasi jenis pengaduan, gunakan itu sebagai sumber utama.
  // - Heuristic hanya dipakai sebagai fallback saat tidak ada konfigurasi.
  const isEmergency = typeof complaintTypeConfig?.is_urgent === 'boolean'
    ? complaintTypeConfig.is_urgent
    : detectEmergencyComplaint(deskripsi || '', currentMessage, kategori);
  
  // Create complaint in Case Service
  const complaintId = await createComplaint({
    wa_user_id: userId,
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
    
    const withPhoto = mediaUrl ? ' 📷' : '';
    
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
      logger.info('🚨 Emergency complaint detected', { userId, complaintId, kategori, deskripsi });
      return `🚨 PRIORITAS TINGGI\n\nTerima kasih laporannya Kak! Ini situasi darurat yang perlu penanganan segera.\n\nSaya sudah catat sebagai LAPORAN PRIORITAS dengan nomor ${complaintId}.${withPhoto}\n\nTim kami akan segera ke lokasi ${alamat || 'yang Anda laporkan'}.\n\n⚠️ Untuk keamanan, mohon hindari area tersebut dulu ya Kak.${importantContactsMessage}`;
    }
    
    return `✅ Terima kasih! Laporan Anda telah kami terima dengan nomor ${complaintId}.${withPhoto}\n\nPetugas akan survey lokasi dalam 1-3 hari kerja${alamat ? ` di ${alamat}` : ''}.${importantContactsMessage}`;
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

function isValidCitizenWaNumber(value: string): boolean {
  return /^628\d{8,12}$/.test(value);
}

function buildPublicServiceFormUrl(baseUrl: string, villageSlug: string, serviceSlug: string, userId: string): string {
  const url = `${baseUrl}/form/${villageSlug}/${serviceSlug}`;
  const waUser = normalizeTo628(userId);
  if (!isValidCitizenWaNumber(waUser)) return url;
  return `${url}?user=${encodeURIComponent(waUser)}`;
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

export async function handleServiceInfo(userId: string, llmResponse: any): Promise<string> {
  const { service_slug, service_id } = llmResponse.fields || {};
  
  if (!service_slug && !service_id) {
    return llmResponse.reply_text || 'Baik Kak, layanan apa yang ingin ditanyakan?';
  }
  
  try {
    const { config } = await import('../config/env');
    const axios = (await import('axios')).default;
    
    // Query service details from case-service
    const villageId = llmResponse.fields?.village_id || process.env.DEFAULT_VILLAGE_ID || '';
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
      return llmResponse.reply_text || 'Maaf Kak, layanan tersebut tidak ditemukan. Silakan tanyakan layanan lain.';
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
    const baseUrl = (process.env.PUBLIC_FORM_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://govconnect.my.id').replace(/\/$/, '');
    const villageSlug = await resolveVillageSlugForPublicForm(villageId);
    
    let replyText = `📋 *${service.name}*\n\n`;
    
    if (service.description) {
      replyText += `${service.description}\n\n`;
    }
    
    if (requirementsList) {
      replyText += `*Persyaratan:*\n${requirementsList}\n\n`;
    }
    
    if (isOnline) {
      // Offer first, then send the form link only when the user confirms.
      setPendingServiceFormOffer(userId, {
        service_slug: service.slug,
        village_id: villageId,
        timestamp: Date.now(),
      });

      replyText += `💡 Layanan ini bisa diproses secara *online*.\n\nMau sekalian saya bantu buat pengajuan sekarang?\nBalas *iya* untuk saya kirim link formulir (atau balas *tidak* jika belum).`;
    } else {
      replyText += `📍 Layanan ini harus diproses secara *offline* di kantor kelurahan.\n\nSilakan datang ke kantor dengan membawa persyaratan di atas ya Kak.`;
    }
    
    return replyText;
  } catch (error: any) {
    logger.error('Failed to fetch service info', { error: error.message, service_slug, service_id });
    return llmResponse.reply_text || 'Baik Kak, saya cek dulu info layanan tersebut ya.';
  }
}

/**
 * Handle service request creation (send public form link)
 */
export async function handleServiceRequestCreation(userId: string, llmResponse: any): Promise<string> {
  const { service_slug } = llmResponse.fields || {};
  
  if (!service_slug) {
    return llmResponse.reply_text || 'Mohon sebutkan nama layanan yang ingin diajukan ya Kak.';
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
      return `Maaf Kak, layanan tersebut tidak ditemukan di database. Silakan tanyakan layanan lain ya.`;
    }

    const isOnline = service.mode === 'online' || service.mode === 'both';
    if (!isOnline) {
      return `📍 *${service.name}* saat ini hanya bisa diproses secara *offline* di kantor kelurahan/desa.\n\nSilakan datang ke kantor dengan membawa persyaratan yang diperlukan ya Kak.`;
    }

    const baseUrl = (process.env.PUBLIC_FORM_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://govconnect.my.id').replace(/\/$/, '');
    const villageSlug = await resolveVillageSlugForPublicForm(villageId);
    const formUrl = buildPublicServiceFormUrl(baseUrl, villageSlug, service.slug || service_slug, userId);

    return `Baik Kak, ini link formulir layanan:\n${formUrl}\n\nSilakan isi data di formulir tersebut. Setelah submit, Kakak akan menerima nomor layanan untuk cek status.`;
  } catch (error: any) {
    logger.error('Failed to validate service before sending form link', { error: error.message, service_slug, villageId });
    return llmResponse.reply_text || 'Maaf Kak, saya belum bisa menyiapkan link formulirnya sekarang. Coba lagi sebentar ya.';
  }
}

/**
 * Handle service request edit (send edit link with token)
 */
export async function handleServiceRequestEditLink(userId: string, llmResponse: any): Promise<string> {
  const { request_number } = llmResponse.fields || {};

  if (!request_number) {
    return llmResponse.reply_text || 'Mohon sebutkan nomor layanan yang ingin diubah ya Kak (contoh: LAY-20251201-001).';
  }

  const tokenResult = await requestServiceRequestEditToken(request_number, userId);

  if (!tokenResult.success) {
    if (tokenResult.error === 'NOT_FOUND') {
      return `Permohonan layanan *${request_number}* tidak ditemukan. Mohon cek nomor layanan ya Kak.`;
    }
    if (tokenResult.error === 'NOT_OWNER') {
      return `Maaf Kak, permohonan *${request_number}* bukan milik Kakak, jadi tidak bisa diubah 🙏`;
    }
    if (tokenResult.error === 'LOCKED') {
      return `Permohonan *${request_number}* sudah selesai/ditolak/dibatalkan sehingga tidak bisa diubah.`;
    }
    return tokenResult.message || 'Maaf Kak, ada kendala saat menyiapkan link edit.';
  }

  const baseUrl = (process.env.PUBLIC_FORM_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://govconnect.my.id').replace(/\/$/, '');
  const editUrl = `${baseUrl}/form/edit/${encodeURIComponent(request_number)}?token=${encodeURIComponent(tokenResult.edit_token || '')}`;

  return `Baik Kak, ini link untuk mengubah data permohonan layanan:\n${editUrl}\n\nLink ini berlaku 24 jam dan hanya bisa dipakai sekali.`;
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
export async function handleStatusCheck(userId: string, llmResponse: any): Promise<string> {
  const { complaint_id, request_number } = llmResponse.fields;
  const detailMode = !!(llmResponse.fields?.detail_mode || llmResponse.fields?.detail);
  
  if (!complaint_id && !request_number) {
    if (llmResponse.reply_text) return llmResponse.reply_text;
    return 'Halo Kak! Untuk cek status, boleh sebutkan nomornya ya (contoh: LAP-20251201-001 atau LAY-20251201-001) 📋';
  }
  
  if (complaint_id) {
    // Use ownership validation - user can only check their own complaints
    const { getComplaintStatusWithOwnership } = await import('./case-client.service');
    const result = await getComplaintStatusWithOwnership(complaint_id, userId);
    
    if (!result.success) {
      if (result.error === 'NOT_FOUND') {
        return `Hmm, kami tidak menemukan laporan dengan nomor *${complaint_id}* nih Kak 🤔\n\nCoba cek lagi ya, format nomor laporan biasanya seperti ini: LAP-20251201-001`;
      }
      if (result.error === 'NOT_OWNER') {
        return `Maaf Kak, laporan *${complaint_id}* bukan milik Kakak ya 🙏\n\nSilakan cek kembali nomor laporan Anda. Jika lupa, ketik "riwayat" untuk melihat daftar laporan Anda.`;
      }
      return 'Maaf Kak, ada kendala saat mengecek status. Coba lagi ya! 🙏';
    }
    
    return detailMode ? buildComplaintDetailResponse(result.data) : buildNaturalStatusResponse(result.data);
  }
  
  if (request_number) {
    const result = await getServiceRequestStatusWithOwnership(request_number, userId);
    
    if (!result.success) {
      if (result.error === 'NOT_FOUND') {
        return `Hmm, kami tidak menemukan permohonan layanan dengan nomor *${request_number}* nih Kak 🤔\n\nCoba cek lagi ya, format nomor layanan biasanya seperti ini: LAY-20251201-001`;
      }
      if (result.error === 'NOT_OWNER') {
        return `Maaf Kak, permohonan layanan *${request_number}* bukan milik Kakak ya 🙏\n\nSilakan cek kembali nomor layanan Anda. Jika lupa, ketik "riwayat" untuk melihat daftar layanan Anda.`;
      }
      return 'Maaf Kak, ada kendala saat mengecek status layanan. Coba lagi ya! 🙏';
    }
    
    if (!detailMode) return buildNaturalServiceStatusResponse(result.data);

    let requirementDefs: ServiceRequirementDefinition[] = [];
    const serviceId: string | undefined = result.data?.service_id || result.data?.serviceId;
    if (serviceId) {
      requirementDefs = await getServiceRequirements(String(serviceId));
    }

    return buildServiceRequestDetailResponse(result.data, requirementDefs);
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
      ? 'Halo Kak! Untuk membatalkan laporan, mohon sertakan nomornya ya (contoh: LAP-20251201-001) 📋'
      : 'Halo Kak! Untuk membatalkan layanan, mohon sertakan nomornya ya (contoh: LAY-20251201-001) 📋';
  }

  setPendingCancelConfirmation(userId, {
    type,
    id: targetId,
    reason: cancel_reason,
    timestamp: Date.now(),
  });

  const label = type === 'laporan' ? 'laporan' : 'layanan';
  return `Sebelum saya batalkan, mohon konfirmasi dulu ya Kak.\n\nApakah Kakak yakin ingin membatalkan ${label} *${targetId}*?\nBalas "ya" untuk lanjut atau "tidak" untuk batal.`;
}

/**
 * Handle cancellation of service requests
 */
export async function handleServiceRequestCancellation(userId: string, llmResponse: any): Promise<string> {
  const { request_number, cancel_reason } = llmResponse.fields || {};

  if (!request_number) {
    return llmResponse.reply_text || 'Halo Kak! Untuk membatalkan layanan, mohon sertakan nomornya ya (contoh: LAY-20251201-001) 📋';
  }

  const result = await cancelServiceRequest(request_number, userId, cancel_reason);

  if (!result.success) {
    return buildCancelErrorResponse('layanan', request_number, result.error, result.message);
  }

  return buildCancelSuccessResponse('layanan', request_number, result.message);
}

/**
 * Handle complaint update by user
 */
export async function handleComplaintUpdate(userId: string, llmResponse: any): Promise<string> {
  const { complaint_id, alamat, deskripsi, rt_rw } = llmResponse.fields || {};

  if (!complaint_id) {
    return llmResponse.reply_text || 'Mohon sebutkan nomor laporan yang ingin diperbarui (contoh: LAP-20251201-001).';
  }

  if (!alamat && !deskripsi && !rt_rw) {
    return llmResponse.reply_text || 'Data apa yang ingin diperbarui? (alamat/deskripsi/RT RW)';
  }

  const result = await updateComplaintByUser(complaint_id, userId, { alamat, deskripsi, rt_rw });

  if (!result.success) {
    if (result.error === 'NOT_FOUND') {
      return `Hmm, laporan *${complaint_id}* tidak ditemukan. Coba cek kembali nomor laporan ya.`;
    }
    if (result.error === 'NOT_OWNER') {
      return `Maaf Kak, laporan *${complaint_id}* bukan milik Kakak, jadi tidak bisa diubah 🙏`;
    }
    if (result.error === 'LOCKED') {
      return `Laporan *${complaint_id}* sudah selesai/ditolak sehingga tidak bisa diubah.`;
    }
    return result.message || 'Maaf, terjadi kendala saat memperbarui laporan.';
  }

  return `✅ Laporan *${complaint_id}* berhasil diperbarui. Terima kasih sudah melengkapi informasi.`;
}

/**
 * Handle user history request
 */
export async function handleHistory(userId: string): Promise<string> {
  logger.info('Handling history request', { userId });
  
  const history = await getUserHistory(userId);
  
  if (!history || history.total === 0) {
    return `📋 *Riwayat Anda*\n\nBelum ada laporan atau layanan.\nKetik pesan untuk memulai.`;
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
      const parts: string[] = [`📍 *Alamat ${officeName}*`];
      if (profile?.address) {
        parts.push(profile.address);
      }
      if (profile?.gmaps_url) {
        parts.push(`Google Maps: ${profile.gmaps_url}`);
      }

      if (!profile?.address && !profile?.gmaps_url) {
        return `Maaf, data alamat/lokasi untuk *${officeName}* belum tersedia di database.`;
      }

      return parts.join('\n');
    }

    if (isAskingHours) {
      const hours: any = profile?.operating_hours;
      if (!hours || typeof hours !== 'object') {
        return `Maaf, data jam operasional untuk *${officeName}* belum tersedia di database.`;
      }

      const dayKeys = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'] as const;
      const requestedDay = dayKeys.find(d => new RegExp(`\\b${d}\\b`, 'i').test(normalizedQuery));

      const formatDay = (day: string, schedule: any): string => {
        const open = schedule?.open ?? null;
        const close = schedule?.close ?? null;
        if (!open || !close) return `- ${day.charAt(0).toUpperCase() + day.slice(1)}: Tutup`;
        return `- ${day.charAt(0).toUpperCase() + day.slice(1)}: ${open}–${close}`;
      };

      const lines: string[] = [`🕐 *Jam Operasional ${officeName}*`];
      if (requestedDay) {
        lines.push(formatDay(requestedDay, (hours as any)[requestedDay]));
      } else {
        for (const day of dayKeys) {
          lines.push(formatDay(day, (hours as any)[day]));
        }
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
        return `Maaf, data kontak penting untuk *${officeName}* belum tersedia di database.`;
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
      const lines: string[] = [`📞 *Kontak ${officeName}*`];
      for (const c of top) {
        const extra = c.description ? ` — ${c.description}` : '';
        lines.push(`- ${c.name}: ${c.phone}${extra}`);
      }
      return lines.join('\n');
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

    // Deterministic KB extraction for anchored terms (prevents the second LLM step from omitting key lines).
    const deterministicFromContext = contextString ? tryExtractDeterministicKbAnswer(normalizedQuery, contextString) : null;
    if (deterministicFromContext) {
      return deterministicFromContext;
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
 * Build natural response for service request status
 * Now includes result file and description from admin
 */
function buildNaturalServiceStatusResponse(serviceRequest: any): string {
  const statusMap: Record<string, { emoji: string; text: string }> = {
    'baru': { emoji: '🆕', text: 'Baru' },
    'proses': { emoji: '🔄', text: 'Diproses' },
    'selesai': { emoji: '✅', text: 'Selesai' },
    'ditolak': { emoji: '❌', text: 'Ditolak' },
    'dibatalkan': { emoji: '🔴', text: 'Dibatalkan' },
  };

  const statusInfo = statusMap[serviceRequest.status] || { emoji: '📋', text: serviceRequest.status };

  let message = `Halo Kak! 👋\n\n`;
  message += `Berikut info layanan *${serviceRequest.request_number}*:\n\n`;
  message += `📌 *Layanan:* ${serviceRequest.service?.name || 'Layanan Administrasi'}\n`;
  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;

  if (serviceRequest.admin_notes) {
    message += `\n💬 _Catatan petugas: "${serviceRequest.admin_notes}"_\n`;
  }

  // Add result description if available
  if (serviceRequest.result_description) {
    message += `\n📝 *Hasil:* ${serviceRequest.result_description}\n`;
  }

  // Add result file link if available
  if (serviceRequest.result_file_url) {
    const fileName = serviceRequest.result_file_name || 'Dokumen Hasil';
    message += `\n📎 *Dokumen:* ${fileName}\n`;
    message += `🔗 Link download: ${serviceRequest.result_file_url}\n`;
  }

  // Add guidance based on status
  if (serviceRequest.status === 'selesai' && serviceRequest.result_file_url) {
    message += `\n_Silakan download dokumen di atas ya Kak. Terima kasih sudah menggunakan layanan kami! 🙏_`;
  } else if (serviceRequest.status === 'selesai') {
    message += `\n_Layanan sudah selesai. Terima kasih! 🙏_`;
  } else if (serviceRequest.status === 'ditolak') {
    message += `\n_Jika ada pertanyaan, silakan hubungi kantor kelurahan ya Kak._`;
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

  let message = `📄 *Detail Laporan*\n\n`;
  message += `🆔 *Nomor:* ${complaint.complaint_id}\n`;
  message += `📌 *Jenis:* ${formatKategori(complaint.kategori)}\n`;
  if (complaint.alamat) message += `📍 *Lokasi:* ${complaint.alamat}\n`;
  if (complaint.rt_rw) message += `🏠 *RT/RW:* ${complaint.rt_rw}\n`;
  if (complaint.deskripsi) message += `\n📝 *Deskripsi:*\n${complaint.deskripsi}\n`;

  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;
  message += `${statusInfo.description}\n`;

  if (complaint.admin_notes) {
    message += `\n💬 *Catatan petugas:*\n${complaint.admin_notes}\n`;
  }

  message += `\n🗓️ *Dibuat:* ${formatDateTimeId(createdAt)}\n`;
  message += `🕐 *Update terakhir:* ${formatDateTimeId(updatedAt)}\n`;

  return message;
}

function buildServiceRequestDetailResponse(serviceRequest: any, requirementDefs: ServiceRequirementDefinition[] = []): string {
  const statusMap: Record<string, { emoji: string; text: string }> = {
    'baru': { emoji: '🆕', text: 'Baru' },
    'proses': { emoji: '🔄', text: 'Diproses' },
    'selesai': { emoji: '✅', text: 'Selesai' },
    'ditolak': { emoji: '❌', text: 'Ditolak' },
    'dibatalkan': { emoji: '🔴', text: 'Dibatalkan' },
  };
  const statusInfo = statusMap[serviceRequest.status] || { emoji: '📋', text: serviceRequest.status };
  const createdAt = toSafeDate(serviceRequest.created_at || serviceRequest.createdAt);
  const updatedAt = toSafeDate(serviceRequest.updated_at || serviceRequest.updatedAt);

  let message = `📄 *Detail Layanan*\n\n`;
  message += `🆔 *Nomor:* ${serviceRequest.request_number}\n`;
  message += `📌 *Layanan:* ${serviceRequest.service?.name || 'Layanan Administrasi'}\n`;
  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;

  if (serviceRequest.admin_notes) {
    message += `\n💬 *Catatan petugas:*\n${serviceRequest.admin_notes}\n`;
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
    'baru': { emoji: '🆕', text: 'Baru', description: 'Laporan Kakak baru kami terima dan akan segera kami tindak lanjuti ya!' },
    'pending': { emoji: '⏳', text: 'Menunggu Verifikasi', description: 'Saat ini sedang dalam tahap verifikasi oleh tim kami. Mohon ditunggu ya!' },
    'proses': { emoji: '🔄', text: 'Sedang Diproses', description: 'Kabar baik! Petugas kami sudah menangani laporan ini.' },
    'selesai': { emoji: '✅', text: 'Selesai', description: 'Yeay! Laporan sudah selesai ditangani. Terima kasih sudah melapor! 🙏' },
    'ditolak': { emoji: '❌', text: 'Tidak Dapat Diproses', description: 'Mohon maaf, laporan ini tidak dapat kami proses.' },
  };
  return statusMap[status] || { emoji: '📋', text: status, description: 'Silakan tunggu update selanjutnya ya!' };
}

function buildCancelSuccessResponse(type: 'laporan' | 'layanan', id: string, reason: string): string {
  const label = type === 'laporan' ? 'Laporan' : 'Layanan';
  return `Halo Kak! 👋\n\n✅ ${label} *${id}* sudah berhasil dibatalkan ya.\n\n📝 *Alasan:* ${reason}\n\nKalau ada yang mau dibuat lagi, langsung chat aja ya Kak! 😊`;
}

function buildCancelErrorResponse(type: 'laporan' | 'layanan', id: string, error?: string, message?: string): string {
  const label = type === 'laporan' ? 'laporan' : 'layanan';
  switch (error) {
    case 'NOT_FOUND':
      return `Hmm, kami tidak menemukan ${label} dengan nomor *${id}* nih Kak 🤔`;
    case 'NOT_OWNER':
      return `Maaf Kak, ${label} *${id}* ini bukan milik Kakak, jadi tidak bisa dibatalkan ya 🙏`;
    case 'ALREADY_COMPLETED':
    case 'LOCKED':
      return `Maaf Kak, ${label} *${id}* sudah tidak bisa dibatalkan karena statusnya sudah final 📋`;
    default:
      return `Maaf Kak, ada kendala saat membatalkan ${label}. ${message || 'Coba lagi ya!'} 🙏`;
  }
}

function buildHistoryResponse(items: HistoryItem[], total: number): string {
  let message = `📋 *Riwayat Anda* (${total})\n`;
  
  const complaints = items.filter(i => i.type === 'complaint');
  const services = items.filter(i => i.type === 'service');
  
  if (complaints.length > 0) {
    message += `\n*LAPORAN*\n`;
    for (const item of complaints.slice(0, 5)) {
      const statusEmoji = getStatusEmoji(item.status);
      message += `• *${item.display_id}* ${statusEmoji}\n  ${item.description.substring(0, 20)}...\n`;
    }
  }
  
  if (services.length > 0) {
    message += `\n*LAYANAN*\n`;
    for (const item of services.slice(0, 5)) {
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

    // Step 2.1: Check pending cancel confirmation
    const pendingCancel = pendingCancelConfirmation.get(userId);
    if (pendingCancel) {
      if (isConfirmationResponse(message)) {
        clearPendingCancelConfirmation(userId);
        if (pendingCancel.type === 'laporan') {
          const result = await cancelComplaint(pendingCancel.id, userId, pendingCancel.reason);
          return {
            success: true,
            response: result.success
              ? buildCancelSuccessResponse('laporan', pendingCancel.id, result.message)
              : buildCancelErrorResponse('laporan', pendingCancel.id, result.error, result.message),
            intent: 'CANCEL_COMPLAINT',
            metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
          };
        }

        const serviceResult = await cancelServiceRequest(pendingCancel.id, userId, pendingCancel.reason);
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
          response: 'Baik Kak, pembatalan saya batalkan. Ada yang bisa saya bantu lagi? 😊',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      return {
        success: true,
        response: 'Mohon konfirmasi ya Kak. Balas "ya" untuk melanjutkan pembatalan, atau "tidak" untuk membatalkan.',
        intent: pendingCancel.type === 'laporan' ? 'CANCEL_COMPLAINT' : 'CANCEL_SERVICE_REQUEST',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
      };
    }

    // Step 2.2: Check pending online service form offer
    const pendingOffer = pendingServiceFormOffer.get(userId);
    if (pendingOffer) {
      if (isConfirmationResponse(message)) {
        clearPendingServiceFormOffer(userId);
        const llmLike = {
          intent: 'CREATE_SERVICE_REQUEST',
          fields: {
            service_slug: pendingOffer.service_slug,
            ...(pendingOffer.village_id ? { village_id: pendingOffer.village_id } : {}),
          },
          reply_text: '',
        };

        const linkReply = await handleServiceRequestCreation(userId, llmLike);
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
          response: 'Baik Kak, siap. Kalau Kakak mau proses nanti, kabari saya ya. 😊',
          intent: 'QUESTION',
          metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
        };
      }

      return {
        success: true,
        response: 'Mau saya kirim link formulirnya sekarang? Balas *iya* atau *tidak* ya Kak.',
        intent: 'CREATE_SERVICE_REQUEST',
        metadata: { processingTimeMs: Date.now() - startTime, hasKnowledge: false },
      };
    }
    
    // Step 2.5: AI Optimization - Pre-process message
    const historyString = conversationHistory?.map(m => `${m.role}: ${m.content}`).join('\n') || '';
    const resolvedVillageId = villageId || process.env.DEFAULT_VILLAGE_ID;
    const greetingPattern = /^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam)|assalamualaikum|permisi)/i;
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

    // Step 2.55: Deterministic status check fast-path (avoid LLM misclassification)
    if (
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

      const responseText = await handleStatusCheck(userId, fastLlmLike);
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
    if (!shouldBypassFastPath && shouldUseFastPath(optimization, !!pendingConfirm)) {
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
    
    switch (effectiveLlmResponse.intent) {
      case 'CREATE_COMPLAINT':
        const rateLimitCheck = rateLimiterService.checkRateLimit(userId);
        if (!rateLimitCheck.allowed) {
          finalReplyText = rateLimitCheck.message || 'Anda telah mencapai batas laporan hari ini.';
        } else {
          finalReplyText = await handleComplaintCreation(userId, effectiveLlmResponse, message, mediaUrl);
        }
        break;
      
      case 'SERVICE_INFO':
        // Guard: office profile questions sometimes get misclassified as SERVICE_INFO.
        // Route them to the grounded knowledge handler to avoid form-link hallucinations.
        if (/(alamat|lokasi|maps|google\s*maps|jam|operasional|buka|tutup|nomor|kontak|telepon|telp|hubungi)/i.test(message)) {
          finalReplyText = await handleKnowledgeQuery(userId, message, effectiveLlmResponse);
        } else {
          finalReplyText = await handleServiceInfo(userId, effectiveLlmResponse);
        }
        break;
      
      case 'CREATE_SERVICE_REQUEST':
        finalReplyText = await handleServiceRequestCreation(userId, effectiveLlmResponse);
        break;

      case 'UPDATE_COMPLAINT':
        finalReplyText = await handleComplaintUpdate(userId, effectiveLlmResponse);
        break;

      case 'UPDATE_SERVICE_REQUEST':
        finalReplyText = await handleServiceRequestEditLink(userId, effectiveLlmResponse);
        break;
      
      case 'CHECK_STATUS':
        finalReplyText = await handleStatusCheck(userId, effectiveLlmResponse);
        break;
      
      case 'CANCEL_COMPLAINT':
        finalReplyText = await handleCancellationRequest(userId, 'laporan', effectiveLlmResponse);
        break;

      case 'CANCEL_SERVICE_REQUEST':
        finalReplyText = await handleCancellationRequest(userId, 'layanan', effectiveLlmResponse);
        break;
      
      case 'HISTORY':
        finalReplyText = await handleHistory(userId);
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
      village_id: pendingConfirm.village_id,
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
      village_id: pendingConfirm.village_id,
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
