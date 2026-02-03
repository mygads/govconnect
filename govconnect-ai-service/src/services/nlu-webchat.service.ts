/**
 * NLU Webchat Service
 * 
 * Webchat processor using NLU-based intent detection
 * Mirrors the WhatsApp NLU processor but adapted for HTTP sync flow
 */

import logger from '../utils/logger';
import { callNLU, quickIntentCheck, NLUInput, NLUOutput } from './nlu-llm.service';
import { handleContactQuery, mapKeywordToCategory } from './contact-handler.service';
import { searchKnowledge, getKelurahanInfoContext } from './knowledge.service';
import { sanitizeUserInput } from './context-builder.service';
import { applyTypoCorrections } from './text-normalizer.service';
import { getImportantContacts, ImportantContact } from './important-contacts.service';
import { ProcessMessageResult } from './unified-message-processor.service';
import { getProfile, updateProfile } from './user-profile.service';
import { updateConversationUserProfile } from './channel-client.service';
import { sanitizeFakeLinks } from './anti-hallucination.service';
import { 
  handleComplaintCreation,
  handleServiceInfo,
  handleServiceRequestCreation,
  handleStatusCheck,
  handleCancellation,
  handleHistory,
  handleKnowledgeQuery,
} from './unified-message-processor.service';
import axios from 'axios';
import { config } from '../config/env';

// ==================== PENDING NAME REQUEST ====================
// Store pending intents when waiting for user's name
interface PendingNameRequest {
  intent: string;
  nluOutput: NLUOutput;
  context: ProcessingContext;
  timestamp: number;
}

const pendingNameRequests = new Map<string, PendingNameRequest>();

// ==================== PENDING PHONE REQUEST (for webchat complaints) ====================
// Store pending intents when waiting for user's phone number
interface PendingPhoneRequest {
  intent: string;
  nluOutput: NLUOutput;
  context: ProcessingContext;
  timestamp: number;
}

const pendingPhoneRequests = new Map<string, PendingPhoneRequest>();

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup old pending requests periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, pending] of pendingNameRequests.entries()) {
    if (now - pending.timestamp > REQUEST_TIMEOUT_MS) {
      pendingNameRequests.delete(userId);
      logger.debug('Cleaned up expired pending name request', { userId });
    }
  }
  for (const [userId, pending] of pendingPhoneRequests.entries()) {
    if (now - pending.timestamp > REQUEST_TIMEOUT_MS) {
      pendingPhoneRequests.delete(userId);
      logger.debug('Cleaned up expired pending phone request', { userId });
    }
  }
}, 60000); // Check every minute

// Intents that require user name before proceeding
const INTENTS_REQUIRING_NAME = ['CREATE_COMPLAINT', 'CREATE_SERVICE_REQUEST'];

// Intents that require phone number for webchat (pengaduan only - layanan uses form)
const INTENTS_REQUIRING_PHONE_WEBCHAT = ['CREATE_COMPLAINT'];

/**
 * Check if user needs to provide name before proceeding with intent
 */
function needsNameForIntent(userId: string, intent: string): boolean {
  if (!INTENTS_REQUIRING_NAME.includes(intent)) {
    return false;
  }
  
  const profile = getProfile(userId);
  return !profile.nama_lengkap;
}

/**
 * Check if user needs to provide phone for webchat complaint
 * Note: Layanan tidak perlu karena user akan mengisi via form
 */
function needsPhoneForWebchatIntent(userId: string, intent: string): boolean {
  if (!INTENTS_REQUIRING_PHONE_WEBCHAT.includes(intent)) {
    return false;
  }
  
  const profile = getProfile(userId);
  return !profile.no_hp;
}

/**
 * Try to extract phone number from message
 */
