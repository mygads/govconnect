import logger from '../utils/logger';
import { MessageReceivedEvent } from '../types/event.types';
import { buildContext, buildKnowledgeQueryContext } from './context-builder.service';
import { callGemini } from './llm.service';
import { createComplaint, getComplaintStatus, cancelComplaint, getUserHistory, HistoryItem } from './case-client.service';
import { publishAIReply, publishAIError, publishMessageStatus } from './rabbitmq.service';
import { isAIChatbotEnabled } from './settings.service';
import { searchKnowledge, getRAGContext, getKelurahanInfoContext } from './knowledge.service';
import { startTyping, stopTyping, isUserInTakeover, markMessagesAsRead } from './channel-client.service';
import { rateLimiterService } from './rate-limiter.service';
import { aiAnalyticsService } from './ai-analytics.service';
import { shouldRetrieveContext, isSpamMessage } from './rag.service';
import { sanitizeUserInput } from './context-builder.service';
import { detectLanguage, getLanguageContext } from './language-detection.service';
import { analyzeSentiment, getSentimentContext, needsHumanEscalation } from './sentiment-analysis.service';
import { caseServiceClient } from '../clients/case-service.client';

// In-memory cache for address confirmation state
// Key: wa_user_id, Value: { alamat: string, kategori: string, deskripsi: string, timestamp: number, foto_url?: string }
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
      logger.debug('Cleaned up expired address confirmation', { wa_user_id: key });
    }
  }
}, 60 * 1000); // Check every minute

/**
 * ==================== RESPONSE QUALITY VALIDATION ====================
 */

/**
 * Profanity patterns to filter from AI response
 * AI should never generate these, but this is a safety net
 */
const PROFANITY_PATTERNS = [
  /\b(anjing|babi|bangsat|kontol|memek|ngentot|jancok|kampret|tai|asu|bajingan|keparat)\b/gi,
  /\b(bodoh|tolol|idiot|goblok|bego|dungu)\b/gi,
];

/**
 * Validate and sanitize AI response before sending to user
 * Returns cleaned response or fallback if invalid
 */
