import logger from '../utils/logger';
import { MessageReceivedEvent } from '../types/event.types';
import { buildContext, buildKnowledgeQueryContext } from './context-builder.service';
import { callGemini } from './llm.service';
import { createComplaint, createTicket, getComplaintStatus, getTicketStatus, cancelComplaint, cancelTicket, getUserHistory, HistoryItem } from './case-client.service';
import { publishAIReply, publishAIError } from './rabbitmq.service';
import { isAIChatbotEnabled } from './settings.service';
import { searchKnowledge, buildKnowledgeContext } from './knowledge.service';
import { startTyping, stopTyping, isUserInTakeover } from './channel-client.service';
import { rateLimiterService } from './rate-limiter.service';
import { aiAnalyticsService } from './ai-analytics.service';

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
  const { wa_user_id, message, message_id, has_media, media_url, media_public_url, media_type, media_caption } = event;
  
  logger.info('🎯 Processing message', {
    wa_user_id,
    message_id,
    messageLength: message.length,
    hasMedia: has_media,
    mediaType: media_type,
  });
  
  try {
    // Step 0: Check if AI chatbot is enabled
    const aiEnabled = await isAIChatbotEnabled();
    
    if (!aiEnabled) {
      logger.info('⏸️ AI chatbot is disabled, skipping message processing', {
        wa_user_id,
        message_id,
      });
      return; // Exit without processing or replying
    }
    
    // Step 0.1: Check if user is in takeover mode (admin handling)
    const takeover = await isUserInTakeover(wa_user_id);
    
    if (takeover) {
      logger.info('👤 User is in takeover mode, admin will handle this message', {
        wa_user_id,
        message_id,
      });
      return; // Exit - admin is handling this conversation
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
        
        await publishAIReply({ wa_user_id, reply_text: finalReply });
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
          
          await publishAIReply({ wa_user_id, reply_text: finalReply });
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
    
    // Step 1: Build context (fetch history + format prompt)
    const { systemPrompt, messageCount } = await buildContext(wa_user_id, message);
    
    logger.debug('Context built', {
      wa_user_id,
      historyMessages: messageCount,
    });
    
    // Step 2: Call LLM for initial intent detection
    const { response: llmResponse, metrics } = await callGemini(systemPrompt);
    
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
      
      case 'CREATE_TICKET':
        finalReplyText = await handleTicketCreation(wa_user_id, llmResponse);
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
        // Need to fetch knowledge and do second LLM call
        finalReplyText = await handleKnowledgeQuery(wa_user_id, message, llmResponse);
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
    
    // Step 4: Publish AI reply event (for Notification Service)
    // Include guidance_text if present - it will be sent as a separate bubble
    await publishAIReply({
      wa_user_id,
      reply_text: finalReplyText,
      guidance_text: guidanceText || undefined,
    });
    
    logger.info('✅ Message processed successfully', {
      wa_user_id,
      message_id,
      intent: llmResponse.intent,
      hasGuidance: !!guidanceText,
    });
  } catch (error: any) {
    // Stop typing indicator on error
    await stopTyping(wa_user_id);
    
    logger.error('❌ Failed to process message', {
      wa_user_id,
      message_id,
      error: error.message,
    });
    
    // DON'T send error message to user - let admin handle via dashboard
    // Instead, publish error status event for channel service to update conversation
    await publishAIError({
      wa_user_id,
      error_message: error.message || 'Unknown error',
    });
  }
}

/**
 * Handle complaint creation
 */
async function handleComplaintCreation(wa_user_id: string, llmResponse: any, currentMessage: string, mediaUrl?: string): Promise<string> {
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
      // Look for patterns like "di Jalan X", "di komplek Y", "di margahayu", etc.
      const addressRegex = /(?:di\s+)?(jalan|jln|jl\.?|komplek|perumahan|gang|gg\.)\s+[a-zA-Z0-9\s]+(?:\s+(?:no|nomor|rt|rw|blok)[\s\.]*[\d\/a-zA-Z]+)*/i;
      const match = currentMessage.match(addressRegex);
      
      if (match) {
        alamat = match[0].trim();
        logger.info('Smart alamat detection: extracted address from complaint message', {
          wa_user_id,
          originalMessage: currentMessage.substring(0, 50),
          detectedAlamat: alamat,
        });
      } else {
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
    return `✅ Terima kasih! Laporan Anda telah kami terima dengan nomor ${complaintId}.${withPhoto}\n\nPetugas akan segera menindaklanjuti laporan Anda di ${alamat}.`;
  } else {
    // Record failure for analytics
    aiAnalyticsService.recordFailure('CREATE_COMPLAINT');
    // DON'T send error to user - throw error to trigger AI error event for dashboard handling
    throw new Error('Failed to create complaint in Case Service');
  }
}

/**
 * Handle ticket creation
 */
