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
const NAME_REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup old pending requests periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, pending] of pendingNameRequests.entries()) {
    if (now - pending.timestamp > NAME_REQUEST_TIMEOUT_MS) {
      pendingNameRequests.delete(userId);
      logger.debug('Cleaned up expired pending name request', { userId });
    }
  }
}, 60000); // Check every minute

// Intents that require user name before proceeding
const INTENTS_REQUIRING_NAME = ['CREATE_COMPLAINT', 'CREATE_SERVICE_REQUEST'];

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
    const pendingRequest = pendingNameRequests.get(userId);
    if (pendingRequest) {
      // Try to extract name from this message
      const extractedName = extractNameFromMessage(sanitizedMessage) || 
        pendingRequest.nluOutput.extracted_data?.nama_lengkap;
      
      if (extractedName) {
        // Save the name to profile
        updateProfile(userId, { nama_lengkap: extractedName });
        logger.info('✅ User name saved from pending request', { userId, nama: extractedName });
        
        // Remove pending request
        pendingNameRequests.delete(userId);
        
        // Update context with name
        if (pendingRequest.nluOutput.extracted_data) {
          pendingRequest.nluOutput.extracted_data.nama_lengkap = extractedName;
        }
        
        // Now proceed with the original intent
        const response = await handleNLUIntent(pendingRequest.nluOutput, pendingRequest.context);
        
        return {
          success: true,
          response: `Terima kasih, ${extractedName}.\n\n${response}`,
          intent: pendingRequest.intent,
          metadata: {
            processingTimeMs: Date.now() - startTime,
            model: 'nlu',
            hasKnowledge: !!pendingRequest.context.rag_context,
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

    // Step 5: Handle based on NLU intent
    const response = await handleNLUIntent(nluOutput, context);

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

    case 'ASK_ABOUT_CONVERSATION': {
      // Answer questions about previous conversation from history
      if (nlu.knowledge_request?.suggested_answer) {
        return nlu.knowledge_request.suggested_answer;
      }
      // Fallback if NLU didn't provide answer
      return 'Mohon maaf, saya tidak dapat mengingat detail percakapan sebelumnya. Bisakah Anda mengulangi pertanyaan atau informasi yang dimaksud?';
    }

    case 'ASK_CONTACT': {
      // Ensure category_match is set
      if (nlu.contact_request && !nlu.contact_request.category_match && nlu.contact_request.category_keyword) {
        nlu.contact_request.category_match = mapKeywordToCategory(nlu.contact_request.category_keyword) || undefined;
      }
      
      const contactResult = await handleContactQuery(nlu, village_id, villageName);
      return contactResult.response;
    }

    case 'ASK_ADDRESS': {
      if (!village_profile?.address && !village_profile?.gmaps_url) {
        return 'Mohon maaf, informasi alamat kantor belum tersedia.';
      }
      if (village_profile?.address && village_profile?.gmaps_url) {
        return `Alamat Kantor ${villageName}: ${village_profile.address}\n\nLokasi Google Maps:\n${village_profile.gmaps_url}`;
      }
      return `Alamat Kantor ${villageName}: ${village_profile?.address || village_profile?.gmaps_url}`;
    }

    case 'ASK_HOURS': {
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

    case 'ASK_SERVICE_INFO': {
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

    case 'CREATE_SERVICE_REQUEST': {
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
      const llmLike = {
        intent: 'CREATE_COMPLAINT',
        fields: {
          village_id,
          kategori: nlu.extracted_data?.complaint_category,
          deskripsi: nlu.extracted_data?.complaint_description,
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

    case 'ASK_KNOWLEDGE': {
      // If NLU found answer in context, use it directly
      if (nlu.knowledge_request?.answer_found_in_context && nlu.knowledge_request?.suggested_answer) {
        const answer = nlu.knowledge_request.suggested_answer;
        logger.info('✅ NLU found answer in context', {
          questionSummary: nlu.knowledge_request.question_summary,
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
              knowledge_category: nlu.knowledge_request?.question_summary,
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
