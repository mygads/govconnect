/**
 * NLU-Based Message Processor
 * 
 * New simplified message processing using LLM NLU
 * Replaces complex regex-based intent detection
 * 
 * Flow:
 * 1. Collect context (RAG + history)
 * 2. Call NLU LLM for structured intent detection
 * 3. System handles based on NLU output (no LLM needed for simple cases)
 * 4. Call Layer 2 LLM only for complex responses
 */

import logger from '../utils/logger';
import { MessageReceivedEvent } from '../types/event.types';
import { callNLU, quickIntentCheck, NLUInput, NLUOutput } from './nlu-llm.service';
import { handleContactQuery, mapKeywordToCategory } from './contact-handler.service';
import { publishAIReply, publishMessageStatus } from './rabbitmq.service';
import { isAIChatbotEnabled } from './settings.service';
import { startTyping, stopTyping, isUserInTakeover, markMessagesAsRead, updateConversationUserProfile } from './channel-client.service';
import { searchKnowledge } from './knowledge.service';
import { sanitizeUserInput } from './context-builder.service';
import { applyTypoCorrections } from './text-normalizer.service';
import { getKelurahanInfoContext } from './knowledge.service';
import { getUserHistory, getComplaintTypes } from './case-client.service';
import { getProfile, updateProfile } from './user-profile.service';

// Import handlers from unified-message-processor (existing handlers)
import { 
  handleComplaintCreation,
  handleServiceInfo,
  handleServiceRequestCreation,
  handleStatusCheck,
  handleCancellation,
  handleHistory,
  handleKnowledgeQuery,
} from './unified-message-processor.service';
import { getImportantContacts, ImportantContact } from './important-contacts.service';

const HISTORY_LIMIT = 30; // FIFO 30 messages

// ==================== PENDING NAME REQUEST (for WA layanan & pengaduan) ====================
// Store pending intents when waiting for user's name
interface PendingNameRequest {
  intent: string;
  nluOutput: NLUOutput;
  context: ProcessingContext;
  timestamp: number;
}

const pendingNameRequests = new Map<string, PendingNameRequest>();
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup old pending requests periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, pending] of pendingNameRequests.entries()) {
    if (now - pending.timestamp > REQUEST_TIMEOUT_MS) {
      pendingNameRequests.delete(userId);
      logger.debug('Cleaned up expired pending name request (WA)', { userId });
    }
  }
}, 60000); // Check every minute

// Intents that require user name before proceeding
const INTENTS_REQUIRING_NAME = ['CREATE_COMPLAINT', 'CREATE_SERVICE_REQUEST'];

/**
 * Check if user needs to provide name before proceeding with intent (WA)
 */
function needsNameForIntent(wa_user_id: string, intent: string): boolean {
  if (!INTENTS_REQUIRING_NAME.includes(intent)) {
    return false;
  }
  
  const profile = getProfile(wa_user_id);
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
      const candidateName = match[1].trim();
      // Basic validation
      if (candidateName.length >= 2 &&
          candidateName.length <= 30 &&
          !candidateName.toLowerCase().includes('http') &&
          !/\d/.test(candidateName)) {
        return candidateName;
      }
    }
  }
  return null;
}

interface ProcessingContext {
  village_id: string;
  wa_user_id: string;
  message: string;
  message_id: string;
  is_batched?: boolean;
  batched_message_ids?: string[];
  rag_context?: string;
  conversation_history?: string;
  village_profile?: any;
  available_contact_categories?: string[];
  available_services?: Array<{ name: string; slug: string }>;
  available_complaint_categories?: Array<{ category: string; types: string[] }>;
}

// Response from handleNLUIntent - can include contacts for WA vCard
interface NLUIntentResponse {
  text: string;
  contacts?: Array<{
    name: string;
    phone: string;
    organization?: string;
    title?: string;
  }>;
}

/**
 * Process message using NLU-based approach
 */