async function handleTicketCreation(wa_user_id: string, llmResponse: any): Promise<string> {
  const { jenis, deskripsi } = llmResponse.fields;
  
  // Check if we have enough information
  if (!jenis) {
    logger.info('Incomplete ticket data, asking for more info', {
      wa_user_id,
      hasJenis: !!jenis,
    });
    return llmResponse.reply_text;
  }
  
  // Use deskripsi from LLM, or construct from jenis if empty
  const finalDeskripsi = deskripsi || jenis.replace(/_/g, ' ');
  
  logger.info('Creating ticket in Case Service', {
    wa_user_id,
    jenis,
    deskripsi: finalDeskripsi,
  });
  
  // Create ticket in Case Service (SYNC call)
  const ticketId = await createTicket({
    wa_user_id,
    jenis,
    data_json: { deskripsi: finalDeskripsi },
  });
  
  if (ticketId) {
    // Record success for analytics
    aiAnalyticsService.recordSuccess('CREATE_TICKET');
    return `🎫 Tiket Anda telah dibuat dengan nomor ${ticketId}.\n\nPetugas kami akan segera memproses permintaan Anda.`;
  } else {
    // Record failure for analytics
    aiAnalyticsService.recordFailure('CREATE_TICKET');
    // DON'T send error to user - throw error to trigger AI error event for dashboard handling
    throw new Error('Failed to create ticket in Case Service');
  }
}

/**
 * Handle knowledge query - fetch relevant knowledge and do second LLM call
 */