function extractPhoneFromMessage(message: string): string | null {
  // Indonesian phone patterns: 08xx, +62xx, 62xx
  const patterns = [
    /(?:^\+?62|^0)8\d{8,11}$/,  // Full match
    /(?:\+?62|0)(8\d{8,11})/,   // Extract from text
  ];
  
  const cleanMessage = message.replace(/[\s\-\.]/g, '').trim();
  
  for (const pattern of patterns) {
    const match = cleanMessage.match(pattern);
    if (match) {
      let phone = match[1] || match[0];
      // Normalize to 08xx format
      phone = phone.replace(/^\+?62/, '0');
      if (phone.startsWith('8')) phone = '0' + phone;
      if (/^08\d{8,11}$/.test(phone)) {
        return phone;
      }
    }
  }
  return null;
}

/**
 * Try to extract name from user message (simple patterns)
 */
function extractNameFromMessage(message: string): string | null {
  const patterns = [
    /^(?:nama\s+(?:saya|aku|gue|gw)\s+(?:adalah\s+)?)?([A-Za-z][A-Za-z\s]{1,29})$/i,
    /^([A-Za-z][A-Za-z\s]{1,29})$/i, // Just a name
  ];
  
  const cleanMessage = message.trim();
  for (const pattern of patterns) {
    const match = cleanMessage.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Validate it's a reasonable name (not common words)
      const commonWords = ['ya', 'tidak', 'oke', 'ok', 'baik', 'siap', 'halo', 'hai', 'hi', 'iya', 'enggak', 'gak'];
      if (!commonWords.includes(name.toLowerCase()) && name.length >= 2) {
        return name;
      }
    }
  }
  return null;
}

interface WebchatNLUInput {
  userId: string;
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  village_id?: string;
}

interface ProcessingContext {
  village_id: string;
  user_id: string;
  message: string;
  rag_context?: string;
  conversation_history?: string;
  village_profile?: any;
  available_contact_categories?: string[];
  available_services?: Array<{ name: string; slug: string }>;
}

/**
 * Process webchat message using NLU
 */