function validateResponse(response: string): string {
  if (!response || response.trim().length === 0) {
    return 'Ada yang bisa saya bantu lagi?';
  }
  
  let cleaned = response;
  
  // Remove any profanity (should never happen, but safety net)
  for (const pattern of PROFANITY_PATTERNS) {
    cleaned = cleaned.replace(pattern, '***');
  }
  
  // Ensure response isn't too long (WhatsApp limit ~65000 chars, but keep it reasonable)
  if (cleaned.length > 4000) {
    cleaned = cleaned.substring(0, 3950) + '...\n\nPesan terpotong karena terlalu panjang.';
  }
  
  // Ensure response doesn't contain raw JSON/code artifacts
  if (cleaned.includes('```') || cleaned.includes('{\"')) {
    logger.warn('Response contains code artifacts, cleaning...');
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    cleaned = cleaned.replace(/\{\"[\s\S]*?\}/g, '');
    cleaned = cleaned.trim();
    
    if (cleaned.length < 10) {
      return 'Maaf, terjadi kesalahan. Silakan ulangi pertanyaan Anda.';
    }
  }
  
  return cleaned;
}

/**
 * Check if an address is too vague/incomplete
 * Returns true if address needs confirmation
 * 
 * NOTE: We are MORE LENIENT now - informal addresses with landmarks are ACCEPTED
 * Examples that are VALID:
 * - "depan masjid al ikhlas"
 * - "gang sebelah warung bu ani"
 * - "dekat SMAN 1 margahayu"
 * - "pertigaan toko bangunan jaya"
 */
function isVagueAddress(alamat: string): boolean {
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
    return true; // This is not an address, it's complaint description
  }
  
  // FIRST: Check if address contains a LANDMARK - if so, it's VALID!
  // Landmarks are specific enough for local petugas to find
  const landmarkPatterns = [
    /masjid\s+\w+/i,           // masjid al-ikhlas, masjid nurul iman
    /mushola/i,                // mushola, musholla
    /gereja\s+\w+/i,           // gereja bethel
    /sekolah\s+\w+/i,          // sekolah dasar negeri
    /sd\s*n?\s*\d*/i,          // SDN 1, SD 5
    /smp\s*n?\s*\d*/i,         // SMPN 2
    /sma\s*n?\s*\d*/i,         // SMAN 1
    /smk\s*n?\s*\d*/i,         // SMKN 3
    /warung\s+\w+/i,           // warung bu ani
    /toko\s+\w+/i,             // toko bangunan jaya
    /pasar\s+\w+/i,            // pasar tradisional
    /kantor\s+\w+/i,           // kantor kelurahan
    /puskesmas/i,              // puskesmas
    /posyandu/i,               // posyandu
    /lapangan\s+\w*/i,         // lapangan bola
    /taman\s+\w+/i,            // taman kota
    /makam\s+\w*/i,            // makam pahlawan
    /kuburan/i,                // kuburan
    /pertigaan/i,              // pertigaan
    /perempatan/i,             // perempatan
    /bundaran/i,               // bundaran
    /jembatan\s+\w*/i,         // jembatan merah
    /terminal\s+\w*/i,         // terminal bus
    /stasiun\s+\w*/i,          // stasiun kereta
    /bank\s+\w+/i,             // bank bca
    /atm\s+\w*/i,              // atm mandiri
    /alfamart/i,               // alfamart
    /indomaret/i,              // indomaret
    /spbu/i,                   // spbu
  ];
  
  if (landmarkPatterns.some(pattern => pattern.test(cleanAlamat))) {
    return false; // Has landmark - VALID address!
  }
  
  // Check for street/location identifiers
  const hasLocationIdentifiers = [
    /\bno\.?\s*\d+/i,           // no. 123, no 45
    /\bnomor\s*\d+/i,          // nomor 5
    /\brt\s*\.?\s*\d+/i,       // RT 01, RT.02
    /\brw\s*\.?\s*\d+/i,       // RW 03
    /\bblok\s*[a-z0-9]+/i,     // Blok A, Blok 5
    /\bgang\s+\w+/i,           // Gang Melati
    /\bgg\.?\s*\w+/i,          // Gg. Mawar
    /\bkomplek\s+\w+/i,        // Komplek Permata
    /\bperumahan\s+\w+/i,      // Perumahan Indah
    /\bjalan\s+[a-z]+/i,       // Jalan Merdeka
    /\bjln\.?\s+[a-z]+/i,      // Jln Sudirman
    /\bjl\.?\s+[a-z]+/i,       // Jl. Merdeka
    /depan\s+\w+\s+\w+/i,      // depan rumah pak X
    /sebelah\s+\w+/i,          // sebelah warung
    /belakang\s+\w+/i,         // belakang masjid
    /samping\s+\w+/i,          // samping sekolah
  ].some(pattern => pattern.test(cleanAlamat));
  
  if (hasLocationIdentifiers) {
    return false; // Has location identifiers - VALID!
  }
  
  // List of patterns that are truly TOO vague
  const vaguePatterns = [
    /^jalan\s*raya$/i,         // just "jalan raya" without name
    /^jln\s*raya$/i,
    /^jl\.?\s*raya$/i,
    /^kelurahan$/i,            // just "kelurahan"
    /^kecamatan$/i,            // just "kecamatan" 
    /^desa$/i,                 // just "desa"
    /^di\s*sini$/i,            // "di sini"
    /^sini$/i,                 // "sini"
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
 * Check if message is a confirmation response (ya, ok, lanjutkan, sudah cukup, etc.)
 */
function isConfirmationResponse(message: string): boolean {
  const cleanMessage = message.trim().toLowerCase();
  
  const confirmPatterns = [
    /^ya$/i,
    /^iya$/i,
    /^yap$/i,
    /^yup$/i,
    /^ok$/i,
    /^oke$/i,
    /^okey$/i,
    /^okay$/i,
    /^baik$/i,
    /^lanjut$/i,
    /^lanjutkan$/i,
    /^setuju$/i,
    /^boleh$/i,
    /^silakan$/i,
    /^siap$/i,
    /^buat\s*(saja|aja)?$/i,
    /^proses\s*(saja|aja)?$/i,
    /^kirim\s*(saja|aja)?$/i,
    /^ya,?\s*(lanjutkan|lanjut|buat|proses)/i,
    // New patterns for address confirmation
    /^sudah\s*(cukup)?$/i,
    /^cukup$/i,
    /^itu\s*(saja|aja)$/i,
    /^(itu|ini)\s*(sudah|udah)$/i,
    /^(sudah|udah)$/i,
    /^(sudah|udah)\s*(itu|ini)$/i,
    /^(udah|sudah)\s*(cukup|lengkap)$/i,
    /^segitu\s*(saja|aja)?$/i,
    /^ya\s*(sudah|udah|cukup)/i,
    /^tidak\s*(perlu)?\s*(tambah|detail)/i,
    /^ga\s*(perlu|usah)/i,
    /^gak\s*(perlu|usah)/i,
    /^nggak\s*(perlu|usah)/i,
    /^engga[k]?\s*(perlu|usah)/i,
  ];
  
  return confirmPatterns.some(pattern => pattern.test(cleanMessage));
}

/**
 * Main orchestration logic - processes incoming WhatsApp messages
 */
export async function processMessage(event: MessageReceivedEvent): Promise<void> {
  const { wa_user_id, message, message_id, has_media, media_url, media_public_url, media_type, media_caption, is_batched, batched_message_ids, original_messages } = event;
  
  // Validate required fields
  if (!wa_user_id || !message || !message_id) {
    logger.error('❌ Invalid message event - missing required fields', {
      hasWaUserId: !!wa_user_id,
      hasMessage: !!message,
      hasMessageId: !!message_id,
    });
    return; // Skip processing - message will be acked to prevent infinite loop
  }
  
  logger.info('🎯 Processing message', {
    wa_user_id,
    message_id,
    messageLength: message.length,
    hasMedia: has_media,
    mediaType: media_type,
    isBatched: is_batched,
    batchCount: batched_message_ids?.length,
  });
  
  // ============================================
  // MARK MESSAGES AS READ IN WHATSAPP
  // ============================================
  // This is when user sees "read" status (blue checkmarks)
  // We do this when AI starts processing, not when message is received
  const messageIdsToRead = is_batched && batched_message_ids 
    ? batched_message_ids 
    : [message_id];
  
  markMessagesAsRead(wa_user_id, messageIdsToRead).catch((err) => {
    logger.warn('Failed to mark messages as read', { error: err.message });
  });
  
  // Notify that we're processing
  if (is_batched && batched_message_ids) {
    await publishMessageStatus({
      wa_user_id,
      message_ids: batched_message_ids,
      status: 'processing',
    });
  }
  
  try {
    // Step 0: Check if AI chatbot is enabled
    const aiEnabled = await isAIChatbotEnabled();
    
    if (!aiEnabled) {
      logger.info('⏸️ AI chatbot is disabled, skipping message processing', {
        wa_user_id,
        message_id,
      });
      // Mark as completed even if not processed
      if (is_batched && batched_message_ids) {
        await publishMessageStatus({
          wa_user_id,
          message_ids: batched_message_ids,
          status: 'completed',
        });
      }
      return; // Exit without processing or replying
    }
    
    // Step 0.1: Check if user is in takeover mode (admin handling)
    const takeover = await isUserInTakeover(wa_user_id);
    
    if (takeover) {
      logger.info('👤 User is in takeover mode, admin will handle this message', {
        wa_user_id,
        message_id,
      });
      // Mark as completed - admin will handle
      if (is_batched && batched_message_ids) {
        await publishMessageStatus({
          wa_user_id,
          message_ids: batched_message_ids,
          status: 'completed',
        });
      }
      return; // Exit - admin is handling this conversation
    }
    
    // Step 0.2: Spam/malicious content check
    if (isSpamMessage(message)) {
      logger.warn('🚫 Spam message detected, ignoring', {
        wa_user_id,
        message_id,
        messagePreview: message.substring(0, 50),
      });
      if (is_batched && batched_message_ids) {
        await publishMessageStatus({
          wa_user_id,
          message_ids: batched_message_ids,
          status: 'completed',
        });
      }
      return; // Exit without replying to potential spam
    }
    
    // Sanitize user input to prevent prompt injection
    let sanitizedMessage = sanitizeUserInput(message);
    
    // Enhanced typo correction for common mistakes
    const typoCorrections: Record<string, string> = {
      // Document typos
      'srat': 'surat',
      'surat': 'surat', // keep correct
      'domisili': 'domisili', // already correct
      'keterangan': 'keterangan', // keep correct
      'sktm': 'SKTM',
      'skd': 'SKD',
      
      // Informal language
      'gw': 'saya',
      'gue': 'saya', 
      'gua': 'saya',
      'aku': 'saya',
      'w': 'saya', // single letter
      
      // Time expressions
      'bsk': 'besok',
      'besok': 'besok', // keep correct
      'lusa': 'lusa', // keep correct
      
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
      'mau': 'mau', // keep correct
      'pengen': 'ingin',
      'butuh': 'perlu',
      'bikin': 'buat',
      'gimana': 'bagaimana',
      'gmn': 'bagaimana',
      'bisa': 'bisa', // keep correct
      
      // Negation
      'ga': 'tidak',
      'gak': 'tidak',
      'nggak': 'tidak',
      'engga': 'tidak',
      'enggak': 'tidak',
      
      // Politeness
      'kak': 'kak', // keep correct
      'bang': 'bang', // keep correct
      'pak': 'pak', // keep correct
      
      // Common typos
      'nih': 'nih', // keep correct
      'dong': 'dong', // keep correct
      'ya': 'ya', // keep correct
      'iya': 'iya', // keep correct
      'ok': 'oke',
      'okay': 'oke',
    };
    
    // Apply typo corrections (word boundaries to avoid partial matches)
    for (const [typo, correct] of Object.entries(typoCorrections)) {
      const regex = new RegExp(`\\b${typo}\\b`, 'gi');
      sanitizedMessage = sanitizedMessage.replace(regex, correct);
    }
    
    // Step 0.25: Language detection (regional Indonesian languages)
    const languageDetection = detectLanguage(sanitizedMessage);
    const languageContext = getLanguageContext(languageDetection);
    
    // Step 0.26: Sentiment analysis
    const sentiment = analyzeSentiment(sanitizedMessage, wa_user_id);
    const sentimentContext = getSentimentContext(sentiment);
    
    // Check if user needs human escalation (consecutive frustration)
    if (needsHumanEscalation(wa_user_id)) {
      logger.warn('🚨 User needs human escalation', {
        wa_user_id,
        sentiment: sentiment.level,
        score: sentiment.score,
      });
      // Note: You could auto-enable takeover mode here or notify admin
    }
    
    // Step 0.3: Check if there's a pending address confirmation
    const pendingConfirm = pendingAddressConfirmation.get(wa_user_id);
    if (pendingConfirm) {
      logger.info('Found pending address confirmation', {
        wa_user_id,
        pendingAlamat: pendingConfirm.alamat,
        kategori: pendingConfirm.kategori,
      });
      
      // Check if user confirmed
      if (isConfirmationResponse(message)) {
        // User confirmed, create complaint with vague address
        logger.info('User confirmed vague address, creating complaint', {
          wa_user_id,
          alamat: pendingConfirm.alamat,
        });
        
        pendingAddressConfirmation.delete(wa_user_id);
        
        await startTyping(wa_user_id);
        
        const complaintId = await createComplaint({
          wa_user_id,
          kategori: pendingConfirm.kategori,
          deskripsi: pendingConfirm.deskripsi,
          alamat: pendingConfirm.alamat,
          rt_rw: '',
          foto_url: pendingConfirm.foto_url,
        });
        
        await stopTyping(wa_user_id);
        
        if (!complaintId) {
          // DON'T send error to user - throw error to trigger AI error event
          throw new Error('Failed to create complaint after address confirmation');
        }
        
        const withPhoto = pendingConfirm.foto_url ? ' 📷' : '';
        const finalReply = `✅ Terima kasih! Laporan Anda telah kami terima dengan nomor ${complaintId}.${withPhoto}\n\nPetugas akan segera menindaklanjuti laporan Anda.`;
        
        await publishAIReply({ 
          wa_user_id, 
          reply_text: finalReply,
          batched_message_ids: is_batched ? batched_message_ids : undefined,
        });
        
        // Mark as completed
        if (is_batched && batched_message_ids) {
          await publishMessageStatus({
            wa_user_id,
            message_ids: batched_message_ids,
            status: 'completed',
          });
        }
        return;
      } else {
        // Check if user provides more specific address
        const looksLikeAddress = [
          /jalan/i, /jln/i, /jl\./i,
          /\bno\b/i, /nomor/i,
          /\brt\b/i, /\brw\b/i,
          /gang/i, /gg\./i,
          /komplek/i, /perumahan/i, /blok/i,
        ].some(pattern => pattern.test(message));
        
        if (looksLikeAddress && !isVagueAddress(message)) {
          // User provided better address
          logger.info('User provided more specific address', {
            wa_user_id,
            newAlamat: message,
          });
          
          pendingAddressConfirmation.delete(wa_user_id);
          
          await startTyping(wa_user_id);
          
          const complaintId = await createComplaint({
            wa_user_id,
            kategori: pendingConfirm.kategori,
            deskripsi: pendingConfirm.deskripsi,
            alamat: message.trim(),
            rt_rw: '',
            foto_url: pendingConfirm.foto_url,
          });
          
          await stopTyping(wa_user_id);
          
          if (!complaintId) {
            // DON'T send error to user - throw error to trigger AI error event
            throw new Error('Failed to create complaint with updated address');
          }
          
          const withPhoto = pendingConfirm.foto_url ? ' 📷' : '';
          const finalReply = `✅ Terima kasih! Laporan Anda telah kami terima dengan nomor ${complaintId}.${withPhoto}\n\nPetugas akan segera menindaklanjuti laporan di ${message.trim()}.`;
          
          await publishAIReply({ 
            wa_user_id, 
            reply_text: finalReply,
            batched_message_ids: is_batched ? batched_message_ids : undefined,
          });
          
          // Mark as completed
          if (is_batched && batched_message_ids) {
            await publishMessageStatus({
              wa_user_id,
              message_ids: batched_message_ids,
              status: 'completed',
            });
          }
          return;
        }
        
        // User said something else, clear pending and continue normal flow
        logger.info('User response not confirmation, clearing pending and processing normally', {
          wa_user_id,
          message: message.substring(0, 50),
        });
        pendingAddressConfirmation.delete(wa_user_id);
      }
    }
    
    // Step 0.5: Send typing indicator BEFORE processing
    await startTyping(wa_user_id);
    
    // Step 1: Pre-fetch RAG context if message looks like a question (OPTIMIZATION)
    // This allows single LLM call for knowledge queries instead of two
    let preloadedRAGContext: any = undefined;
    const looksLikeQuestion = shouldRetrieveContext(sanitizedMessage);
    
    // Check if message is a greeting - need kelurahan info for personalization
    const isGreeting = /^(halo|hai|hi|hello|selamat\s+(pagi|siang|sore|malam)|assalamualaikum|permisi)/i.test(sanitizedMessage.trim());
    
    if (isGreeting) {
      // For greetings, fetch kelurahan info to personalize welcome message
      logger.debug('Greeting detected, fetching kelurahan info', {
        wa_user_id,
        message: sanitizedMessage.substring(0, 30),
      });
      
      try {
        const kelurahanInfo = await getKelurahanInfoContext();
        if (kelurahanInfo) {
          // Create a simple context string for greeting
          preloadedRAGContext = kelurahanInfo;
          logger.info('Loaded kelurahan info for greeting', {
            wa_user_id,
            infoLength: kelurahanInfo.length,
          });
        }
      } catch (error: any) {
        logger.warn('Failed to fetch kelurahan info for greeting', {
          wa_user_id,
          error: error.message,
        });
      }
    } else if (looksLikeQuestion) {
      logger.debug('Message looks like a question, pre-fetching RAG context', {
        wa_user_id,
        message: sanitizedMessage.substring(0, 50),
      });
      
      try {
        // Non-blocking RAG fetch - we'll use it if needed
        const ragContext = await getRAGContext(sanitizedMessage);
        if (ragContext.totalResults > 0) {
          // Pass full RAGContext object (includes confidence scoring)
          preloadedRAGContext = ragContext;
          logger.info('Pre-loaded RAG context', {
            wa_user_id,
            resultsFound: ragContext.totalResults,
            confidence: ragContext.confidence?.level,
            searchTimeMs: ragContext.searchTimeMs,
          });
        }
      } catch (error: any) {
        logger.warn('Pre-fetch RAG failed, will fallback if needed', {
          wa_user_id,
          error: error.message,
        });
      }
    }
    
    // Step 2: Build context (fetch history + format prompt) - include pre-fetched knowledge with confidence
    let { systemPrompt, messageCount } = await buildContext(wa_user_id, sanitizedMessage, preloadedRAGContext);
    
    // Inject language and sentiment context into prompt
    if (languageContext || sentimentContext) {
      const additionalContext = `${languageContext}${sentimentContext}`;
      // Insert before the final user message section
      systemPrompt = systemPrompt.replace(
        'PESAN TERAKHIR USER:',
        `${additionalContext}\n\nPESAN TERAKHIR USER:`
      );
    }
    
    logger.debug('Context built', {
      wa_user_id,
      historyMessages: messageCount,
      language: languageDetection.primary !== 'indonesian' ? languageDetection.primary : undefined,
      sentiment: sentiment.level !== 'neutral' ? sentiment.level : undefined,
      hasPreloadedKnowledge: !!preloadedRAGContext,
      knowledgeConfidence: preloadedRAGContext?.confidence?.level,
    });
    
    // Step 3: Call LLM for intent detection (with knowledge already injected if available)
    const llmResult = await callGemini(systemPrompt);
    
    // If LLM call failed (all models exhausted), skip processing
    // Message will stay in pending queue and be retried later
    if (!llmResult) {
      logger.warn('⏸️ LLM call failed, message will be retried later', {
        wa_user_id,
        message_id,
        isBatched: is_batched,
      });
      
      // Stop typing indicator
      await stopTyping(wa_user_id);
      
      // Mark as failed for retry - don't publish error to avoid fallback message
      if (is_batched && batched_message_ids) {
        await publishMessageStatus({
          wa_user_id,
          message_ids: batched_message_ids,
          status: 'failed',
        });
      }
      
      // Throw error to trigger message nack for requeue
      throw new Error('LLM_FAILURE_RETRY_LATER');
    }
    
    const { response: llmResponse, metrics } = llmResult;
    
    // Stop typing after LLM responds
    await stopTyping(wa_user_id);
    
    // Track analytics (intent, timing, token usage)
    aiAnalyticsService.recordIntent(
      wa_user_id,
      llmResponse.intent,
      metrics.durationMs,
      systemPrompt.length,
      llmResponse.reply_text.length,
      metrics.model
    );
    
    logger.info('LLM response received', {
      wa_user_id,
      intent: llmResponse.intent,
      needsKnowledge: llmResponse.needs_knowledge,
      durationMs: metrics.durationMs,
    });
    
    // Step 3: Handle intent
    let finalReplyText = llmResponse.reply_text;
    let guidanceText = llmResponse.guidance_text || '';
    
    switch (llmResponse.intent) {
      case 'CREATE_COMPLAINT':
        // Check rate limit before creating complaint
        const rateLimitCheck = rateLimiterService.checkRateLimit(wa_user_id);
        if (!rateLimitCheck.allowed) {
          finalReplyText = rateLimitCheck.message || 'Anda telah mencapai batas laporan hari ini.';
          logger.warn('Rate limit exceeded for complaint creation', {
            wa_user_id,
            reason: rateLimitCheck.reason,
          });
          break;
        }
        // Pass media_public_url for Dashboard to display (not internal Docker URL)
        finalReplyText = await handleComplaintCreation(wa_user_id, llmResponse, message, media_public_url || media_url);
        break;
      
      case 'CREATE_RESERVATION':
        finalReplyText = await handleReservationCreation(wa_user_id, llmResponse);
        break;
      
      case 'CANCEL_RESERVATION':
        finalReplyText = await handleReservationCancellation(wa_user_id, llmResponse);
        break;
      
      case 'CHECK_STATUS':
        finalReplyText = await handleStatusCheck(wa_user_id, llmResponse);
        break;
      
      case 'CANCEL_COMPLAINT':
        finalReplyText = await handleCancellation(wa_user_id, llmResponse);
        break;
      
      case 'HISTORY':
        finalReplyText = await handleHistory(wa_user_id);
        break;
      
      case 'KNOWLEDGE_QUERY':
        // If we pre-loaded knowledge and LLM already answered with it, use that reply
        // Otherwise fetch knowledge and do second LLM call (fallback)
        if (preloadedRAGContext?.contextString && llmResponse.reply_text && llmResponse.reply_text.length > 20) {
          // LLM already answered with pre-loaded knowledge context
          logger.info('Using pre-loaded knowledge response (single LLM call)', { 
            wa_user_id,
            confidence: preloadedRAGContext.confidence?.level 
          });
        } else {
          // Need to fetch knowledge and do second LLM call (fallback path)
          finalReplyText = await handleKnowledgeQuery(wa_user_id, message, llmResponse);
        }
        break;
      
      case 'QUESTION':
        // Just use the LLM reply as-is
        logger.info('Question handled', { wa_user_id });
        break;
      
      case 'UNKNOWN':
        logger.warn('Unknown intent', { wa_user_id, message });
        break;
      
      default:
        logger.error('Unhandled intent', {
          wa_user_id,
          intent: llmResponse.intent,
        });
    }
    
    // Step 4: Validate and sanitize response before sending
    const validatedReply = validateResponse(finalReplyText);
    const validatedGuidance = guidanceText ? validateResponse(guidanceText) : '';
    
    // Add context for batched messages
    let batchedReplyText = validatedReply;
    if (is_batched && original_messages && original_messages.length > 1) {
      // Prepend a note that we're responding to multiple messages
      logger.info('Responding to batched messages', {
        wa_user_id,
        messageCount: original_messages.length,
      });
    }
    
    // Step 5: Publish AI reply event (for Notification Service)
    // Include guidance_text if present - it will be sent as a separate bubble
    await publishAIReply({
      wa_user_id,
      reply_text: batchedReplyText,
      guidance_text: validatedGuidance || undefined,
      message_id: is_batched ? undefined : message_id,  // For single message cleanup
      batched_message_ids: is_batched ? batched_message_ids : undefined,
    });
    
    // Mark messages as completed
    if (is_batched && batched_message_ids) {
      await publishMessageStatus({
        wa_user_id,
        message_ids: batched_message_ids,
        status: 'completed',
      });
    }
    
    logger.info('✅ Message processed successfully', {
      wa_user_id,
      message_id,
      intent: llmResponse.intent,
      hasGuidance: !!validatedGuidance,
      isBatched: is_batched,
    });
  } catch (error: any) {
    // Stop typing indicator on error
    await stopTyping(wa_user_id);
    
    logger.error('❌ Failed to process message', {
      wa_user_id,
      message_id,
      error: error.message,
      isBatched: is_batched,
    });
    
    // Add to AI retry queue instead of immediately publishing error
    // This ensures the message will be retried and user won't receive error message
    const { addToAIRetryQueue } = await import('./rabbitmq.service');
    addToAIRetryQueue(event, error.message || 'Unknown error');
    
    // DON'T publish error or fallback message here
    // The retry queue will handle retries and only send fallback after max attempts
    
    // Mark messages as failed (will be updated to completed on successful retry)
    if (is_batched && batched_message_ids) {
      await publishMessageStatus({
        wa_user_id,
        message_ids: batched_message_ids,
        status: 'failed',
        error_message: error.message,
      });
    }
  }
}

/**
 * Detect if complaint is an emergency that needs immediate attention
 */
function detectEmergencyComplaint(deskripsi: string, message: string, kategori: string): boolean {
  const combinedText = `${deskripsi} ${message}`.toLowerCase();
  
  // Emergency keywords that indicate immediate danger or blocking situation
  const emergencyKeywords = [
    /darurat/i,
    /bahaya/i,
    /menghalangi\s+jalan/i,
    /tidak\s+bisa\s+lewat/i,
    /banjir\s+besar/i,
    /banjir\s+tinggi/i,
    /kebakaran/i,
    /pohon\s+tumbang.*menghalangi/i,
    /pohon\s+tumbang.*jalan/i,
    /listrik\s+nyetrum/i,
    /kabel\s+putus/i,
    /gas\s+bocor/i,
    /longsor/i,
    /runtuh/i,
    /ambruk/i,
  ];
  
  // Check if any emergency keyword matches
  const hasEmergencyKeyword = emergencyKeywords.some(pattern => pattern.test(combinedText));
  
  // Certain categories are automatically high priority if they block access
  const highPriorityCategories = ['pohon_tumbang', 'banjir'];
  const isHighPriorityCategory = highPriorityCategories.includes(kategori);
  
  // Check for blocking/access keywords
  const blockingKeywords = /menghalangi|menutupi|tidak\s+bisa\s+lewat|terhalang|tertutup/i;
  const hasBlockingKeyword = blockingKeywords.test(combinedText);
  
  // Emergency if: has emergency keyword OR (high priority category AND blocking)
  return hasEmergencyKeyword || (isHighPriorityCategory && hasBlockingKeyword);
}

/**
 * Handle complaint creation
 */
export async function handleComplaintCreation(wa_user_id: string, llmResponse: any, currentMessage: string, mediaUrl?: string): Promise<string> {
  const { kategori, rt_rw } = llmResponse.fields;
  let { alamat, deskripsi } = llmResponse.fields;
  
  // Log what LLM returned for debugging
  logger.info('LLM complaint fields', {
    wa_user_id,
    kategori,
    alamat,
    deskripsi,
    rt_rw,
    hasMedia: !!mediaUrl,
    currentMessage: currentMessage.substring(0, 100),
  });
  
  // SMART ALAMAT DETECTION: If LLM didn't extract alamat, try to detect from current message
  if (!alamat) {
    const complaintKeywords = /menumpuk|tumpukan|rusak|berlubang|mati|padam|tersumbat|banjir|tumbang|roboh|sampah|limbah|genangan|menghalangi/i;
    const isJustAddress = !complaintKeywords.test(currentMessage) && currentMessage.length < 100;
    
    if (isJustAddress) {
      // Check formal address indicators
      const addressPatterns = [
        /jalan/i, /jln/i, /jl\./i,
        /\bno\b/i, /nomor/i,
        /\brt\b/i, /\brw\b/i,
        /gang/i, /gg\./i,
        /komplek/i, /perumahan/i, /blok/i,
      ];
      
      const looksLikeFormalAddress = addressPatterns.some(pattern => pattern.test(currentMessage));
      
      if (looksLikeFormalAddress) {
        alamat = currentMessage.trim();
        logger.info('Smart alamat detection: formal address detected', {
          wa_user_id,
          detectedAlamat: alamat,
        });
      } else {
        // Check for informal location patterns (e.g., "di margahayu bandung", "depan masjid")
        const informalAddressPatterns = [
          /^di\s+/i,                      // starts with "di "
          /dekat|depan|belakang|samping/i, // near, front, back, beside
          /margahayu|cimahi|bandung|jakarta|surabaya|semarang/i, // city/area names
          /masjid|mushola|sekolah|kantor|warung|toko/i,  // landmarks
        ];
        
        const looksLikeInformalAddress = informalAddressPatterns.some(pattern => pattern.test(currentMessage));
        
        // Also check if message is short and NOT a confirmation (e.g., not just "ya", "oke", "sudah")
        const confirmationWords = /^(ya|iya|yak|yup|oke|ok|siap|sudah|cukup|proses|lanjut)$/i;
        const isNotConfirmation = !confirmationWords.test(currentMessage.trim());
        
        if ((looksLikeInformalAddress || (isJustAddress && currentMessage.length >= 5)) && isNotConfirmation) {
          // Clean up the message to use as address
          alamat = currentMessage.trim()
            .replace(/^(di|ke)\s+/i, '') // remove leading "di " or "ke "
            .replace(/kak$/i, '')         // remove trailing "kak"
            .trim();
          
          if (alamat.length >= 3) {
            logger.info('Smart alamat detection: informal address/location detected', {
              wa_user_id,
              originalMessage: currentMessage,
              detectedAlamat: alamat,
            });
          } else {
            alamat = ''; // Too short, probably not an address
          }
        }
      }
    } else {
      // Try to extract address part from complaint message
      // Look for patterns like "di Jalan X", "di komplek Y", "di gang X rt Y", etc.
      // IMPORTANT: Avoid matching "jalan" in "lampu jalan" or "jalan rusak"
      const addressRegex = /(?:di\s+)?(gang|gg\.|komplek|perumahan|blok)\s+[a-zA-Z0-9\s]+(?:\s+(?:no|nomor|rt|rw|blok)[\s\.]*[\d\/a-zA-Z]+)*/i;
      const match = currentMessage.match(addressRegex);
      
      if (match) {
        alamat = match[0].trim();
        logger.info('Smart alamat detection: extracted address from complaint message', {
          wa_user_id,
          originalMessage: currentMessage.substring(0, 50),
          detectedAlamat: alamat,
        });
      } else {
        // Try "di jalan X" pattern but only if "jalan" is followed by a proper name (capitalized or specific)
        // IMPORTANT: Make sure "jalan" is not preceded by complaint keywords like "lampu", "penerangan"
        const jalanMatch = currentMessage.match(/(?:di\s+)?(jalan|jln|jl\.?)\s+([A-Z][a-zA-Z0-9\s]+(?:\s+(?:no|nomor|rt|rw)[\s\.]*[\d\/a-zA-Z]+)*)/i);
        if (jalanMatch && jalanMatch[2] && jalanMatch[2].length >= 3) {
          // Make sure it's not "jalan rusak" or "jalan mati"
          const roadName = jalanMatch[2].trim();
          // Also check if "jalan" is preceded by complaint keywords
          const matchIndex = currentMessage.indexOf(jalanMatch[0]);
          const textBefore = currentMessage.substring(Math.max(0, matchIndex - 20), matchIndex).toLowerCase();
          const hasComplaintBefore = /lampu|penerangan|listrik|cahaya/i.test(textBefore);
          
          if (!hasComplaintBefore && !/^(rusak|mati|berlubang|retak|padam)/i.test(roadName)) {
            alamat = `${jalanMatch[1]} ${roadName}`.trim();
            logger.info('Smart alamat detection: jalan extraction', {
              wa_user_id,
              originalMessage: currentMessage.substring(0, 50),
              detectedAlamat: alamat,
            });
          }
        }
      }
      
      // If still no alamat, try other patterns
      if (!alamat) {
        // Try to extract location names (city/area) from complaint message
        // Pattern: "di [location]" where location is a known city/area or landmark
        const locationMatch = currentMessage.match(/(?:di|ke)\s+((?:margahayu|cimahi|bandung|jakarta|surabaya|semarang|bekasi|tangerang|depok|bogor)[a-z\s]*)/i);
        if (locationMatch && locationMatch[1].length >= 3) {
          alamat = locationMatch[1].trim();
          logger.info('Smart alamat detection: city/area extraction', {
            wa_user_id,
            originalMessage: currentMessage.substring(0, 50),
            detectedAlamat: alamat,
          });
        } else {
          // Try landmark extraction: "di depan/dekat [landmark]"
          const landmarkMatch = currentMessage.match(/(?:di\s+)?(depan|dekat|belakang|samping|sebelah)\s+([a-zA-Z0-9\s]+?)(?:\s+kak|\s*$)/i);
          if (landmarkMatch && landmarkMatch[2].length >= 3) {
            // Make sure extracted text doesn't contain complaint keywords
            const extractedText = landmarkMatch[2].trim();
            const hasComplaintKeyword = /menumpuk|tumpukan|rusak|berlubang|mati|padam|tersumbat|banjir|tumbang|roboh|sampah|limbah|genangan|menghalangi|lampu|jalan|ada/i.test(extractedText);
            if (!hasComplaintKeyword) {
              alamat = `${landmarkMatch[1]} ${extractedText}`.trim();
              logger.info('Smart alamat detection: landmark extraction', {
                wa_user_id,
                originalMessage: currentMessage.substring(0, 50),
                detectedAlamat: alamat,
              });
            }
          }
        }
      }
    }
  }
  
  // Fallback: if deskripsi is empty but we have kategori, generate default description
  if (!deskripsi && kategori) {
    // Use kategori as base for description
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
    
    logger.info('Generated default deskripsi from kategori', {
      wa_user_id,
      kategori,
      deskripsi,
    });
  }
  
  // Check if we have enough information - BOTH kategori AND alamat are required!
  if (!kategori || !alamat) {
    logger.info('Incomplete complaint data, asking for more info', {
      wa_user_id,
      hasKategori: !!kategori,
      hasAlamat: !!alamat,
      hasDeskripsi: !!deskripsi,
    });
    
    // Generate custom response based on what's missing
    // DON'T trust LLM reply_text as it might already contain confirmation
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
    logger.info('Address is vague, asking for confirmation', {
      wa_user_id,
      alamat,
      kategori,
    });
    
    // Store pending confirmation (including foto_url if present)
    pendingAddressConfirmation.set(wa_user_id, {
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
  
  // Check if this is an emergency complaint (priority triage)
  const isEmergency = detectEmergencyComplaint(deskripsi, currentMessage, kategori);
  
  // Create complaint in Case Service (SYNC call)
  const complaintId = await createComplaint({
    wa_user_id,
    kategori,
    deskripsi: deskripsi || `Laporan ${kategori.replace(/_/g, ' ')}`,
    alamat: alamat,
    rt_rw: rt_rw || '',
    foto_url: mediaUrl,
  });
  
  if (complaintId) {
    // Record successful report for rate limiting
    rateLimiterService.recordReport(wa_user_id);
    // Record success for analytics
    aiAnalyticsService.recordSuccess('CREATE_COMPLAINT');
    
    const withPhoto = mediaUrl ? ' 📷' : '';
    
    // Different response for emergency vs normal complaints
    if (isEmergency) {
      logger.info('🚨 Emergency complaint detected', { wa_user_id, complaintId, kategori, deskripsi });
      return `🚨 PRIORITAS TINGGI\n\nTerima kasih laporannya Kak! Ini situasi darurat yang perlu penanganan segera.\n\nSaya sudah catat sebagai LAPORAN PRIORITAS dengan nomor ${complaintId}.${withPhoto}\n\nTim kami akan segera ke lokasi ${alamat}.\n\n⚠️ Untuk keamanan, mohon hindari area tersebut dulu ya Kak.`;
    } else {
      return `✅ Terima kasih! Laporan Anda telah kami terima dengan nomor ${complaintId}.${withPhoto}\n\nPetugas akan survey lokasi dalam 1-3 hari kerja di ${alamat}.`;
    }
  } else {
    // Record failure for analytics
    aiAnalyticsService.recordFailure('CREATE_COMPLAINT');
    // DON'T send error to user - throw error to trigger AI error event for dashboard handling
    throw new Error('Failed to create complaint in Case Service');
  }
}

/**
 * Extract address using LLM as fallback when regex fails
 */
async function extractAddressWithLLM(userMessages: string): Promise<string | null> {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const { config } = await import('../config/env');
    
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    const prompt = `Ekstrak ALAMAT LENGKAP dari percakapan berikut. Jika user menyebutkan alamat dengan format "tinggal di [alamat]", ekstrak SEMUA detail alamat yang disebutkan (jalan, nomor, RT, RW, dll).

Percakapan:
${userMessages}

ATURAN:
1. Ekstrak ALAMAT LENGKAP yang disebutkan user
2. Jika ada "tinggal di jalan melati no 50 rt 07 rw 05" → return "jalan melati no 50 rt 07 rw 05"
3. Jika tidak ada alamat → return "TIDAK_ADA"
4. Return HANYA alamatnya, tanpa kata "tinggal di" atau kata lain

Alamat:`;

    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    
    if (response && response !== 'TIDAK_ADA' && response.length >= 5 && response.length <= 200) {
      return response;
    }
    
    return null;
  } catch (error: any) {
    logger.error('LLM address extraction error', { error: error.message });
    return null;
  }
}

/**
 * Extract citizen data from conversation history
 * This is a fallback when LLM doesn't fill the fields properly
 */
export async function extractCitizenDataFromHistory(wa_user_id: string): Promise<{
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
      params: { wa_user_id, limit: 20 },
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 5000,
    });
    
    const messages = response.data?.messages || [];
    const result: {
      nama_lengkap?: string;
      nik?: string;
      alamat?: string;
      no_hp?: string;
      keperluan?: string;
    } = {};
    
    // Combine all user messages for extraction
    const userMessages = messages
      .filter((m: any) => m.direction === 'IN')
      .map((m: any) => m.message_text)
      .join(' ');
    
    // DEBUG: Log full user messages for analysis
    logger.info('🔍 DEBUG: Full user messages for extraction', { 
      wa_user_id, 
      userMessages,
      messageCount: messages.filter((m: any) => m.direction === 'IN').length 
    });
    
    // Extract NIK (16 digits) with validation
    // Support formats: "nik 3207...", "nik:3207...", "nik gw 3207..."
    const nikPatterns = [
      /(?:nik|NIK)[\s:]+(\d{16})/,  // nik: 3207... or nik 3207...
      /\b(\d{16})\b/,                // standalone 16 digits
    ];
    
    let nikCandidates: string[] = [];
    for (const pattern of nikPatterns) {
      const matches = userMessages.match(new RegExp(pattern, 'g'));
      if (matches) {
        for (const match of matches) {
          const nikMatch = match.match(/(\d{16})/);
          if (nikMatch) {
            nikCandidates.push(nikMatch[1]);
          }
        }
      }
    }
    
    if (nikCandidates.length > 0) {
      // Remove duplicates
      nikCandidates = [...new Set(nikCandidates)];
      
      // Validate and pick the best one
      for (const nik of nikCandidates) {
        // Basic validation: NIK should start with valid province code (11-99)
        const provinceCode = parseInt(nik.substring(0, 2));
        if (provinceCode >= 11 && provinceCode <= 99) {
          result.nik = nik;
          logger.info('✅ NIK extracted', { wa_user_id, nik });
          break;
        }
      }
      // If no valid NIK found, use the first one anyway
      if (!result.nik && nikCandidates.length > 0) {
        result.nik = nikCandidates[0];
        logger.info('✅ NIK extracted (unvalidated)', { wa_user_id, nik: nikCandidates[0] });
      }
    }
    
    // Extract phone number (Indonesian format) with better pattern
    // Support formats: 08xxx, 628xxx, +628xxx, with/without spaces/dashes
    const phonePatterns = [
      /\b(08\d{8,11})\b/,           // 08xxxxxxxxxx
      /\b(628\d{8,11})\b/,          // 628xxxxxxxxxx
      /\+?(62)\s*8\d{8,11}/,        // +62 8xxxxxxxxxx
      /(?:hp|no|nomer|telp|phone)[\s:]*(\d{10,13})/i, // hp: 08xxxxxxxxxx
    ];
    
    for (const pattern of phonePatterns) {
      const match = userMessages.match(pattern);
      if (match) {
        let phone = match[1] || match[0];
        // Normalize: remove spaces, dashes, plus
        phone = phone.replace(/[\s\-\+]/g, '');
        // Convert 628xxx to 08xxx
        if (phone.startsWith('628')) {
          phone = '0' + phone.substring(2);
        } else if (phone.startsWith('62')) {
          phone = '0' + phone.substring(2);
        }
        // Validate length (10-13 digits for Indonesian numbers)
        if (phone.length >= 10 && phone.length <= 13 && phone.startsWith('08')) {
          result.no_hp = phone;
          logger.info('✅ Phone extracted', { wa_user_id, no_hp: phone });
          break;
        }
      }
    }
    
    // Extract name patterns - ENHANCED for better multi-step conversation support
    const namePatterns = [
      // "nama saya X" - most reliable, stop at specific terminators
      /nama\s+saya\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)(?:\s+(?:mau|ingin|nik|alamat|hp|no|tinggal|telp|buat|bikin)|\s*[,.]|\s*$)/i,
      // "saya X" at start of line or after newline - more restrictive
      /(?:^|\n)\s*saya\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+(?:mau|ingin|nik|alamat|hp|no|tinggal|telp|buat|bikin)|\s*[,.]|\s*$)/i,
      // "nama: X" or "nama X" (key:value format)
      /nama[\s:]+([A-Za-z]+(?:\s+[A-Za-z]+)?)(?:\s+(?:mau|ingin|nik|alamat|hp|no|tinggal|telp|buat|bikin)|\s*[,.]|\s*$)/i,
      // "gw/gue X" - ENHANCED: capture full name with better termination
      /(?:gw|gue|gua)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)(?:\s+(?:mau|ingin|nik|alamat|hp|no|tinggal|telp|buat|bikin)|\s*[,.]|\s*$)/i,
      // "bang gw X" pattern - specific for informal greetings
      /(?:bang|pak|kak)\s+(?:gw|gue|gua)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)(?:\s+(?:mau|ingin|nik|alamat|hp|no|tinggal|telp|buat|bikin)|\s*[,.]|\s*$)/i,
      // NEW: "X mau buat" pattern - name at beginning
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:mau|ingin|pengen|butuh|perlu)\s+(?:buat|bikin|urus)/i,
      // NEW: "halo, saya X" pattern
      /(?:halo|hai|hi)[\s,]*saya\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)(?:\s*[,.]|\s*$)/i,
    ];
    
    for (const pattern of namePatterns) {
      const match = userMessages.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        
        // Improved validation - less strict for real names
        const invalidWords = [
          'bingung', 'cara', 'bantu', 'tolong', 'gimana', 'bagaimana',
          'legalitas', 'pendaftaran', 'surat', 'keterangan', 'domisili'
        ];
        
        // Check if it's clearly not a name (starts with action words)
        const startsWithActionWord = /^(mau|ingin|buat|bikin|untuk|keperluan|bingung|cara|gimana)/i.test(name);
        
        const isValidName = name.length >= 2 && 
                           name.length <= 50 && // More reasonable max length
                           !/\d/.test(name) && // No digits
                           !startsWithActionWord && // Don't start with action words
                           !invalidWords.some(word => name.toLowerCase().includes(word)) && // No clearly invalid words
                           /^[A-Za-z\s.]+$/.test(name) && // Letters, spaces, and dots (for titles)
                           !/^(saya|aku|gw|gue|kak|pak|bang)$/i.test(name.trim()); // Not just pronouns/titles
        
        if (isValidName) {
          result.nama_lengkap = name;
          logger.info('✅ Name extracted', { wa_user_id, nama_lengkap: name, pattern: namePatterns.indexOf(pattern) });
          break;
        } else {
          logger.warn('❌ Name candidate rejected', { 
            wa_user_id, 
            candidate: name, 
            reason: 'validation failed',
            length: name.length,
            hasDigits: /\d/.test(name),
            hasInvalidWords: invalidWords.some(word => name.toLowerCase().includes(word))
          });
        }
      }
    }
    
    // Extract address patterns - MULTI-STRATEGY APPROACH
    // Strategy: Find "tinggal di X" with various terminators
    logger.info('🔍 Starting address extraction...', { wa_user_id });
    
    const addressPatterns = [
      // Pattern 1: "tinggal di X, untuk Y" (stop at untuk but include more address)
      { regex: /tinggal\s+di\s+(.+?)(?:\s*,?\s*untuk\s+(?:keperluan|buat|bikin))/i, name: 'tinggal-untuk' },
      // Pattern 2: "tinggal di X, mau Y" (stop at mau)
      { regex: /tinggal\s+di\s+(.+?)(?:\s*,?\s*mau\s+)/i, name: 'tinggal-mau' },
      // Pattern 3: "tinggal di X, besok/lusa" (date after address)
      { regex: /tinggal\s+di\s+(.+?)(?:\s*,?\s*(?:besok|lusa|bsk|jam))\b/i, name: 'tinggal-date' },
      // Pattern 4: "tinggal di X, nik/hp" (nik or hp after address)
      { regex: /tinggal\s+di\s+(.+?)(?:\s*,?\s*(?:nik|hp|nomer|telp|no))\b/i, name: 'tinggal-nik-hp' },
      // Pattern 5: "tinggal di X," (with comma - most reliable)
      { regex: /tinggal\s+di\s+([^,]+),/i, name: 'tinggal-comma' },
      // Pattern 6: "alamat: X" or "alamat X" (key:value format)
      { regex: /alamat[\s:]+(?:di\s+)?(.+?)(?:\s*,?\s*(?:hp|nik|untuk|keperluan|besok|lusa|mau)|$)/i, name: 'alamat-keyvalue' },
      // Pattern 7: "alamatnya X"
      { regex: /alamat(?:nya)\s+(?:di\s+)?([^,]+)/i, name: 'alamat-direct' },
      // Pattern 8: "di jalan/gang X" (address with indicator)
      { regex: /\bdi\s+(jalan|jln|jl|gang|gg|komplek|perumahan|blok)\s+([^,]+?)(?:\s*,?\s*(?:untuk|mau|hp|nik|no|besok)|\?|$)/i, name: 'di-address' },
      // Pattern 9: "tinggal di X" until end or question mark (last resort)
      { regex: /tinggal\s+di\s+(.+?)(?:\?|$)/i, name: 'tinggal-end' },
      // Pattern 10: NEW - Handle "X rt Y rw Z" format better
      { regex: /(?:tinggal\s+di\s+|alamat\s+)?(.+?(?:rt|rw)\s*\d+(?:\s*(?:rt|rw)\s*\d+)?)(?:\s*,?\s*(?:hp|nik|untuk|keperluan|besok|lusa|mau|buat|bikin)|\s*$)/i, name: 'rt-rw-format' },
      // Pattern 11: NEW - Better handling of informal addresses with landmarks
      { regex: /(?:tinggal\s+di\s+|alamat\s+)?((?:depan|dekat|belakang|samping|sebelah)\s+[^,]+?)(?:\s*,?\s*(?:hp|nik|untuk|keperluan|besok|lusa|mau|buat|bikin)|\s*$)/i, name: 'landmark-address' },
      // Pattern 12: NEW - Multi-step conversation: "alamat saya di X" or "rumah saya di X"
      { regex: /(?:alamat|rumah)\s+saya\s+(?:di\s+)?(.+?)(?:\s*,?\s*(?:hp|nik|untuk|keperluan|besok|lusa|mau|buat|bikin)|\s*[,.]|\s*$)/i, name: 'alamat-saya' },
      // Pattern 13: NEW - Direct address mention in complaint context
      { regex: /(?:di|ke)\s+(jalan|jln|jl|gang|gg|komplek|perumahan|blok)\s+([^,]+?)(?:\s+(?:ada|rusak|mati|bermasalah|tumbang|tersumbat))/i, name: 'complaint-location' },
      // Pattern 14: NEW - Address in response to location question
      { regex: /^(?:di\s+)?(.+?(?:jalan|jln|jl|gang|gg|komplek|perumahan|blok|rt|rw|no|nomor).+?)(?:\s*[,.]|\s*$)/i, name: 'location-response' },
    ];
    
    let addressFound = false;
    for (const { regex, name } of addressPatterns) {
      const match = userMessages.match(regex);
      if (match) {
        let addr = '';
        if (name === 'di-address') {
          // For "di jalan X" pattern, combine both groups
          addr = `${match[1]} ${match[2]}`.trim();
        } else {
          addr = match[1].trim();
        }
        
        // Clean up the address - remove trailing punctuation and unwanted data
        addr = addr.replace(/[,;.]+\s*$/, '').trim(); // Remove trailing comma, semicolon, period
        
        // Remove trailing phone numbers that might be captured (e.g., "gang mawar 12 rt 02 rw 03 hp 085...")
        addr = addr.replace(/\s+(?:hp|no|nomer|telp|phone)[\s:]*\d+.*$/i, '').trim();
        
        // Remove trailing NIK that might be captured
        addr = addr.replace(/\s+nik[\s:]*\d+.*$/i, '').trim();
        
        // Normalize RT/RW format: "rt05/rw02" -> "rt 05 rw 02"
        addr = addr.replace(/rt\s*(\d+)\s*\/\s*rw\s*(\d+)/gi, 'rt $1 rw $2');
        
        // Normalize "jl." to "jalan"
        addr = addr.replace(/\bjl\.\s*/gi, 'jalan ');
        
        // Normalize "gg." to "gang"
        addr = addr.replace(/\bgg\.\s*/gi, 'gang ');
        
        // Remove extra spaces
        addr = addr.replace(/\s+/g, ' ').trim();
        
        // Final cleanup: remove trailing comma again (in case normalization added it)
        addr = addr.replace(/,\s*$/, '').trim();
        
        logger.info(`🔍 Address pattern matched: ${name}`, { 
          wa_user_id, 
          pattern: name,
          rawMatch: match[0], 
          extracted: addr 
        });
        
        // Validate: should be at least 5 chars (relaxed from 8)
        if (addr.length >= 5 && addr.length <= 200) {
          // Check if it contains address indicators OR is long enough to be an address
          const hasAddressIndicators = /jalan|jln|jl|gang|gg|komplek|perumahan|blok|no|nomor|rt|rw/i.test(addr);
          const isLongEnough = addr.length >= 10; // If 10+ chars, likely an address
          
          if (hasAddressIndicators || isLongEnough) {
            result.alamat = addr;
            logger.info('✅ Address extracted from history', { 
              wa_user_id, 
              pattern: name,
              alamat: addr,
              hasIndicators: hasAddressIndicators,
              length: addr.length
            });
            addressFound = true;
            break;
          } else {
            logger.warn(`Address candidate rejected (no indicators, too short)`, { 
              wa_user_id, 
              pattern: name,
              addr, 
              length: addr.length 
            });
          }
        } else {
          logger.warn(`Address candidate rejected (length invalid)`, { 
            wa_user_id, 
            pattern: name,
            addr, 
            length: addr.length 
          });
        }
      }
    }
    
    if (!addressFound) {
      logger.warn('❌ No address match found with any pattern', { 
        wa_user_id, 
        userMessagesPreview: userMessages.substring(0, 300),
        patternsAttempted: addressPatterns.length
      });
    }
    
    // Extract keperluan (purpose) - improved to handle various formats
    const keperluanPatterns = [
      // "untuk X" or "keperluan X" - most reliable
      /(?:untuk|keperluan)\s+([a-z\s]+?)(?:,|\.|$|nik|alamat|hp|no|nama|tinggal|telp|besok|lusa)/i,
      // "buat X" (informal) - be more specific
      /buat\s+([a-z\s]+?)(?:,|\.|$|nik|alamat|hp|no|nama|tinggal|telp|besok|lusa|jam)/i,
    ];
    
    // List of service codes to exclude from keperluan
    const serviceCodes = ['SKD', 'SKU', 'SKTM', 'SKBM', 'IKR', 'SPKTP', 'SPKK', 'SPSKCK', 'SPAKTA', 'SKK', 'SPP'];
    
    for (const pattern of keperluanPatterns) {
      const match = userMessages.match(pattern);
      if (match && match[1]) {
        let keperluan = match[1].trim();
        
        // Clean up: remove trailing "nih", "ya", "kak", etc.
        keperluan = keperluan.replace(/\s+(nih|ya|kak|bang|pak|dong|sih)$/i, '').trim();
        
        // Validate: 3-100 chars, not just action words or service codes
        const invalidWords = ['bikin', 'buat', 'mau', 'ingin', 'butuh', 'perlu', 'surat', 'keterangan'];
        const isServiceCode = serviceCodes.includes(keperluan.toUpperCase());
        const isValidKeperluan = keperluan.length >= 3 && 
                                 keperluan.length <= 100 && 
                                 !invalidWords.includes(keperluan.toLowerCase()) &&
                                 !isServiceCode &&
                                 !/^(bikin|buat|mau)\s/i.test(keperluan); // Don't start with action words
        
        if (isValidKeperluan) {
          result.keperluan = keperluan;
          logger.info('✅ Keperluan extracted', { wa_user_id, keperluan });
          break;
        }
      }
    }
    
    // FALLBACK: If no address found with regex, try LLM extraction
    if (!result.alamat && userMessages.length > 0) {
      logger.info('🤖 Attempting LLM-based address extraction as fallback...', { wa_user_id });
      try {
        const llmAddress = await extractAddressWithLLM(userMessages);
        if (llmAddress) {
          result.alamat = llmAddress;
          logger.info('✅ Address extracted via LLM fallback', { wa_user_id, alamat: llmAddress });
        }
      } catch (error: any) {
        logger.warn('LLM address extraction failed', { wa_user_id, error: error.message });
      }
    }
    
    logger.info('📊 Final extraction result', { wa_user_id, result });
    return Object.keys(result).length > 0 ? result : null;
  } catch (error: any) {
    logger.warn('Failed to fetch history for citizen data extraction', { wa_user_id, error: error.message });
    return null;
  }
}