async function handleKnowledgeQuery(wa_user_id: string, message: string, llmResponse: any): Promise<string> {
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
    const { response: knowledgeResponse, metrics } = await callGemini(systemPrompt);
    
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
 * Handle status check for complaints and tickets
 */
async function handleStatusCheck(wa_user_id: string, llmResponse: any): Promise<string> {
  const { complaint_id, ticket_id } = llmResponse.fields;
  
  logger.info('Handling status check', {
    wa_user_id,
    complaint_id,
    ticket_id,
  });
  
  // If no ID provided, return LLM's reply (which should ask for the ID)
  if (!complaint_id && !ticket_id) {
    if (llmResponse.reply_text) {
      return llmResponse.reply_text;
    }
    return 'Halo Kak! Untuk cek status, boleh sebutkan nomor laporannya ya (contoh: LAP-20251201-001) 📋';
  }
  
  // Check complaint status
  if (complaint_id) {
    const complaint = await getComplaintStatus(complaint_id);
    
    if (!complaint) {
      return `Hmm, kami tidak menemukan laporan dengan nomor *${complaint_id}* nih Kak 🤔\n\nCoba cek lagi ya, format nomor laporan biasanya seperti ini: LAP-20251201-001`;
    }
    
    return buildNaturalStatusResponse(complaint);
  }
  
  // Check ticket status
  if (ticket_id) {
    const ticket = await getTicketStatus(ticket_id);
    
    if (!ticket) {
      return `Hmm, kami tidak menemukan tiket dengan nomor *${ticket_id}* nih Kak 🤔\n\nCoba cek lagi ya, format nomor tiket biasanya seperti ini: TIK-20251201-001`;
    }
    
    return buildNaturalTicketStatusResponse(ticket);
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
 * Build natural response for ticket status check
 */
function buildNaturalTicketStatusResponse(ticket: any): string {
  const updatedAt = new Date(ticket.updated_at);
  const relativeTime = formatRelativeTime(updatedAt);
  const jenisText = formatJenisTiket(ticket.jenis);
  const statusInfo = getStatusInfo(ticket.status);
  
  let message = `Halo Kak! 👋\n\n`;
  message += `Berikut info tiket *${ticket.ticket_id}*:\n\n`;
  message += `📌 *Jenis:* ${jenisText}\n`;
  
  // Extract deskripsi from data_json if available
  if (ticket.data_json && typeof ticket.data_json === 'object') {
    const dataJson = ticket.data_json as Record<string, any>;
    if (dataJson.deskripsi) {
      message += `📄 *Keterangan:* ${dataJson.deskripsi}\n`;
    }
  }
  
  message += `\n${statusInfo.emoji} *Status:* ${statusInfo.text}\n`;
  message += `\n${statusInfo.description}`;
  
  if (ticket.admin_notes) {
    message += `\n\n💬 _Catatan petugas: "${ticket.admin_notes}"_`;
  }
  
  message += `\n\n🕐 _Terakhir diupdate ${relativeTime}_`;
  
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
 * Handle cancellation of complaints and tickets
 */
async function handleCancellation(wa_user_id: string, llmResponse: any): Promise<string> {
  const { complaint_id, ticket_id, cancel_reason } = llmResponse.fields;
  
  logger.info('Handling cancellation request', {
    wa_user_id,
    complaint_id,
    ticket_id,
    cancel_reason,
  });
  
  // If no ID provided, return LLM's reply (which should ask for the ID)
  if (!complaint_id && !ticket_id) {
    if (llmResponse.reply_text) {
      return llmResponse.reply_text;
    }
    return 'Halo Kak! Untuk membatalkan laporan/tiket, mohon sertakan nomornya ya (contoh: LAP-20251201-001 atau TIK-20251201-001) 📋';
  }
  
  // Cancel complaint
  if (complaint_id) {
    const result = await cancelComplaint(complaint_id, wa_user_id, cancel_reason);
    
    if (!result.success) {
      return buildCancelErrorResponse('laporan', complaint_id, result.error, result.message);
    }
    
    return buildCancelSuccessResponse('laporan', complaint_id, result.message);
  }
  
  // Cancel ticket
  if (ticket_id) {
    const result = await cancelTicket(ticket_id, wa_user_id, cancel_reason);
    
    if (!result.success) {
      return buildCancelErrorResponse('tiket', ticket_id, result.error, result.message);
    }
    
    return buildCancelSuccessResponse('tiket', ticket_id, result.message);
  }
  
  return 'Maaf Kak, ada kendala saat memproses pembatalan. Coba lagi ya! 🙏';
}

/**
 * Build natural response for successful cancellation
 */
function buildCancelSuccessResponse(type: 'laporan' | 'tiket', id: string, reason: string): string {
  let message = `Halo Kak! 👋\n\n`;
  message += `✅ ${type === 'laporan' ? 'Laporan' : 'Tiket'} *${id}* sudah berhasil dibatalkan ya.\n\n`;
  message += `📝 *Alasan:* ${reason}\n\n`;
  message += `Kalau ada yang mau dilaporkan atau diajukan lagi, langsung chat aja ya Kak! 😊`;
  
  return message;
}

/**
 * Build natural response for cancellation error
 */
function buildCancelErrorResponse(
  type: 'laporan' | 'tiket',
  id: string,
  error?: string,
  message?: string
): string {
  const typeText = type === 'laporan' ? 'Laporan' : 'Tiket';
  
  switch (error) {
    case 'NOT_FOUND':
      return `Hmm, kami tidak menemukan ${type} dengan nomor *${id}* nih Kak 🤔\n\nCoba cek lagi ya, format nomornya biasanya seperti ini: ${type === 'laporan' ? 'LAP-20251201-001' : 'TIK-20251201-001'}`;
    
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
async function handleHistory(wa_user_id: string): Promise<string> {
  logger.info('Handling history request', { wa_user_id });
  
  const history = await getUserHistory(wa_user_id);
  
  if (!history || history.total === 0) {
    return `📋 *Riwayat Laporan*\n\nBelum ada riwayat laporan atau tiket.\n\nMau lapor masalah? Langsung chat aja!`;
  }
  
  return buildHistoryResponse(history.combined, history.total);
}

/**
 * Build natural response for user history
 */
function buildHistoryResponse(items: HistoryItem[], total: number): string {
  let message = `📋 *Riwayat Laporan* (${total} total)\n\n`;
  
  // Group by type for better presentation
  const complaints = items.filter(i => i.type === 'complaint');
  const tickets = items.filter(i => i.type === 'ticket');
  
  let index = 1;
  
  // Show complaints first
  if (complaints.length > 0) {
    message += `*LAPORAN:*\n`;
    for (const item of complaints.slice(0, 10)) { // Limit to 10 per type
      const statusEmoji = getStatusEmoji(item.status);
      const shortDesc = truncateDescription(item.description, 25);
      message += `${index}. ${item.display_id}\n`;
      message += `   📍 ${shortDesc}\n`;
      message += `   ${statusEmoji} ${formatStatusLabel(item.status)}\n`;
      index++;
    }
    if (complaints.length > 10) {
      message += `   ... dan ${complaints.length - 10} laporan lainnya\n`;
    }
    message += `\n`;
  }
  
  // Show tickets
  if (tickets.length > 0) {
    message += `*TIKET LAYANAN:*\n`;
    for (const item of tickets.slice(0, 10)) { // Limit to 10 per type
      const statusEmoji = getStatusEmoji(item.status);
      const shortDesc = truncateDescription(item.description, 25);
      message += `${index}. ${item.display_id}\n`;
      message += `   📍 ${shortDesc}\n`;
      message += `   ${statusEmoji} ${formatStatusLabel(item.status)}\n`;
      index++;
    }
    if (tickets.length > 10) {
      message += `   ... dan ${tickets.length - 10} tiket lainnya\n`;
    }
    message += `\n`;
  }
  
  message += `💡 *Tips:* Ketik "cek status [nomor]" untuk melihat detail, contoh: _cek status LAP-20251201-001_`;
  
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