export async function processMessageWithNLU(event: MessageReceivedEvent): Promise<void> {
  const startTime = Date.now();
  const {
    village_id,
    wa_user_id,
    message,
    message_id,
    is_batched,
    batched_message_ids,
  } = event;

  // Validate required fields
  if (!wa_user_id || !message || !message_id) {
    logger.error('❌ Invalid message event - missing required fields');
    return;
  }

  const resolvedVillageId = village_id || process.env.DEFAULT_VILLAGE_ID || '';

  logger.info('🧠 Processing message with NLU', {
    village_id: resolvedVillageId,
    wa_user_id,
    message_id,
    messageLength: message.length,
  });

  // Mark messages as read
  const messageIdsToRead = is_batched && batched_message_ids
    ? batched_message_ids
    : [message_id];

  markMessagesAsRead(wa_user_id, messageIdsToRead, resolvedVillageId).catch((err) => {
    logger.warn('Failed to mark messages as read', { error: err.message });
  });

  // Notify processing status
  await publishMessageStatus({
    village_id: resolvedVillageId,
    wa_user_id,
    message_ids: messageIdsToRead,
    status: 'processing',
  });

  try {
    // Step 0: Pre-checks
    const aiEnabled = await isAIChatbotEnabled();
    if (!aiEnabled) {
      logger.info('⏸️ AI chatbot disabled');
      await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
      return;
    }

    const takeover = await isUserInTakeover(wa_user_id, resolvedVillageId);
    if (takeover) {
      logger.info('👤 User in takeover mode');
      await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
      return;
    }

    // Step 1: Sanitize and preprocess
    let sanitizedMessage = sanitizeUserInput(message);
    sanitizedMessage = applyTypoCorrections(sanitizedMessage);

    // Step 2: Quick intent check (no LLM needed for simple patterns)
    const quickResult = quickIntentCheck(sanitizedMessage);
    if (quickResult && quickResult.confidence && quickResult.confidence >= 0.9) {
      await startTyping(wa_user_id, resolvedVillageId);
      
      const response = await handleQuickIntent(quickResult as NLUOutput, {
        village_id: resolvedVillageId,
        wa_user_id,
        message: sanitizedMessage,
        message_id,
      });

      await stopTyping(wa_user_id, resolvedVillageId);
      await publishAIReply({
        village_id: resolvedVillageId,
        wa_user_id,
        reply_text: response,
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
      return;
    }

    // Step 3: Start typing and collect context
    await startTyping(wa_user_id, resolvedVillageId);

    const context = await collectContext({
      village_id: resolvedVillageId,
      wa_user_id,
      message: sanitizedMessage,
      message_id,
      is_batched,
      batched_message_ids,
    });

    // Step 4: Call NLU LLM
    const nluInput: NLUInput = {
      message: sanitizedMessage,
      wa_user_id,
      village_id: resolvedVillageId,
      rag_context: context.rag_context,
      conversation_history: context.conversation_history,
      available_contact_categories: context.available_contact_categories,
      available_services: context.available_services,
      available_complaint_categories: context.available_complaint_categories,
    };

    const nluOutput = await callNLU(nluInput);

    if (!nluOutput) {
      // NLU failed - fallback to simple response
      logger.warn('NLU failed, using fallback');
      await stopTyping(wa_user_id, resolvedVillageId);
      await publishAIReply({
        village_id: resolvedVillageId,
        wa_user_id,
        reply_text: 'Mohon maaf, terjadi kendala teknis. Silakan coba beberapa saat lagi.',
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
      return;
    }

    logger.info('✅ NLU result', {
      wa_user_id,
      intent: nluOutput.intent,
      confidence: nluOutput.confidence,
    });

    // Step 4.5: Check if there's a pending name request (user was asked for name before)
    const pendingNameRequest = pendingNameRequests.get(wa_user_id);
    if (pendingNameRequest) {
      // User might be providing their name now
      const extractedName = extractNameFromMessage(sanitizedMessage) ||
        nluOutput.extracted_data?.nama_lengkap;
      
      if (extractedName) {
        // Got the name, save it and continue with original intent
        updateProfile(wa_user_id, { nama_lengkap: extractedName });
        // Also update conversation profile in channel-service
        await updateConversationUserProfile(wa_user_id, { user_name: extractedName }, resolvedVillageId, 'WHATSAPP');
        pendingNameRequests.delete(wa_user_id);
        
        logger.info('✅ Name captured from pending request (WA)', { wa_user_id, nama: extractedName });
        
        // Update the extracted data in the pending NLU output
        if (pendingNameRequest.nluOutput.extracted_data) {
          pendingNameRequest.nluOutput.extracted_data.nama_lengkap = extractedName;
        }
        
        // Continue with the original intent
        const response = await handleNLUIntent(pendingNameRequest.nluOutput, pendingNameRequest.context);
        
        await stopTyping(wa_user_id, resolvedVillageId);
        await publishAIReply({
          village_id: resolvedVillageId,
          wa_user_id,
          reply_text: response.text,
          contacts: response.contacts,
          message_id: is_batched ? undefined : message_id,
          batched_message_ids: is_batched ? batched_message_ids : undefined,
        });
        
        const durationMs = Date.now() - startTime;
        logger.info('✅ Message processed with NLU (after name capture)', {
          wa_user_id,
          intent: pendingNameRequest.intent,
          durationMs,
        });
        await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
        return;
      }
      // Name not detected - ask again politely
      // But only if the new intent is not something else entirely
      if (!['CREATE_COMPLAINT', 'CREATE_SERVICE_REQUEST', 'GREETING', 'THANKS', 'CONFIRMATION'].includes(nluOutput.intent)) {
        // User changed topic, clear pending and process new intent
        pendingNameRequests.delete(wa_user_id);
      } else if (nluOutput.intent !== pendingNameRequest.intent) {
        // User might be trying different intent - clear and re-check
        pendingNameRequests.delete(wa_user_id);
      } else {
        // Still no name - ask again
        await stopTyping(wa_user_id, resolvedVillageId);
        await publishAIReply({
          village_id: resolvedVillageId,
          wa_user_id,
          reply_text: 'Mohon maaf Kak, saya belum mendapatkan nama Kakak. Boleh sebutkan nama lengkap Kakak?',
          message_id: is_batched ? undefined : message_id,
          batched_message_ids: is_batched ? batched_message_ids : undefined,
        });
        await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
        return;
      }
    }

    // Step 4.6: Check if this intent requires name and user hasn't provided it
    // First check if NLU extracted a name from current message
    if (nluOutput.extracted_data?.nama_lengkap) {
      updateProfile(wa_user_id, { nama_lengkap: nluOutput.extracted_data.nama_lengkap });
      // Also update conversation profile in channel-service
      await updateConversationUserProfile(wa_user_id, { user_name: nluOutput.extracted_data.nama_lengkap }, resolvedVillageId, 'WHATSAPP');
      logger.info('✅ User name extracted from NLU (WA)', { wa_user_id, nama: nluOutput.extracted_data.nama_lengkap });
    }
    
    // Now check if we need name for this intent
    if (needsNameForIntent(wa_user_id, nluOutput.intent)) {
      // Store pending request and ask for name
      pendingNameRequests.set(wa_user_id, {
        intent: nluOutput.intent,
        nluOutput,
        context,
        timestamp: Date.now(),
      });
      
      logger.info('📝 Name required for intent (WA), asking user', { 
        wa_user_id, 
        intent: nluOutput.intent,
      });
      
      const intentLabel = nluOutput.intent === 'CREATE_COMPLAINT' ? 'pengaduan' : 'pengajuan layanan';
      await stopTyping(wa_user_id, resolvedVillageId);
      await publishAIReply({
        village_id: resolvedVillageId,
        wa_user_id,
        reply_text: `Sebelum melanjutkan ${intentLabel}, boleh saya tahu nama lengkap Kakak?`,
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
      return;
    }

    // Step 5: Handle based on NLU intent
    const response = await handleNLUIntent(nluOutput, context);

    await stopTyping(wa_user_id, resolvedVillageId);
    await publishAIReply({
      village_id: resolvedVillageId,
      wa_user_id,
      reply_text: response.text,
      contacts: response.contacts,
      message_id: is_batched ? undefined : message_id,
      batched_message_ids: is_batched ? batched_message_ids : undefined,
    });

    const durationMs = Date.now() - startTime;
    logger.info('✅ Message processed with NLU', {
      wa_user_id,
      intent: nluOutput.intent,
      durationMs,
      contactsCount: response.contacts?.length,
    });

  } catch (error: any) {
    logger.error('❌ NLU processing error', { error: error.message });
    await stopTyping(wa_user_id, resolvedVillageId);
    await publishAIReply({
      village_id: resolvedVillageId,
      wa_user_id,
      reply_text: 'Mohon maaf, terjadi kendala teknis. Silakan coba beberapa saat lagi.',
      message_id: is_batched ? undefined : message_id,
      batched_message_ids: is_batched ? batched_message_ids : undefined,
    });
  }

  await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
}

/**
 * Collect context for NLU
 */
async function collectContext(params: Partial<ProcessingContext>): Promise<ProcessingContext> {
  const { village_id, wa_user_id, message } = params;

  // Get village info and profile
  let villageProfile: any = null;
  let contactCategories: string[] = [];
  let services: Array<{ name: string; slug: string }> = [];
  let complaintCategories: Array<{ category: string; types: string[] }> = [];

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
      const axios = (await import('axios')).default;
      const { config } = await import('../config/env');
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

      // Get available complaint categories from case-service
      const complaintTypes = await getComplaintTypes(village_id);
      if (complaintTypes.length > 0) {
        // Group types by category
        const categoryMap = new Map<string, string[]>();
        complaintTypes.forEach((type: any) => {
          const categoryName = type.category?.name || 'Lainnya';
          if (!categoryMap.has(categoryName)) {
            categoryMap.set(categoryName, []);
          }
          categoryMap.get(categoryName)!.push(type.name);
        });
        complaintCategories = Array.from(categoryMap.entries()).map(([category, types]) => ({
          category,
          types,
        }));
      }
    } catch (error: any) {
      logger.warn('Failed to get village context', { error: error.message });
    }
  }

  // Get RAG context - ALWAYS collect for better context understanding
  // NLU will decide what's relevant from the context
  let ragContext = '';
  if (message) {
    // Always try to get RAG context, let NLU decide if it's needed
    // This ensures we have data for ASK_KNOWLEDGE, ASK_CONTACT, etc.
    const ragResult = await searchKnowledge(message, [], village_id || '');
    ragContext = ragResult?.context || '';
    
    logger.debug('📚 RAG context collected', {
      messageLength: message.length,
      ragContextLength: ragContext.length,
      hasContext: !!ragContext,
    });
  }

  // Get conversation history (FIFO 30)
  let conversationHistory = '';
  if (wa_user_id && village_id) {
    try {
      const historyResult = await getUserHistory({ wa_user_id, channel: 'WHATSAPP' });
      if (historyResult?.combined && historyResult.combined.length > 0) {
        conversationHistory = historyResult.combined
          .slice(-HISTORY_LIMIT)
          .map((h: any) => `${h.type}: ${h.description || ''}`)
          .join('\n');
      }
    } catch {
      // Ignore history fetch errors
    }
  }

  return {
    village_id: village_id || '',
    wa_user_id: wa_user_id || '',
    message: message || '',
    message_id: params.message_id || '',
    is_batched: params.is_batched,
    batched_message_ids: params.batched_message_ids,
    rag_context: ragContext,
    conversation_history: conversationHistory,
    village_profile: villageProfile,
    available_contact_categories: contactCategories,
    available_services: services,
    available_complaint_categories: complaintCategories,
  };
}

/**
 * Handle quick intent (simple patterns, no LLM needed)
 */
async function handleQuickIntent(
  nlu: NLUOutput,
  params: { village_id: string; wa_user_id: string; message: string; message_id: string }
): Promise<string> {
  switch (nlu.intent) {
    case 'GREETING':
      return 'Halo Kak! 👋 Ada yang bisa saya bantu hari ini?';

    case 'THANKS':
      return 'Sama-sama Kak! Senang bisa membantu. Jika ada pertanyaan lain, jangan ragu untuk bertanya ya 😊';

    case 'CONFIRMATION':
      if (nlu.confirmation?.is_positive) {
        return 'Baik Kak, siap! Ada yang bisa saya bantu selanjutnya?';
      }
      return 'Baik Kak, tidak masalah. Ada hal lain yang bisa saya bantu?';

    case 'CHECK_STATUS':
      if (nlu.extracted_data?.tracking_number) {
        const llmLike = {
          intent: 'CHECK_STATUS',
          fields: {
            tracking_number: nlu.extracted_data.tracking_number,
          },
        };
        return await handleStatusCheck(params.wa_user_id, 'whatsapp', llmLike, params.message);
      }
      return 'Silakan berikan nomor tracking Kakak (format: LAP-XXXXXXXX-XXX atau LAY-XXXXXXXX-XXX) untuk cek status.';

    default:
      return 'Ada yang bisa saya bantu?';
  }
}

/**
 * Handle NLU intent with full context
 */
async function handleNLUIntent(nlu: NLUOutput, context: ProcessingContext): Promise<NLUIntentResponse> {
  const { village_id, wa_user_id, message, village_profile } = context;
  const villageName = village_profile?.name || 'Desa';

  logger.info('🎯 Handling NLU intent', {
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
        return { text: `Halo, Kak ${userName}! 👋 Selamat datang di layanan ${villageName}. Ada yang bisa saya bantu?` };
      }
      return { text: 'Halo, Kak! 👋 Ada yang bisa saya bantu hari ini?' };
    }

    case 'THANKS':
      return { text: 'Sama-sama, Kak! Senang bisa membantu. Jika ada pertanyaan lain, jangan ragu untuk bertanya 😊' };

    case 'CONFIRMATION':
      if (nlu.confirmation?.is_positive) {
        return { text: 'Baik, siap Kak! Ada yang bisa saya bantu selanjutnya?' };
      }
      return { text: 'Baik Kak, tidak masalah. Ada hal lain yang bisa saya bantu?' };

    case 'ASK_ABOUT_CONVERSATION': {
      // Answer questions about previous conversation from history
      if (nlu.knowledge_request?.suggested_answer) {
        return { text: nlu.knowledge_request.suggested_answer };
      }
      // Fallback if NLU didn't provide answer
      return { text: 'Mohon maaf Kak, saya tidak dapat mengingat detail percakapan sebelumnya. Bisakah Kakak mengulangi pertanyaan atau informasi yang dimaksud?' };
    }

    case 'ASK_CONTACT': {
      // Ensure category_match is set
      if (nlu.contact_request && !nlu.contact_request.category_match && nlu.contact_request.category_keyword) {
        nlu.contact_request.category_match = mapKeywordToCategory(nlu.contact_request.category_keyword) || undefined;
      }
      
      const contactResult = await handleContactQuery(nlu, village_id, villageName, 'whatsapp');
      
      // For WA: return contacts separately as vCard messages
      if (contactResult.found && contactResult.contacts && contactResult.contacts.length > 0) {
        const categoryLabel = nlu.contact_request?.category_match || nlu.contact_request?.category_keyword || 'Penting';
        return {
          text: `Berikut adalah nomor ${categoryLabel} di ${villageName}:`,
          contacts: contactResult.contacts.map(c => ({
            name: c.name,
            phone: c.phone,
            organization: c.category || villageName,
            title: c.description,
          })),
        };
      }
      
      return { text: contactResult.response };
    }

    case 'ASK_ADDRESS': {
      if (!village_profile?.address && !village_profile?.gmaps_url) {
        return { text: 'Mohon maaf Kak, informasi alamat kantor belum tersedia.' };
      }
      if (village_profile?.address && village_profile?.gmaps_url) {
        return { text: `Kantor ${villageName} beralamat di ${village_profile.address}.\nLokasi Google Maps:\n${village_profile.gmaps_url}` };
      }
      return { text: `Alamat Kantor ${villageName}: ${village_profile?.address || village_profile?.gmaps_url}` };
    }

    case 'ASK_HOURS': {
      const hours = village_profile?.operating_hours;
      if (!hours) {
        return { text: 'Mohon maaf Kak, informasi jam operasional belum tersedia.' };
      }
      const lines = ['Jam operasional:'];
      for (const [day, schedule] of Object.entries(hours as Record<string, any>)) {
        const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
        if (schedule?.open && schedule?.close) {
          lines.push(`${dayLabel}: ${schedule.open}–${schedule.close}`);
        } else {
          lines.push(`${dayLabel}: Tutup`);
        }
      }
      return { text: lines.join('\n') };
    }

    case 'ASK_SERVICE_INFO': {
      const serviceSlug = nlu.service_request?.service_slug_match || nlu.service_request?.service_keyword;
      if (!serviceSlug) {
        return { text: 'Layanan apa yang ingin Kakak ketahui? Silakan sebutkan nama layanannya.' };
      }
      const llmLike = {
        intent: 'SERVICE_INFO',
        fields: { service_slug: serviceSlug, village_id },
      };
      const result = await handleServiceInfo(wa_user_id, llmLike);
      return { text: typeof result === 'string' ? result : result.replyText };
    }

    case 'CREATE_SERVICE_REQUEST': {
      const serviceSlug = nlu.service_request?.service_slug_match || nlu.service_request?.service_keyword;
      if (!serviceSlug) {
        return { text: 'Layanan apa yang ingin Kakak ajukan? Silakan sebutkan jenis layanannya.' };
      }
      const llmLike = {
        intent: 'CREATE_SERVICE_REQUEST',
        fields: { service_slug: serviceSlug, village_id, ...nlu.extracted_data },
      };
      return { text: await handleServiceRequestCreation(wa_user_id, 'whatsapp', llmLike) };
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
      const complaintResult = await handleComplaintCreation(wa_user_id, 'whatsapp', llmLike, message);
      
      // For WA: also fetch important contacts related to complaint category for vCard
      const kategori = nlu.extracted_data?.complaint_category;
      if (kategori) {
        try {
          const { resolveComplaintTypeConfig } = await import('./unified-message-processor.service');
          const complaintTypeConfig = await resolveComplaintTypeConfig(kategori, village_id);
          
          if (complaintTypeConfig?.send_important_contacts && complaintTypeConfig?.important_contact_category) {
            const importantContacts = await getImportantContacts(
              village_id,
              complaintTypeConfig.important_contact_category,
              undefined
            );
            
            if (importantContacts && importantContacts.length > 0) {
              return {
                text: complaintResult,
                contacts: importantContacts.slice(0, 5).map((c: ImportantContact) => ({
                  name: c.name || '',
                  phone: c.phone || '',
                  organization: c.category?.name || 'Kontak Penting',
                  title: c.description || undefined,
                })),
              };
            }
          }
        } catch (error: any) {
          logger.warn('Failed to fetch important contacts for complaint', { error: error.message });
        }
      }
      
      return { text: complaintResult };
    }

    case 'CHECK_STATUS': {
      const trackingNumber = nlu.extracted_data?.tracking_number;
      if (!trackingNumber) {
        return { text: 'Silakan berikan nomor tracking (format: LAP-XXXXXXXX-XXX atau LAY-XXXXXXXX-XXX).' };
      }
      const llmLike = { intent: 'CHECK_STATUS', fields: { tracking_number: trackingNumber } };
      return { text: await handleStatusCheck(wa_user_id, 'whatsapp', llmLike, message) };
    }

    case 'CANCEL': {
      const trackingNumber = nlu.extracted_data?.tracking_number;
      const llmLike = { intent: 'CANCEL', fields: { tracking_number: trackingNumber } };
      return { text: await handleCancellation(wa_user_id, 'whatsapp', llmLike) };
    }

    case 'HISTORY': {
      return { text: await handleHistory(wa_user_id, 'whatsapp') };
    }

    case 'ASK_KNOWLEDGE': {
      // If NLU found answer in context, use it directly
      if (nlu.knowledge_request?.answer_found_in_context && nlu.knowledge_request?.suggested_answer) {
        const answer = nlu.knowledge_request.suggested_answer;
        logger.info('✅ NLU found answer in context', {
          questionSummary: nlu.knowledge_request.question_summary,
          answerLength: answer.length,
        });
        return { text: answer };
      }

      // If we have RAG context but NLU didn't find answer, use knowledge handler
      if (context.rag_context) {
        try {
          // Use existing knowledge query handler from unified processor
          const llmLike = {
            intent: 'KNOWLEDGE_QUERY',
            fields: {
              village_id,
              knowledge_category: nlu.knowledge_request?.question_summary,
            },
          };
          const result = await handleKnowledgeQuery(wa_user_id, message, llmLike);
          if (result && typeof result === 'string' && result.length > 20) {
            return { text: result };
          }
        } catch (error: any) {
          logger.warn('Knowledge handler failed', { error: error.message });
        }
        
        // Fallback: return context summary
        return { text: `Berdasarkan informasi yang tersedia:\n\n${context.rag_context.slice(0, 800)}\n\nJika ada pertanyaan lebih spesifik, silakan tanyakan kembali.` };
      }

      // No context found - be honest about it
      return { text: 'Mohon maaf Kak, saya tidak menemukan informasi yang Kakak cari dalam database kami. Coba tanyakan dengan cara berbeda atau hubungi kantor desa langsung.' };
    }

    case 'UNKNOWN':
    default: {
      // For unknown intents, give a helpful response
      return { text: 'Mohon maaf Kak, saya kurang mengerti maksud Kakak. Berikut hal yang bisa saya bantu:\n\n' +
        '📋 Informasi layanan (syarat KTP, KK, dll)\n' +
        '📝 Pengajuan layanan online\n' +
        '📢 Pengaduan warga\n' +
        '📞 Nomor penting\n' +
        '🕐 Jam operasional\n' +
        '📍 Alamat kantor\n\n' +
        'Silakan sampaikan kebutuhan Kakak.' };
    }
  }
}

/**
 * Complete message processing
 */
async function completeProcessing(
  village_id: string,
  wa_user_id: string,
  message_ids: string[]
): Promise<void> {
  await publishMessageStatus({
    village_id,
    wa_user_id,
    message_ids,
    status: 'completed',
  });
}