/**
 * Extract date from text like "besok", "lusa", "10 Desember 2025", etc.
 */
function extractDateFromText(text: string): string | null {
  const today = new Date();
  const cleanText = text.toLowerCase();
  
  // Handle relative dates
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
  
  // Handle "Tanggal: 10 Desember 2025" format from reply_text
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
  
  // Handle YYYY-MM-DD format
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return isoMatch[0];
  }
  
  return null;
}

/**
 * Extract time from text like "jam 9 pagi", "09:00", etc.
 */
function extractTimeFromText(text: string): string | null {
  const cleanText = text.toLowerCase();
  
  // Handle "jam X pagi/siang/sore"
  const jamMatch = cleanText.match(/jam\s*(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?/i);
  if (jamMatch) {
    let hour = parseInt(jamMatch[1]);
    const minute = jamMatch[2] ? parseInt(jamMatch[2]) : 0;
    const period = jamMatch[3]?.toLowerCase();
    
    // Adjust for period
    if (period === 'sore' && hour < 12) hour += 12;
    if (period === 'malam' && hour < 12) hour += 12;
    if (period === 'pagi' && hour === 12) hour = 0;
    
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  
  // Handle HH:MM format
  const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2]);
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  
  // Handle "X WIB" format
  const wibMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*WIB/i);
  if (wibMatch) {
    const hour = parseInt(wibMatch[1]);
    const minute = wibMatch[2] ? parseInt(wibMatch[2]) : 0;
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  
  return null;
}