export async function processWebchatWithNLU(params: WebchatNLUInput): Promise<ProcessMessageResult> {
  const startTime = Date.now();
  const { userId, message, conversationHistory, village_id } = params;

  const resolvedVillageId = village_id || process.env.DEFAULT_VILLAGE_ID || '';

  logger.info('🧠 Processing webchat with NLU', {
    userId,
    messageLength: message.length,
    village_id: resolvedVillageId,
  });

  try {
    // Step 1: Sanitize and preprocess
    let sanitizedMessage = sanitizeUserInput(message);
    sanitizedMessage = applyTypoCorrections(sanitizedMessage);

    // Step 1.5: Check if we're waiting for user's name
    const pendingNameRequest = pendingNameRequests.get(userId);
    if (pendingNameRequest) {
      // Try to extract name from this message
      const extractedName = extractNameFromMessage(sanitizedMessage) || 
        pendingNameRequest.nluOutput.extracted_data?.nama_lengkap;
      
      if (extractedName) {
        // Save the name to profile
        updateProfile(userId, { nama_lengkap: extractedName });
        // Also update conversation profile in channel-service
        await updateConversationUserProfile(userId, { user_name: extractedName }, resolvedVillageId, 'WEBCHAT');
        logger.info('✅ User name saved from pending request', { userId, nama: extractedName });
        
        // Remove pending name request
        pendingNameRequests.delete(userId);
        
        // Update context with name
        if (pendingNameRequest.nluOutput.extracted_data) {
          pendingNameRequest.nluOutput.extracted_data.nama_lengkap = extractedName;
        }
        
        // For webchat complaints, also need phone number
        if (pendingNameRequest.intent === 'CREATE_COMPLAINT' && needsPhoneForWebchatIntent(userId, 'CREATE_COMPLAINT')) {
          // Store pending phone request
          pendingPhoneRequests.set(userId, {
            intent: pendingNameRequest.intent,
            nluOutput: pendingNameRequest.nluOutput,
            context: pendingNameRequest.context,
            timestamp: Date.now(),
          });
          
          logger.info('📱 Phone required for webchat complaint, asking user', { userId });
          
          return {
            success: true,
            response: `Terima kasih, ${extractedName}.\n\nUntuk pengaduan via webchat, mohon cantumkan nomor WhatsApp/telepon yang bisa dihubungi agar petugas dapat menindaklanjuti laporan Anda.`,
            intent: 'ASK_PHONE',
            metadata: {
              processingTimeMs: Date.now() - startTime,
              model: 'nlu',
              hasKnowledge: !!pendingNameRequest.context.rag_context,
            },
          };
        }
        
        // Now proceed with the original intent
        const response = await handleNLUIntent(pendingNameRequest.nluOutput, pendingNameRequest.context);
        
        return {
          success: true,
          response: `Terima kasih, ${extractedName}.\n\n${response}`,
          intent: pendingNameRequest.intent,
          metadata: {
            processingTimeMs: Date.now() - startTime,
            model: 'nlu',
            hasKnowledge: !!pendingNameRequest.context.rag_context,
          },
        };
      } else {
        // User didn't provide a valid name, ask again
        return {
          success: true,
          response: 'Mohon maaf, saya tidak menangkap nama Anda. Boleh disebutkan nama lengkap Anda?',
          intent: 'ASK_NAME',
          metadata: {
            processingTimeMs: Date.now() - startTime,
            model: 'pending-name',
            hasKnowledge: false,
          },
        };
      }
    }

    // Step 1.6: Check if we're waiting for user's phone (webchat complaint only)
    const pendingPhoneRequest = pendingPhoneRequests.get(userId);
    if (pendingPhoneRequest) {
      // Try to extract phone from this message
      const extractedPhone = extractPhoneFromMessage(sanitizedMessage);
      
      if (extractedPhone) {
        // Save the phone to profile
        updateProfile(userId, { no_hp: extractedPhone });
        // Also update conversation profile in channel-service
        await updateConversationUserProfile(userId, { user_phone: extractedPhone }, resolvedVillageId, 'WEBCHAT');
        logger.info('✅ User phone saved from pending request', { userId, phone: extractedPhone });
        
        // Remove pending phone request
        pendingPhoneRequests.delete(userId);
        
        // Update context with phone
        if (pendingPhoneRequest.nluOutput.extracted_data) {
          pendingPhoneRequest.nluOutput.extracted_data.no_hp = extractedPhone;
        }
        
        // Now proceed with the original intent (complaint creation)
        const response = await handleNLUIntent(pendingPhoneRequest.nluOutput, pendingPhoneRequest.context);
        
        const profile = getProfile(userId);
        const userName = profile.nama_lengkap || 'Bapak/Ibu';
        
        return {
          success: true,
          response: `Terima kasih ${userName}, nomor ${extractedPhone} sudah kami catat.\n\n${response}`,
          intent: pendingPhoneRequest.intent,
          metadata: {
            processingTimeMs: Date.now() - startTime,
            model: 'nlu',
            hasKnowledge: !!pendingPhoneRequest.context.rag_context,
          },
        };
      } else {
        // User didn't provide a valid phone, ask again
        return {
          success: true,
          response: 'Mohon maaf, format nomor telepon tidak valid. Silakan masukkan nomor WhatsApp/HP Anda (contoh: 08123456789).',
          intent: 'ASK_PHONE',
          metadata: {
            processingTimeMs: Date.now() - startTime,
            model: 'pending-phone',
            hasKnowledge: false,
          },
        };
      }
    }

    // Step 2: Quick intent check (no LLM needed for simple patterns)
    const quickResult = quickIntentCheck(sanitizedMessage);
    if (quickResult && quickResult.confidence && quickResult.confidence >= 0.9) {
      const response = await handleQuickIntent(quickResult as NLUOutput, {
        village_id: resolvedVillageId,
        user_id: userId,
        message: sanitizedMessage,
      });

      return {
        success: true,
        response,
        intent: quickResult.intent || 'QUICK',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          model: 'quick-pattern',
          hasKnowledge: false,
        },
      };
    }

    // Step 3: Collect context
    const context = await collectContext({
      village_id: resolvedVillageId,
      user_id: userId,
      message: sanitizedMessage,
      conversationHistory,
    });

    // Step 4: Call NLU LLM
    const nluInput: NLUInput = {
      message: sanitizedMessage,
      wa_user_id: userId, // Used for logging
      village_id: resolvedVillageId,
      rag_context: context.rag_context,
      conversation_history: context.conversation_history,
      available_contact_categories: context.available_contact_categories,
      available_services: context.available_services,
    };

    const nluOutput = await callNLU(nluInput);

    if (!nluOutput) {
      logger.warn('NLU failed for webchat, using fallback');
      return {
        success: false,
        response: 'Mohon maaf, terjadi kendala teknis. Silakan coba beberapa saat lagi.',
        intent: 'ERROR',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          model: 'fallback',
          hasKnowledge: false,
        },
      };
    }

    logger.info('✅ NLU webchat result', {
      userId,
      intent: nluOutput.intent,
      confidence: nluOutput.confidence,
    });

    // Step 4.5: Check if intent requires name and user hasn't provided one
    // First check if NLU extracted a name from current message
    if (nluOutput.extracted_data?.nama_lengkap) {
      updateProfile(userId, { nama_lengkap: nluOutput.extracted_data.nama_lengkap });
      // Also update conversation profile in channel-service
      await updateConversationUserProfile(userId, { user_name: nluOutput.extracted_data.nama_lengkap }, resolvedVillageId, 'WEBCHAT');
      logger.info('✅ User name extracted from NLU', { userId, nama: nluOutput.extracted_data.nama_lengkap });
    }
    
    // Now check if we need name for this intent
    if (needsNameForIntent(userId, nluOutput.intent)) {
      // Store pending request and ask for name
      pendingNameRequests.set(userId, {
        intent: nluOutput.intent,
        nluOutput,
        context,
        timestamp: Date.now(),
      });
      
      logger.info('📝 Name required for intent, asking user', { 
        userId, 
        intent: nluOutput.intent,
      });
      
      const intentLabel = nluOutput.intent === 'CREATE_COMPLAINT' ? 'pengaduan' : 'pengajuan layanan';
      return {
        success: true,
        response: `Sebelum melanjutkan ${intentLabel}, boleh saya tahu nama lengkap Bapak/Ibu?`,
        intent: 'ASK_NAME',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          model: 'nlu',
          hasKnowledge: !!context.rag_context,
        },
      };
    }

    // Step 4.6: Check if webchat complaint needs phone number
    // Note: Layanan tidak perlu karena user akan mengisi form online
    if (needsPhoneForWebchatIntent(userId, nluOutput.intent)) {
      // Store pending phone request
      pendingPhoneRequests.set(userId, {
        intent: nluOutput.intent,
        nluOutput,
        context,
        timestamp: Date.now(),
      });
      
      const profile = getProfile(userId);
      const userName = profile.nama_lengkap || 'Bapak/Ibu';
      
      logger.info('📱 Phone required for webchat complaint, asking user', { 
        userId, 
        intent: nluOutput.intent,
      });
      
      return {
        success: true,
        response: `Baik ${userName}, untuk pengaduan via webchat mohon cantumkan nomor WhatsApp/telepon yang bisa dihubungi agar petugas dapat menindaklanjuti laporan Anda.`,
        intent: 'ASK_PHONE',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          model: 'nlu',
          hasKnowledge: !!context.rag_context,
        },
      };
    }

    // Step 5: Handle based on NLU intent
    const rawResponse = await handleNLUIntent(nluOutput, context);
    
    // Sanitize response to remove any hallucinated fake links
    const response = sanitizeFakeLinks(rawResponse);

    return {
      success: true,
      response,
      intent: nluOutput.intent,
      metadata: {
        processingTimeMs: Date.now() - startTime,
        model: 'nlu',
        hasKnowledge: !!context.rag_context,
        knowledgeConfidence: String(nluOutput.confidence),
        sentiment: 'neutral',
      },
    };

  } catch (error: any) {
    logger.error('❌ NLU webchat error', { error: error.message });
    return {
      success: false,
      response: 'Mohon maaf, terjadi kendala teknis. Silakan coba beberapa saat lagi.',
      intent: 'ERROR',
      metadata: {
        processingTimeMs: Date.now() - startTime,
        model: 'error',
        hasKnowledge: false,
      },
    };
  }
}