/**
 * Handle reservation creation
 */
export async function handleReservationCreation(wa_user_id: string, llmResponse: any): Promise<string> {
  // Handle both old format (fields.service_code) and new 2-layer format (fields as extracted_data)
  const fields = llmResponse.fields || {};
  let { service_code, citizen_data, reservation_date, reservation_time, missing_info } = fields;
  
  // For 2-layer architecture, fields IS the extracted_data, so service_code is directly accessible
  service_code = service_code || fields.service_code;
  
  // DEBUG: Log the actual structure to understand the issue
  logger.debug('DEBUG handleReservationCreation', {
    wa_user_id,
    fieldsKeys: Object.keys(fields),
    service_code,
    service_code_type: typeof service_code,
    fields_sample: JSON.stringify(fields).substring(0, 200)
  });
  
  // Valid service codes
  const VALID_SERVICE_CODES = ['SKD', 'SKU', 'SKTM', 'SKBM', 'IKR', 'SPKTP', 'SPKK', 'SPSKCK', 'SPAKTA', 'SKK', 'SPP'];
  
  // Validate service_code - handle both string and array
  let cleanServiceCode = '';
  let isValidServiceCode = false;
  
  if (Array.isArray(service_code)) {
    // Multiple services requested - take the first valid one for now
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
  } else if (service_code) {
    // Convert to string as fallback
    cleanServiceCode = String(service_code).trim().toUpperCase();
    isValidServiceCode = VALID_SERVICE_CODES.includes(cleanServiceCode);
  }
  
  // SMART EXTRACTION: If LLM didn't fill date/time but reply_text contains them, extract!
  const replyText = llmResponse.reply_text || '';
  
  if (!reservation_date && replyText) {
    const extractedDate = extractDateFromText(replyText);
    if (extractedDate) {
      reservation_date = extractedDate;
      logger.info('Smart extraction: date from reply_text', { wa_user_id, extractedDate });
    }
  }
  
  if (!reservation_time && replyText) {
    const extractedTime = extractTimeFromText(replyText);
    if (extractedTime) {
      reservation_time = extractedTime;
      logger.info('Smart extraction: time from reply_text', { wa_user_id, extractedTime });
    }
  }
  
  // Check if we have enough information
  const hasCitizenData = citizen_data && Object.keys(citizen_data).length > 0;
  let hasRequiredCitizenData = hasCitizenData && citizen_data.nama_lengkap && citizen_data.nik;
  
  logger.info('🔍 Checking citizen_data status', { 
    wa_user_id, 
    hasCitizenData, 
    hasRequiredCitizenData,
    citizen_data_keys: citizen_data ? Object.keys(citizen_data) : [],
    citizen_data
  });
  
  // Check if reply_text indicates successful reservation (LLM thinks data is complete)
  const looksLikeSuccess = /reservasi.*berhasil|sudah.*dibuat|sudah.*diproses|✅/i.test(replyText);
  
  // ALWAYS try to extract from history if citizen_data is missing or incomplete
  // This is a fallback because LLM often doesn't fill citizen_data properly
  if (!hasRequiredCitizenData) {
    logger.info('🔍 Will attempt history extraction (citizen_data incomplete)', { wa_user_id });
    citizen_data = citizen_data || {};
    
    // Try to extract nama from reply_text
    const namaMatch = replyText.match(/Nama:\s*([^\n•]+)/i);
    if (namaMatch && !citizen_data.nama_lengkap) {
      citizen_data.nama_lengkap = namaMatch[1].trim();
      logger.info('Smart extraction: nama from reply_text', { wa_user_id, nama: citizen_data.nama_lengkap });
    }
    
    // ALWAYS fetch from conversation history to fill missing data (especially alamat!)
    // This is critical because LLM often doesn't fill citizen_data.alamat properly
    try {
      const historyData = await extractCitizenDataFromHistory(wa_user_id);
      if (historyData) {
        if (!citizen_data.nama_lengkap && historyData.nama_lengkap) {
          citizen_data.nama_lengkap = historyData.nama_lengkap;
          logger.info('Smart extraction: nama from history', { wa_user_id, nama: citizen_data.nama_lengkap });
        }
        if (!citizen_data.nik && historyData.nik) {
          citizen_data.nik = historyData.nik;
          logger.info('Smart extraction: nik from history', { wa_user_id, nik: citizen_data.nik });
        }
        if (!citizen_data.alamat && historyData.alamat) {
          citizen_data.alamat = historyData.alamat;
          logger.info('Smart extraction: alamat from history', { wa_user_id, alamat: citizen_data.alamat });
        }
        if (!citizen_data.no_hp && historyData.no_hp) {
          citizen_data.no_hp = historyData.no_hp;
          logger.info('Smart extraction: no_hp from history', { wa_user_id, no_hp: citizen_data.no_hp });
        }
        if (!citizen_data.keperluan && historyData.keperluan) {
          citizen_data.keperluan = historyData.keperluan;
          logger.info('Smart extraction: keperluan from history', { wa_user_id, keperluan: citizen_data.keperluan });
        }
      }
    } catch (err: any) {
      logger.warn('Failed to extract citizen data from history', { wa_user_id, error: err.message });
    }
    
    // Recalculate
    hasRequiredCitizenData = citizen_data.nama_lengkap && citizen_data.nik;
  }
  
  // Final check
  const finalHasCitizenData = citizen_data && Object.keys(citizen_data).length > 0;
  const finalHasRequiredCitizenData = finalHasCitizenData && citizen_data.nama_lengkap && citizen_data.nik;
  
  if (!isValidServiceCode || !finalHasRequiredCitizenData || !reservation_date || !reservation_time || (missing_info && missing_info.length > 0)) {
    logger.info('Incomplete reservation data, asking for more info', {
      wa_user_id,
      service_code,
      cleanServiceCode,
      isValidServiceCode,
      hasCitizenData: finalHasRequiredCitizenData,
      hasDate: !!reservation_date,
      hasTime: !!reservation_time,
      missingInfo: missing_info,
      looksLikeSuccess,
    });
    return llmResponse.reply_text;
  }
  
  logger.info('Creating reservation in Case Service', {
    wa_user_id,
    service_code: cleanServiceCode,
    reservation_date,
    reservation_time,
  });
  
  try {
    // Validate and clean citizen_data before sending
    const cleanedCitizenData = {
      nama_lengkap: citizen_data.nama_lengkap?.trim() || '',
      nik: citizen_data.nik?.trim() || '',
      alamat: citizen_data.alamat?.trim() || '',
      no_hp: citizen_data.no_hp?.trim() || '',
      keperluan: citizen_data.keperluan?.trim() || '',
      // Add other fields if they exist
      ...Object.fromEntries(
        Object.entries(citizen_data).filter(([key, value]) => 
          !['nama_lengkap', 'nik', 'alamat', 'no_hp', 'keperluan'].includes(key) && 
          value !== null && 
          value !== undefined && 
          value !== ''
        )
      )
    };
    
    // Log the data being sent for debugging
    logger.info('Sending reservation data to Case Service', {
      wa_user_id,
      service_code: cleanServiceCode,
      reservation_date,
      reservation_time,
      citizen_data_keys: Object.keys(cleanedCitizenData),
      citizen_data_preview: {
        nama_lengkap: cleanedCitizenData.nama_lengkap,
        nik: cleanedCitizenData.nik ? `${cleanedCitizenData.nik.substring(0, 4)}****` : '',
        alamat: cleanedCitizenData.alamat?.substring(0, 20) + '...',
        no_hp: cleanedCitizenData.no_hp ? `${cleanedCitizenData.no_hp.substring(0, 4)}****` : '',
        keperluan: cleanedCitizenData.keperluan,
      }
    });
    
    // Create reservation in Case Service (SYNC call)
    const response = await caseServiceClient.post('/reservasi/create', {
      wa_user_id,
      service_code: cleanServiceCode,
      citizen_data: cleanedCitizenData,
      reservation_date,
      reservation_time,
    });
    
    const reservation = response.data?.data;
    
    if (reservation?.reservation_id) {
      // Record success for analytics
      aiAnalyticsService.recordSuccess('CREATE_RESERVATION');
      
      // Build proactive success message
      const dateStr = new Date(reservation_date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const serviceName = reservation.service?.name || cleanServiceCode;
      
      let successMessage = `✅ Reservasi berhasil dibuat!\n\n📋 *Detail Reservasi:*\n• Nomor: ${reservation.reservation_id}\n• Layanan: ${serviceName}\n• Tanggal: ${dateStr}\n• Jam: ${reservation_time} WIB\n• Antrian: #${reservation.queue_number}\n\n`;
      
      // Add proactive reminders based on service type
      if (cleanServiceCode === 'SKD' || cleanServiceCode === 'SKTM' || cleanServiceCode === 'SKU') {
        successMessage += `📄 *Jangan lupa bawa:*\n• KTP asli + fotokopi\n• Kartu Keluarga (KK)\n• Surat Pengantar RT/RW\n\n`;
      } else if (cleanServiceCode?.startsWith('SP')) {
        successMessage += `📄 *Jangan lupa bawa:*\n• KTP asli + fotokopi\n• Dokumen pendukung lainnya\n\n`;
      }
      
      successMessage += `Sampai jumpa di kelurahan! 👋\n\n💡 Simpan nomor reservasi ini ya Kak`;
      
      return successMessage;
    } else {
      throw new Error('No reservation ID returned');
    }
  } catch (error: any) {
    // Record failure for analytics
    aiAnalyticsService.recordFailure('CREATE_RESERVATION');
    
    // Log detailed error information
    logger.error('Failed to create reservation', { 
      wa_user_id,
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
      requestData: {
        service_code: cleanServiceCode,
        reservation_date,
        reservation_time,
      }
    });
    
    // Handle specific error cases
    if (error.response?.status === 400) {
      const errorData = error.response?.data;
      
      // Check for specific validation errors
      if (errorData?.message?.includes('NIK')) {
        return `Mohon maaf Kak, format NIK tidak valid 🙏\n\nNIK harus 16 digit angka. Silakan periksa kembali NIK Kakak.\n\nMau input ulang data?`;
      }
      
      if (errorData?.message?.includes('service_code') || errorData?.message?.includes('layanan')) {
        return `Mohon maaf Kak, layanan ${cleanServiceCode} tidak tersedia saat ini 🙏\n\nSilakan pilih layanan lain atau hubungi kantor kelurahan untuk informasi lebih lanjut.`;
      }
      
      if (errorData?.message?.includes('tanggal') || errorData?.message?.includes('date')) {
        return `Mohon maaf Kak, tanggal yang dipilih tidak valid 🙏\n\nSilakan pilih tanggal yang akan datang (hari kerja: Senin-Jumat).\n\nMau pilih tanggal lain?`;
      }
      
      if (errorData?.message?.includes('jam') || errorData?.message?.includes('time')) {
        return `Mohon maaf Kak, jam yang dipilih tidak tersedia 🙏\n\nJam layanan: 08:00-15:00 (Senin-Jumat)\n\nMau pilih jam lain?`;
      }
      
      // Generic 400 error
      return `Mohon maaf Kak, ada kesalahan dalam data yang diberikan 🙏\n\nSilakan periksa kembali:\n• NIK (16 digit)\n• Tanggal (hari kerja)\n• Jam (08:00-15:00)\n\nMau coba lagi?`;
    }
    
    if (error.response?.status === 404) {
      return `Mohon maaf Kak, layanan reservasi sedang tidak tersedia 🙏\n\nSilakan:\n• Coba lagi dalam beberapa saat\n• Atau datang langsung ke kantor kelurahan\n• Hubungi: (021) 1234-5678`;
    }
    
    if (error.response?.status === 409 || error.message?.includes('tidak tersedia') || error.message?.includes('penuh')) {
      // Slot unavailable - suggest alternatives
      const dateObj = new Date(reservation_date);
      const dayName = dateObj.toLocaleDateString('id-ID', { weekday: 'long' });
      
      return `Mohon maaf Kak, slot waktu ${dayName}, ${reservation_time} WIB sudah penuh 🙏\n\n💡 *Saran:*\n• Coba jam lain di hari yang sama\n• Atau pilih hari lain\n• Atau datang langsung tanpa reservasi (mungkin perlu antri)\n\nMau saya carikan waktu lain yang tersedia?`;
    }
    
    if (error.message?.includes('libur') || error.message?.includes('tutup')) {
      return `Mohon maaf Kak, tanggal tersebut kantor kelurahan libur/tutup 🙏\n\nKantor buka Senin-Jumat, jam 08:00-15:00.\n\nMau pilih tanggal lain?`;
    }
    
    // Network or timeout errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
      return `Mohon maaf Kak, sistem sedang sibuk 🙏\n\nSilakan:\n• Coba lagi dalam 1-2 menit\n• Atau datang langsung ke kantor kelurahan\n\nJam kerja: Senin-Jumat 08:00-15:00`;
    }
    
    // Generic error
    return 'Mohon maaf Kak, terjadi kendala teknis saat membuat reservasi 🙏\n\nSilakan:\n• Coba lagi dalam beberapa saat\n• Atau hubungi kantor kelurahan langsung\n• Atau datang langsung pada jam kerja\n\nJam kerja: Senin-Jumat 08:00-15:00';
  }
}

/**
 * Handle reservation cancellation
 */
export async function handleReservationCancellation(wa_user_id: string, llmResponse: any): Promise<string> {
  const { reservation_id, cancel_reason } = llmResponse.fields;
  
  if (!reservation_id) {
    return llmResponse.reply_text || 'Mohon berikan nomor reservasi yang ingin dibatalkan (contoh: RSV-20251208-001)';
  }
  
  logger.info('Cancelling reservation', { wa_user_id, reservation_id });
  
  try {
    const response = await caseServiceClient.post(`/reservasi/${reservation_id}/cancel`, {
      wa_user_id,
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
 * Handle knowledge query - fetch relevant knowledge and do second LLM call
 */
export async function handleKnowledgeQuery(wa_user_id: string, message: string, llmResponse: any): Promise<string> {
  logger.info('Handling knowledge query', {
    wa_user_id,
    knowledgeCategory: llmResponse.fields.knowledge_category,
  });
  
  try {
    // Determine categories to search
    const categories = llmResponse.fields.knowledge_category 
      ? [llmResponse.fields.knowledge_category]
      : undefined;
    
    // Search knowledge base
    const knowledgeResult = await searchKnowledge(message, categories);
    
    if (knowledgeResult.total === 0) {
      logger.info('No knowledge found for query', {
        wa_user_id,
        query: message.substring(0, 100),
      });
      
      return 'Maaf, saya belum memiliki informasi tentang hal tersebut. Untuk informasi lebih lanjut, silakan hubungi kantor kelurahan langsung atau datang pada jam kerja.';
    }
    
    // Build context with knowledge
    const { systemPrompt } = await buildKnowledgeQueryContext(
      wa_user_id,
      message,
      knowledgeResult.context
    );
    
    // Second LLM call with knowledge context
    const knowledgeResult2 = await callGemini(systemPrompt);
    
    // If LLM fails, return fallback message
    if (!knowledgeResult2) {
      logger.warn('Knowledge query LLM failed', { wa_user_id });
      return 'Maaf, terjadi kendala teknis. Silakan coba lagi dalam beberapa saat.';
    }
    
    const { response: knowledgeResponse, metrics } = knowledgeResult2;
    
    logger.info('Knowledge query answered', {
      wa_user_id,
      knowledgeItemsUsed: knowledgeResult.total,
      durationMs: metrics.durationMs,
    });
    
    return knowledgeResponse.reply_text;
  } catch (error: any) {
    logger.error('Failed to handle knowledge query', {
      wa_user_id,
      error: error.message,
    });
    
    return 'Maaf, terjadi kesalahan saat mencari informasi. Mohon coba lagi dalam beberapa saat.';
  }
}

/**
 * Format relative time in Indonesian
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSeconds < 60) {
    return 'baru saja';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} menit yang lalu`;
  } else if (diffHours < 24) {
    return `${diffHours} jam yang lalu`;
  } else if (diffDays === 1) {
    return 'kemarin';
  } else if (diffDays < 7) {
    return `${diffDays} hari yang lalu`;
  } else {
    return date.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
}

/**
 * Format kategori to readable label
 */
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

/**
 * Format jenis tiket to readable label
 */
function formatJenisTiket(jenis: string): string {
  const jenisMap: Record<string, string> = {
    'surat_keterangan': 'Surat Keterangan',
    'surat_pengantar': 'Surat Pengantar',
    'izin_keramaian': 'Izin Keramaian',
  };
  return jenisMap[jenis] || jenis.replace(/_/g, ' ');
}

/**
 * Handle status check for complaints and reservations
 */
export async function handleStatusCheck(wa_user_id: string, llmResponse: any): Promise<string> {
  const { complaint_id, reservation_id } = llmResponse.fields;
  
  logger.info('Handling status check', {
    wa_user_id,
    complaint_id,
    reservation_id,
  });
  
  // If no ID provided, return LLM's reply (which should ask for the ID)
  if (!complaint_id && !reservation_id) {
    if (llmResponse.reply_text) {
      return llmResponse.reply_text;
    }
    return 'Halo Kak! Untuk cek status, boleh sebutkan nomornya ya (contoh: LAP-20251201-001 atau RSV-20251201-001) 📋';
  }
  
  // Check complaint status
  if (complaint_id) {
    const complaint = await getComplaintStatus(complaint_id);
    
    if (!complaint) {
      return `Hmm, kami tidak menemukan laporan dengan nomor *${complaint_id}* nih Kak 🤔\n\nCoba cek lagi ya, format nomor laporan biasanya seperti ini: LAP-20251201-001`;
    }
    
    return buildNaturalStatusResponse(complaint);
  }
  
  // Check reservation status
  if (reservation_id) {
    try {
      const response = await caseServiceClient.get(`/reservasi/${reservation_id}`);
      const reservation = response.data?.data;
      
      if (!reservation) {
        return `Hmm, kami tidak menemukan reservasi dengan nomor *${reservation_id}* nih Kak 🤔\n\nCoba cek lagi ya, format nomor reservasi biasanya seperti ini: RSV-20251201-001`;
      }
      
      return buildNaturalReservationStatusResponse(reservation);
    } catch (error) {
      return `Hmm, kami tidak menemukan reservasi dengan nomor *${reservation_id}* nih Kak 🤔\n\nCoba cek lagi ya, format nomor reservasi biasanya seperti ini: RSV-20251201-001`;
    }
  }
  
  return 'Maaf Kak, ada kendala saat mengecek status. Coba lagi ya! 🙏';
}

/**
 * Build natural response for complaint status check
 */
function buildNaturalStatusResponse(complaint: any): string {
  const updatedAt = new Date(complaint.updated_at);
  const relativeTime = formatRelativeTime(updatedAt);
  const kategoriText = formatKategori(complaint.kategori);
  const statusInfo = getStatusInfo(complaint.status);
  
  let message = `Halo Kak! 👋\n\n`;
  message += `Berikut info laporan *${complaint.complaint_id}*:\n\n`;
  message += `📌 *Jenis Laporan:* ${kategoriText}\n`;
  
  if (complaint.alamat) {
    message += `📍 *Lokasi:* ${complaint.alamat}\n`;
  }
  
  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;
  
  // Add natural status description
  message += `\n${statusInfo.description}`;
  
  if (complaint.admin_notes) {
    message += `\n\n💬 _Catatan petugas: "${complaint.admin_notes}"_`;
  }
  
  message += `\n\n🕐 _Terakhir diupdate ${relativeTime}_`;
  
  return message;
}

/**
 * Build natural response for reservation status check
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
    'no_show': { emoji: '⚠️', text: 'Tidak Hadir' },
  };
  
  const statusInfo = statusMap[reservation.status] || { emoji: '📋', text: reservation.status };
  
  let message = `Halo Kak! 👋\n\n`;
  message += `Berikut info reservasi *${reservation.reservation_id}*:\n\n`;
  message += `📌 *Layanan:* ${reservation.service?.name || 'Layanan'}\n`;
  message += `📅 *Tanggal:* ${dateStr}\n`;
  message += `🕐 *Jam:* ${reservation.reservation_time} WIB\n`;
  message += `🎫 *Nomor Antrian:* #${reservation.queue_number}\n`;
  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;
  
  if (reservation.admin_notes) {
    message += `\n💬 _Catatan petugas: "${reservation.admin_notes}"_`;
  }
  
  return message;
}

/**
 * Get status info with emoji and natural description
 */
function getStatusInfo(status: string): { emoji: string; text: string; description: string } {
  const statusMap: Record<string, { emoji: string; text: string; description: string }> = {
    'baru': {
      emoji: '🆕',
      text: 'Baru Diterima',
      description: 'Laporan Kakak baru kami terima dan akan segera kami tindak lanjuti ya!'
    },
    'pending': {
      emoji: '⏳',
      text: 'Menunggu Verifikasi',
      description: 'Saat ini sedang dalam tahap verifikasi oleh tim kami. Mohon ditunggu ya!'
    },
    'proses': {
      emoji: '🔄',
      text: 'Sedang Diproses',
      description: 'Kabar baik! Petugas kami sudah menangani laporan ini. Kami akan kabari lagi kalau sudah selesai!'
    },
    'selesai': {
      emoji: '✅',
      text: 'Selesai',
      description: 'Yeay! Laporan sudah selesai ditangani. Terima kasih sudah melapor! 🙏'
    },
    'ditolak': {
      emoji: '❌',
      text: 'Tidak Dapat Diproses',
      description: 'Mohon maaf, laporan ini tidak dapat kami proses. Silakan hubungi kantor kelurahan untuk info lebih lanjut.'
    }
  };
  
  return statusMap[status] || {
    emoji: '📋',
    text: status,
    description: 'Silakan tunggu update selanjutnya ya!'
  };
}

/**
 * Handle cancellation of complaints
 */
export async function handleCancellation(wa_user_id: string, llmResponse: any): Promise<string> {
  const { complaint_id, cancel_reason } = llmResponse.fields;
  
  logger.info('Handling cancellation request', {
    wa_user_id,
    complaint_id,
    cancel_reason,
  });
  
  // If no ID provided, return LLM's reply (which should ask for the ID)
  if (!complaint_id) {
    if (llmResponse.reply_text) {
      return llmResponse.reply_text;
    }
    return 'Halo Kak! Untuk membatalkan laporan, mohon sertakan nomornya ya (contoh: LAP-20251201-001) 📋';
  }
  
  // Cancel complaint
  const result = await cancelComplaint(complaint_id, wa_user_id, cancel_reason);
  
  if (!result.success) {
    return buildCancelErrorResponse('laporan', complaint_id, result.error, result.message);
  }
  
  return buildCancelSuccessResponse('laporan', complaint_id, result.message);
}

/**
 * Build natural response for successful cancellation
 */
function buildCancelSuccessResponse(type: 'laporan' | 'reservasi', id: string, reason: string): string {
  let message = `Halo Kak! 👋\n\n`;
  message += `✅ ${type === 'laporan' ? 'Laporan' : 'Reservasi'} *${id}* sudah berhasil dibatalkan ya.\n\n`;
  message += `📝 *Alasan:* ${reason}\n\n`;
  message += `Kalau ada yang mau dilaporkan atau direservasi lagi, langsung chat aja ya Kak! 😊`;
  
  return message;
}

/**
 * Build natural response for cancellation error
 */
function buildCancelErrorResponse(
  type: 'laporan' | 'reservasi',
  id: string,
  error?: string,
  message?: string
): string {
  const typeText = type === 'laporan' ? 'Laporan' : 'Reservasi';
  
  switch (error) {
    case 'NOT_FOUND':
      return `Hmm, kami tidak menemukan ${type} dengan nomor *${id}* nih Kak 🤔\n\nCoba cek lagi ya, format nomornya biasanya seperti ini: ${type === 'laporan' ? 'LAP-20251201-001' : 'RSV-20251201-001'}`;
    
    case 'NOT_OWNER':
      return `Maaf Kak, ${type} *${id}* ini bukan milik Kakak, jadi tidak bisa dibatalkan ya 🙏\n\nPembatalan hanya bisa dilakukan oleh orang yang membuat ${type} tersebut.`;
    
    case 'ALREADY_COMPLETED':
      return `Maaf Kak, ${type} *${id}* sudah tidak bisa dibatalkan karena statusnya sudah final (selesai/dibatalkan) 📋\n\n${message || ''}`;
    
    default:
      return `Maaf Kak, ada kendala saat membatalkan ${type}. ${message || 'Coba lagi ya!'} 🙏`;
  }
}

/**
 * Handle user history request
 */
export async function handleHistory(wa_user_id: string): Promise<string> {
  logger.info('Handling history request', { wa_user_id });
  
  const history = await getUserHistory(wa_user_id);
  
  if (!history || history.total === 0) {
    return `📋 *Riwayat Anda*\n\nBelum ada laporan atau tiket.\nKetik pesan untuk memulai.`;
  }
  
  return buildHistoryResponse(history.combined, history.total);
}

/**
 * Build natural response for user history
 */
function buildHistoryResponse(items: HistoryItem[], total: number): string {
  let message = `📋 *Riwayat Anda* (${total})\n`;
  
  // Group by type for better presentation
  const complaints = items.filter(i => i.type === 'complaint');
  const reservations = items.filter(i => i.type === 'reservation');
  
  // Show complaints first
  if (complaints.length > 0) {
    message += `\n*LAPORAN*\n`;
    for (const item of complaints.slice(0, 5)) {
      const statusEmoji = getStatusEmoji(item.status);
      const shortDesc = truncateDescription(item.description, 20);
      message += `• *${item.display_id}* ${statusEmoji}\n  ${shortDesc}\n`;
    }
    if (complaints.length > 5) {
      message += `  _+${complaints.length - 5} lainnya_\n`;
    }
  }
  
  // Show reservations
  if (reservations.length > 0) {
    message += `\n*RESERVASI*\n`;
    for (const item of reservations.slice(0, 5)) {
      const statusEmoji = getStatusEmoji(item.status);
      const shortDesc = truncateDescription(item.description, 20);
      message += `• *${item.display_id}* ${statusEmoji}\n  ${shortDesc}\n`;
    }
    if (reservations.length > 5) {
      message += `  _+${reservations.length - 5} lainnya_\n`;
    }
  }
  
  message += `\n💡 Ketik nomor untuk cek detail`;
  
  return message;
}

/**
 * Get status emoji
 */
function getStatusEmoji(status: string): string {
  const emojiMap: Record<string, string> = {
    'baru': '🆕',
    'pending': '⏳',
    'proses': '🔄',
    'selesai': '✅',
    'ditolak': '❌',
    'dibatalkan': '🔴',
  };
  return emojiMap[status] || '📌';
}

/**
 * Format status label
 */
function formatStatusLabel(status: string): string {
  const labelMap: Record<string, string> = {
    'baru': 'Baru',
    'pending': 'Pending',
    'proses': 'Sedang Diproses',
    'selesai': 'Selesai',
    'ditolak': 'Ditolak',
    'dibatalkan': 'Dibatalkan',
  };
  return labelMap[status] || status;
}

/**
 * Truncate description to specified length
 */
function truncateDescription(desc: string, maxLength: number): string {
  if (desc.length <= maxLength) return desc;
  return desc.substring(0, maxLength) + '...';
}