/**
 * Collect context for NLU
 */
async function collectContext(params: {
  village_id: string;
  user_id: string;
  message: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<ProcessingContext> {
  const { village_id, user_id, message, conversationHistory } = params;

  // Get village info and profile
  let villageProfile: any = null;
  let contactCategories: string[] = [];
  let services: Array<{ name: string; slug: string }> = [];

  if (village_id) {
    try {
      const villageInfo = await getKelurahanInfoContext(village_id);
      villageProfile = villageInfo;

      // Get contact categories from dashboard
      const contacts = await getImportantContacts(village_id);
      const categories = new Set<string>();
      contacts?.forEach((c: ImportantContact) => {
        if (c.category?.name) categories.add(c.category.name);
      });
      contactCategories = Array.from(categories);

      // Get available services
      const serviceResp = await axios.get(`${config.caseServiceUrl}/services`, {
        params: { village_id },
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 5000,
      }).catch(() => null);

      if (serviceResp?.data?.data) {
        services = serviceResp.data.data.map((s: any) => ({
          name: s.name || '',
          slug: s.slug || '',
        }));
      }
    } catch (error: any) {
      logger.warn('Failed to get village context', { error: error.message });
    }
  }

  // Get RAG context - ALWAYS collect for better context understanding
  let ragContext = '';
  if (message) {
    const ragResult = await searchKnowledge(message, [], village_id || '');
    ragContext = ragResult?.context || '';
  }

  // Build conversation history string
  let historyString = '';
  if (conversationHistory && conversationHistory.length > 0) {
    historyString = conversationHistory
      .slice(-30) // FIFO 30 messages
      .map((h) => `${h.role === 'user' ? 'User' : 'AI'}: ${h.content}`)
      .join('\n');
  }

  return {
    village_id: village_id || '',
    user_id: user_id || '',
    message: message || '',
    rag_context: ragContext,
    conversation_history: historyString,
    village_profile: villageProfile,
    available_contact_categories: contactCategories,
    available_services: services,
  };
}

/**
 * Handle quick intent (simple patterns, no LLM needed)
 */
async function handleQuickIntent(
  nlu: NLUOutput,
  params: { village_id: string; user_id: string; message: string }
): Promise<string> {
  switch (nlu.intent) {
    case 'GREETING':
      return 'Halo! 👋 Ada yang bisa saya bantu hari ini?';

    case 'THANKS':
      return 'Sama-sama! Senang bisa membantu. Jika ada pertanyaan lain, jangan ragu untuk bertanya 😊';

    case 'CONFIRMATION':
      if (nlu.confirmation?.is_positive) {
        return 'Baik, siap! Ada yang bisa saya bantu selanjutnya?';
      }
      return 'Baik, tidak masalah. Ada hal lain yang bisa saya bantu?';

    case 'CHECK_STATUS':
      if (nlu.extracted_data?.tracking_number) {
        const llmLike = {
          intent: 'CHECK_STATUS',
          fields: {
            tracking_number: nlu.extracted_data.tracking_number,
          },
        };
        return await handleStatusCheck(params.user_id, 'webchat', llmLike, params.message);
      }
      return 'Silakan berikan nomor tracking (format: LAP-XXXXXXXX-XXX atau LAY-XXXXXXXX-XXX) untuk cek status.';

    default:
      return 'Ada yang bisa saya bantu?';
  }
}

/**
 * Handle NLU intent with full context
 */
async function handleNLUIntent(nlu: NLUOutput, context: ProcessingContext): Promise<string> {
  const { village_id, user_id, message, village_profile } = context;
  const villageName = village_profile?.name || 'Desa';

  logger.info('🎯 Handling NLU webchat intent', {
    intent: nlu.intent,
    confidence: nlu.confidence,
    village_id,
    extractedName: nlu.extracted_data?.nama_lengkap,
  });

  switch (nlu.intent) {
    case 'GREETING': {
      // Check if user introduced themselves
      const userName = nlu.extracted_data?.nama_lengkap;
      if (userName) {
        return `Halo, ${userName}! 👋 Selamat datang di layanan ${villageName}. Ada yang bisa saya bantu?`;
      }
      return 'Halo! 👋 Ada yang bisa saya bantu hari ini?';
    }

    case 'THANKS':
      return 'Sama-sama! Senang bisa membantu. Jika ada pertanyaan lain, jangan ragu untuk bertanya 😊';

    case 'CONFIRMATION':
      if (nlu.confirmation?.is_positive) {
        return 'Baik, siap! Ada yang bisa saya bantu selanjutnya?';
      }
      return 'Baik, tidak masalah. Ada hal lain yang bisa saya bantu?';

    case 'ASK_ABOUT_CONVERSATION' as any: {
      // Answer questions about previous conversation from history
      const knowledgeReq = (nlu as any).knowledge_request;
      if (knowledgeReq?.suggested_answer) {
        return knowledgeReq.suggested_answer;
      }
      // Fallback if NLU didn't provide answer
      return 'Mohon maaf, saya tidak dapat mengingat detail percakapan sebelumnya. Bisakah Anda mengulangi pertanyaan atau informasi yang dimaksud?';
    }

    case 'ASK_CONTACT' as any: {
      // Ensure category_match is set - support both old and new format
      const contactRequest = (nlu as any).contact_request;
      if (contactRequest && !contactRequest.category_match && contactRequest.category_keyword) {
        contactRequest.category_match = mapKeywordToCategory(contactRequest.category_keyword) || undefined;
      }
      
      const contactResult = await handleContactQuery(nlu as any, village_id, villageName, 'webchat');
      return contactResult.response;
    }

    case 'ASK_ADDRESS' as any: {
      if (!village_profile?.address && !village_profile?.gmaps_url) {
        return 'Mohon maaf, informasi alamat kantor belum tersedia.';
      }
      if (village_profile?.address && village_profile?.gmaps_url) {
        return `Alamat Kantor ${villageName}: ${village_profile.address}\n\nLokasi Google Maps:\n${village_profile.gmaps_url}`;
      }
      return `Alamat Kantor ${villageName}: ${village_profile?.address || village_profile?.gmaps_url}`;
    }

    case 'ASK_HOURS' as any: {
      const hours = village_profile?.operating_hours;
      if (!hours || Object.keys(hours).length === 0) {
        return 'Mohon maaf, informasi jam operasional kantor belum tersedia.';
      }
      const dayOrder = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];
      const dayLabels: Record<string, string> = {
        senin: 'Senin', selasa: 'Selasa', rabu: 'Rabu', kamis: 'Kamis',
        jumat: 'Jumat', sabtu: 'Sabtu', minggu: 'Minggu'
      };
      const lines = ['Jam operasional kantor:'];
      for (const day of dayOrder) {
        const schedule = (hours as Record<string, any>)[day];
        const dayLabel = dayLabels[day] || day.charAt(0).toUpperCase() + day.slice(1);
        // Check if it's a holiday (marked with '-')
        if (schedule?.open === '-' || schedule?.close === '-') {
          lines.push(`${dayLabel}: Libur`);
        } else if (schedule?.open && schedule?.close) {
          lines.push(`${dayLabel}: ${schedule.open}–${schedule.close}`);
        } else if (!schedule?.open && !schedule?.close) {
          // Empty/null means no data yet, skip or mark as belum diatur
          lines.push(`${dayLabel}: Belum diatur`);
        } else {
          lines.push(`${dayLabel}: Tutup`);
        }
      }
      return lines.join('\n');
    }

    case 'ASK_SERVICE_INFO' as any: {
      const serviceSlug = nlu.service_request?.service_slug_match || nlu.service_request?.service_keyword;
      if (!serviceSlug) {
        return 'Layanan apa yang ingin Anda ketahui? Silakan sebutkan nama layanannya.';
      }
      const llmLike = {
        intent: 'SERVICE_INFO',
        fields: { service_slug: serviceSlug, village_id },
      };
      const result = await handleServiceInfo(user_id, llmLike);
      return typeof result === 'string' ? result : result.replyText;
    }

    case 'CREATE_SERVICE_REQUEST' as any: {
      const serviceSlug = nlu.service_request?.service_slug_match || nlu.service_request?.service_keyword;
      if (!serviceSlug) {
        return 'Layanan apa yang ingin Anda ajukan? Silakan sebutkan jenis layanannya.';
      }
      const llmLike = {
        intent: 'CREATE_SERVICE_REQUEST',
        fields: { service_slug: serviceSlug, village_id, ...nlu.extracted_data },
      };
      return await handleServiceRequestCreation(user_id, 'webchat', llmLike);
    }

    case 'CREATE_COMPLAINT': {
      const complaintReq = nlu.complaint_request;
      const llmLike = {
        intent: 'CREATE_COMPLAINT',
        fields: {
          village_id,
          kategori: complaintReq?.category_match || complaintReq?.category_keyword,
          deskripsi: complaintReq?.description,
          lokasi: complaintReq?.location,
          ...nlu.extracted_data,
        },
      };
      return await handleComplaintCreation(user_id, 'webchat', llmLike, message);
    }

    case 'CHECK_STATUS': {
      const trackingNumber = nlu.extracted_data?.tracking_number;
      if (!trackingNumber) {
        return 'Silakan berikan nomor tracking (format: LAP-XXXXXXXX-XXX atau LAY-XXXXXXXX-XXX).';
      }
      const llmLike = { intent: 'CHECK_STATUS', fields: { tracking_number: trackingNumber } };
      return await handleStatusCheck(user_id, 'webchat', llmLike, message);
    }

    case 'CANCEL': {
      const trackingNumber = nlu.extracted_data?.tracking_number;
      const llmLike = { intent: 'CANCEL', fields: { tracking_number: trackingNumber } };
      return await handleCancellation(user_id, 'webchat', llmLike);
    }

    case 'HISTORY': {
      return await handleHistory(user_id, 'webchat');
    }

    case 'ASK_KNOWLEDGE' as any: {
      // Support both old knowledge_request and new info_request formats
      const knowledgeReq = (nlu as any).knowledge_request || nlu.info_request;
      
      // If NLU found answer in context, use it directly
      if ((knowledgeReq?.answer_found_in_context || knowledgeReq?.answer_found) && knowledgeReq?.suggested_answer) {
        const answer = knowledgeReq.suggested_answer;
        logger.info('✅ NLU found answer in context', {
          questionSummary: knowledgeReq.question_summary || knowledgeReq.topic,
          answerLength: answer.length,
        });
        return answer;
      }

      // If we have RAG context but NLU didn't find answer, use knowledge handler
      if (context.rag_context) {
        try {
          const llmLike = {
            intent: 'KNOWLEDGE_QUERY',
            fields: {
              village_id,
              knowledge_category: knowledgeReq?.question_summary || knowledgeReq?.topic,
            },
          };
          const result = await handleKnowledgeQuery(user_id, message, llmLike);
          if (result && typeof result === 'string' && result.length > 20) {
            return result;
          }
        } catch (error: any) {
          logger.warn('Knowledge handler failed', { error: error.message });
        }
        
        return `Berdasarkan informasi yang tersedia:\n\n${context.rag_context.slice(0, 800)}\n\nJika ada pertanyaan lebih spesifik, silakan tanyakan kembali.`;
      }

      return 'Mohon maaf, saya tidak menemukan informasi yang Anda cari dalam database kami. Coba tanyakan dengan cara berbeda atau hubungi kantor desa langsung.';
    }

    case 'UNKNOWN':
    default: {
      return 'Mohon maaf, saya kurang mengerti maksud Anda. Berikut hal yang bisa saya bantu:\n\n' +
        '📋 Informasi layanan (syarat KTP, KK, dll)\n' +
        '📝 Pengajuan layanan online\n' +
        '📢 Pengaduan warga\n' +
        '📞 Nomor penting\n' +
        '🕐 Jam operasional\n' +
        '📍 Alamat kantor\n\n' +
        'Silakan sampaikan kebutuhan Anda.';
    }
  }
}
