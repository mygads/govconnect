/**
 * NLU-Based Message Processor
 * 
 * Smart message processing using LLM-based intent detection
 * Uses Micro NLU for fast understanding (no rigid pattern matching)
 * 
 * Flow:
 * 1. Call Micro NLU to understand user intent (always LLM, ~200 tokens)
 * 2. Based on micro result, route to appropriate handler
 * 3. For complex queries, call full NLU with context
 * 
 * Benefits:
 * - No rigid keyword matching - understands variations
 * - "rumah terbakar butuh nomor damkar" → understands contact request
 * - "saya mau lapor kebakaran" → understands complaint creation
 */

import logger from '../utils/logger';
import { MessageReceivedEvent } from '../types/event.types';
import { callNLU, callNLUAdaptive, NLUInput, NLUOutput, incrementCallCount, resetCallCount, getCallCount } from './nlu-llm.service';
import { callMicroNLU, MicroNLUResult, isContactRequest, isComplaintRequest } from './micro-nlu.service';
import { handleContactQuery, mapKeywordToCategory } from './contact-handler.service';
import { getCachedResponse, setCachedResponse, isCacheable } from './response-cache.service';
import { publishAIReply, publishMessageStatus } from './rabbitmq.service';
import { isAIChatbotEnabled } from './settings.service';
import { startTyping, stopTyping, isUserInTakeover, markMessagesAsRead, updateConversationUserProfile } from './channel-client.service';
import { searchKnowledge } from './knowledge.service';
import { sanitizeUserInput } from './context-builder.service';
import { applyTypoCorrections } from './text-normalizer.service';
import { getKelurahanInfoContext } from './knowledge.service';
import { getUserHistory, getComplaintTypes } from './case-client.service';
import { getProfile, updateProfile } from './user-profile.service';
import { sanitizeFakeLinks } from './anti-hallucination.service';

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

// ==================== LAZY RAG OPTIMIZATION ====================
// Patterns that DON'T need RAG (greetings, simple commands)
const SIMPLE_PATTERNS = [
  /^(hai|halo|hi|hello|hey|pagi|siang|sore|malam|selamat\s+(pagi|siang|sore|malam))$/i,
  /^(iya|ya|ok|oke|okay|siap|baik|terima\s*kasih|makasih|thanks|thank\s*you)$/i,
  /^(tidak|nggak|gak|ga|no|nope|cancel|batal)$/i,
  /^(status|cek\s*status|lihat\s*status)$/i,
  /^(history|riwayat|histori)$/i,
  /^[0-9]+$/,  // Just numbers
];

// Patterns that ALWAYS need RAG (knowledge queries)
const RAG_NEEDED_PATTERNS = [
  /syarat|persyaratan|ketentuan|prosedur|cara|gimana|bagaimana/i,
  /jam\s*(buka|operasi|kerja|layanan)|buka\s*jam|tutup\s*jam/i,
  /alamat|lokasi|dimana|tempat/i,
  /biaya|tarif|harga|bayar|gratis/i,
  /berapa|kapan|siapa|apa\s+itu/i,
  /info|informasi|penjelasan|jelaskan/i,
];

/**
 * Determine if message needs RAG context
 * Returns false for simple messages (saves ~200ms)
 */
function shouldFetchRAG(message: string): boolean {
  const cleanMessage = message.trim().toLowerCase();
  
  // Short simple messages don't need RAG
  if (cleanMessage.length < 10) {
    for (const pattern of SIMPLE_PATTERNS) {
      if (pattern.test(cleanMessage)) {
        return false;
      }
    }
  }
  
  // Patterns that definitely need RAG
  for (const pattern of RAG_NEEDED_PATTERNS) {
    if (pattern.test(cleanMessage)) {
      return true;
    }
  }
  
  // Default: fetch RAG for messages > 15 chars or containing question words
  return cleanMessage.length > 15 || /\?/.test(cleanMessage);
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

    // Step 2: Start typing immediately - we're going to use LLM
    await startTyping(wa_user_id, resolvedVillageId);

    // Check LLM call limit to prevent infinite loops
    if (!incrementCallCount(wa_user_id)) {
      logger.warn('🚫 Max LLM calls reached, using fallback', { wa_user_id });
      await stopTyping(wa_user_id, resolvedVillageId);
      await publishAIReply({
        village_id: resolvedVillageId,
        wa_user_id,
        reply_text: 'Mohon maaf Kak, ada kendala teknis. Silakan coba beberapa saat lagi atau hubungi kantor desa langsung.',
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
      return;
    }

    // Step 3: Get conversation history first (needed for Micro NLU context)
    let conversationHistory = '';
    if (wa_user_id && resolvedVillageId) {
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

    // Step 4: Call Micro NLU - LLM-based intent detection (replaces pattern matching)
    // This is a small LLM call (~200 tokens) that understands user intent naturally
    // userId is passed for rate limiting (max 10 LLM calls per minute per user)
    const microResult = await callMicroNLU(sanitizedMessage, conversationHistory, wa_user_id);
    
    if (microResult) {
      logger.info('⚡ Micro NLU understood intent', {
        wa_user_id,
        action: microResult.action,
        topic: microResult.topic,
        is_emergency: microResult.is_emergency,
        confidence: microResult.confidence,
      });
      
      // Handle based on Micro NLU result
      const microResponse = await handleMicroNLUResult(microResult, {
        village_id: resolvedVillageId,
        wa_user_id,
        message: sanitizedMessage,
        message_id,
        conversation_history: conversationHistory,
      });
      
      if (microResponse) {
        await stopTyping(wa_user_id, resolvedVillageId);
        await publishAIReply({
          village_id: resolvedVillageId,
          wa_user_id,
          reply_text: microResponse.text,
          contacts: microResponse.contacts,
          message_id: is_batched ? undefined : message_id,
          batched_message_ids: is_batched ? batched_message_ids : undefined,
        });
        
        const durationMs = Date.now() - startTime;
        logger.info('✅ Message processed with Micro NLU', {
          wa_user_id,
          action: microResult.action,
          durationMs,
          contactsCount: microResponse.contacts?.length,
        });
        await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
        return;
      }
      // If microResponse is null, fall through to full NLU
    }

    // Step 5: Fall through to full NLU if Micro NLU didn't handle it
    logger.info('📊 Falling through to full NLU', { wa_user_id });
    
    const context = await collectContext({
      village_id: resolvedVillageId,
      wa_user_id,
      message: sanitizedMessage,
      message_id,
      is_batched,
      batched_message_ids,
    });

    // Step 5.5: Check response cache for FAQ-style queries
    // This can save entire LLM call for repeated questions
    const cachedResponse = getCachedResponse(sanitizedMessage);
    if (cachedResponse) {
      const cacheAgeSeconds = Math.floor((Date.now() - cachedResponse.timestamp) / 1000);
      logger.info('💾 Cache HIT - skipping LLM call', { 
        wa_user_id, 
        messageLength: sanitizedMessage.length,
        cacheAge: cacheAgeSeconds,
      });
      
      await stopTyping(wa_user_id, resolvedVillageId);
      await publishAIReply({
        village_id: resolvedVillageId,
        wa_user_id,
        reply_text: cachedResponse.response,
        message_id: is_batched ? undefined : message_id,
        batched_message_ids: is_batched ? batched_message_ids : undefined,
      });
      
      const durationMs = Date.now() - startTime;
      logger.info('✅ Message processed with CACHE', { wa_user_id, durationMs });
      await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
      return;
    }

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

    // Use adaptive NLU - tries light mode first, deep mode if needed
    const nluOutput = await callNLUAdaptive(nluInput);

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
      callCount: getCallCount(wa_user_id),
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
    const rawResponse = await handleNLUIntent(nluOutput, context);
    
    // Sanitize response to remove any hallucinated fake links
    const response = {
      ...rawResponse,
      text: sanitizeFakeLinks(rawResponse.text),
    };

    // Step 5.5: Cache response for FAQ-style queries (only if cacheable)
    // This saves future LLM calls for similar questions
    if (isCacheable(sanitizedMessage, nluOutput.intent) && response.text) {
      setCachedResponse(
        sanitizedMessage, 
        response.text, 
        nluOutput.intent, 
        context.rag_context || ''
      );
      logger.debug('💾 Response cached', { 
        intent: nluOutput.intent, 
        messageLength: sanitizedMessage.length,
      });
    }

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

  // Reset call counter after event completes
  resetCallCount(wa_user_id);
  await completeProcessing(resolvedVillageId, wa_user_id, messageIdsToRead);
}

// ==================== MICRO NLU HANDLER ====================

interface MicroContext {
  village_id: string;
  wa_user_id: string;
  message: string;
  message_id: string;
  conversation_history?: string;
}

/**
 * Handle Micro NLU result - fast path for common intents
 * Returns null if needs full NLU processing
 */
async function handleMicroNLUResult(
  micro: MicroNLUResult,
  ctx: MicroContext
): Promise<NLUIntentResponse | null> {
  const { village_id, wa_user_id, message } = ctx;
  
  // Get village name for responses
  let villageName = 'Desa';
  try {
    const villageInfo = await getKelurahanInfoContext(village_id);
    // villageInfo is a string context, extract name differently
    if (typeof villageInfo === 'object' && villageInfo) {
      villageName = (villageInfo as any).name || (villageInfo as any).village_name || 'Desa';
    }
  } catch {}

  switch (micro.action) {
    // ==================== SIMPLE RESPONSES ====================
    
    case 'GREETING': {
      const hour = new Date().getHours();
      let greeting = 'Halo';
      if (hour >= 5 && hour < 12) greeting = 'Selamat pagi';
      else if (hour >= 12 && hour < 15) greeting = 'Selamat siang';
      else if (hour >= 15 && hour < 18) greeting = 'Selamat sore';
      else greeting = 'Selamat malam';
      
      return {
        text: `${greeting}! Ada yang bisa saya bantu, Kak? 😊\n\nSaya bisa membantu:\n• Informasi layanan desa\n• Pengaduan/laporan\n• Nomor kontak penting`,
      };
    }
    
    case 'THANKS': {
      return {
        text: 'Sama-sama, Kak! Senang bisa membantu. 😊\n\nJika ada yang perlu ditanyakan lagi, silakan hubungi saya kapan saja.',
      };
    }
    
    case 'CONFIRMATION': {
      // Check pending requests
      const pending = pendingNameRequests.get(wa_user_id);
      if (pending) {
        // User confirmed something - need full NLU to understand context
        return null;
      }
      return {
        text: 'Baik, Kak. Ada yang lain yang bisa saya bantu?',
      };
    }
    
    // ==================== CONTACT REQUESTS ====================
    
    case 'ASK_CONTACT': {
      // Use topic from Micro NLU to find the right contact
      const topic = micro.topic || message;
      const categoryMatch = mapKeywordToCategory(topic);
      
      logger.info('📇 Micro NLU: Contact request', {
        topic,
        categoryMatch,
        is_emergency: micro.is_emergency,
      });
      
      const contactResult = await handleContactQuery(
        {
          contact_request: {
            category_keyword: topic,
            category_match: categoryMatch,
            is_emergency: micro.is_emergency,
          },
        },
        village_id,
        villageName,
        'whatsapp'
      );
      
      if (contactResult.found && contactResult.contacts && contactResult.contacts.length > 0) {
        const urgentPrefix = micro.is_emergency ? '🚨 ' : '';
        return {
          text: `${urgentPrefix}Berikut nomor ${categoryMatch || topic} di ${villageName}:`,
          contacts: contactResult.contacts.map(c => ({
            name: c.name,
            phone: c.phone,
            organization: c.category || villageName,
            title: c.description,
          })),
        };
      }
      
      // No contacts found
      return {
        text: `Mohon maaf Kak, nomor ${categoryMatch || topic} di ${villageName} belum tersedia dalam database.\n\nSilakan hubungi kantor ${villageName} langsung untuk informasi lebih lanjut.`,
      };
    }
    
    // ==================== COMPLAINT CREATION ====================
    
    case 'CREATE_COMPLAINT': {
      // Get complaint categories for matching
      const complaintTypes = await getComplaintTypes(village_id);
      const topic = micro.topic || '';
      
      logger.info('📝 Micro NLU: Complaint request', {
        topic,
        is_emergency: micro.is_emergency,
        availableCategories: complaintTypes.length,
      });
      
      // Find matching category
      let matchedCategory = '';
      let matchedType = '';
      let sendContact = false;
      
      for (const type of complaintTypes) {
        const typeName = (type.name || '').toLowerCase();
        const categoryName = (type.category?.name || '').toLowerCase();
        const typeAny = type as any;
        
        if (topic.toLowerCase().includes(typeName) || typeName.includes(topic.toLowerCase())) {
          matchedCategory = type.category?.name || '';
          matchedType = type.name || '';
          sendContact = typeAny.send_contact === true;
          break;
        }
        if (topic.toLowerCase().includes(categoryName) || categoryName.includes(topic.toLowerCase())) {
          matchedCategory = type.category?.name || '';
          matchedType = type.name || '';
          sendContact = typeAny.send_contact === true;
          break;
        }
      }
      
      // If emergency complaint with contact flag, send contact first
      if (micro.is_emergency && sendContact) {
        const contactResult = await handleContactQuery(
          {
            contact_request: {
              category_keyword: topic,
              category_match: mapKeywordToCategory(topic),
              is_emergency: true,
            },
          },
          village_id,
          villageName,
          'whatsapp'
        );
        
        if (contactResult.found && contactResult.contacts && contactResult.contacts.length > 0) {
          return {
            text: `🚨 Saya paham ini darurat! Berikut nomor yang bisa dihubungi:\n\nUntuk membuat laporan resmi, silakan berikan:\n• Nama lengkap\n• Lokasi kejadian`,
            contacts: contactResult.contacts.map(c => ({
              name: c.name,
              phone: c.phone,
              organization: c.category || villageName,
              title: c.description,
            })),
          };
        }
      }
      
      // Need full NLU for complaint creation flow
      // But we can guide the user better
      if (matchedCategory) {
        // Store pending for name request
        const profile = getProfile(wa_user_id);
        if (!profile.nama_lengkap) {
          // Need name first
          return {
            text: `Baik Kak, saya akan bantu buat laporan ${matchedType || matchedCategory}.\n\nUntuk melanjutkan, boleh saya tahu nama lengkap Kakak?`,
          };
        }
        
        // Has name, need to continue with full flow
        return null; // Let full NLU handle
      }
      
      // No category match - ask for clarification
      return {
        text: `Saya paham Kakak ingin membuat laporan. Bisa diperjelas terkait masalah apa?\n\nContoh kategori:\n• Infrastruktur (jalan rusak, lampu mati)\n• Bencana (kebakaran, banjir)\n• Keamanan (pencurian, keributan)\n• Medis (kecelakaan, warga sakit)`,
      };
    }
    
    // ==================== SERVICE CREATION ====================
    
    case 'CREATE_SERVICE': {
      // Need full NLU for service creation
      return null;
    }
    
    // ==================== STATUS CHECK ====================
    
    case 'CHECK_STATUS': {
      // Extract tracking number
      const trackingMatch = message.match(/LA[PY]-\d{5,}/i);
      if (trackingMatch) {
        const result = await handleStatusCheck(wa_user_id, 'whatsapp', trackingMatch[0]);
        return { text: result };
      }
      return {
        text: 'Silakan berikan nomor tracking (contoh: LAP-12345 atau LAY-12345) untuk cek status.',
      };
    }
    
    // ==================== HISTORY ====================
    
    case 'HISTORY': {
      const result = await handleHistory(wa_user_id, 'whatsapp');
      return { text: result };
    }
    
    // ==================== CANCEL ====================
    
    case 'CANCEL': {
      const result = await handleCancellation(wa_user_id, 'whatsapp', message);
      return { text: result };
    }
    
    // ==================== PROVIDE NAME ====================
    
    case 'PROVIDE_NAME': {
      // User memberikan nama - simpan dan lanjutkan flow
      const extractedName = micro.extracted_data?.nama || message.trim();
      
      if (extractedName && extractedName.length >= 2 && extractedName.length <= 50) {
        // Simpan nama
        updateProfile(wa_user_id, { nama_lengkap: extractedName });
        await updateConversationUserProfile(wa_user_id, { user_name: extractedName }, village_id, 'WHATSAPP');
        
        logger.info('✅ Name saved via PROVIDE_NAME', { wa_user_id, nama: extractedName });
        
        // Check if there's a pending request
        const pending = pendingNameRequests.get(wa_user_id);
        if (pending) {
          pendingNameRequests.delete(wa_user_id);
          // Update extracted data in pending NLU
          if (pending.nluOutput.extracted_data) {
            pending.nluOutput.extracted_data.nama_lengkap = extractedName;
          }
          // Continue with original intent - need full NLU
          return null;
        }
        
        return {
          text: `Terima kasih, ${extractedName}! Ada yang bisa saya bantu?`,
        };
      }
      
      return {
        text: 'Mohon maaf, saya tidak bisa menangkap nama dengan benar. Bisa disebutkan ulang nama lengkap Kakak?',
      };
    }
    
    // ==================== PROVIDE PHONE ====================
    
    case 'PROVIDE_PHONE': {
      // User memberikan nomor HP - simpan
      const extractedPhone = micro.extracted_data?.no_hp || extractPhoneFromMessage(message);
      
      if (extractedPhone) {
        // Simpan nomor HP
        updateProfile(wa_user_id, { no_hp: extractedPhone });
        
        logger.info('✅ Phone saved via PROVIDE_PHONE', { wa_user_id, phone: extractedPhone });
        
        return {
          text: `Nomor ${extractedPhone} sudah tersimpan. Ada yang bisa saya bantu, Kak?`,
        };
      }
      
      return {
        text: 'Mohon maaf, format nomor tidak valid. Silakan masukkan nomor WhatsApp/HP yang benar (contoh: 08123456789).',
      };
    }
    
    // ==================== CONTINUE FLOW ====================
    
    case 'CONTINUE_FLOW': {
      // Check if we have pending request
      const pending = pendingNameRequests.get(wa_user_id);
      if (pending) {
        // Try to extract name from message or micro data
        const extractedName = micro.extracted_data?.nama || extractNameFromMessage(message);
        if (extractedName) {
          updateProfile(wa_user_id, { nama_lengkap: extractedName });
          await updateConversationUserProfile(wa_user_id, { user_name: extractedName }, village_id, 'WHATSAPP');
          pendingNameRequests.delete(wa_user_id);
          
          logger.info('✅ Name captured via CONTINUE_FLOW', { wa_user_id, nama: extractedName });
          
          // Continue with original intent - need full NLU
          return null;
        }
        
        // Maybe they gave address instead?
        const extractedAddress = micro.extracted_data?.alamat;
        if (extractedAddress) {
          // Continue with full NLU
          return null;
        }
      }
      // Need full NLU to understand the flow
      return null;
    }
    
    // ==================== ASK INFO (general) ====================
    
    case 'ASK_INFO': {
      // Need full NLU for general info queries (need RAG context)
      return null;
    }
    
    // ==================== UNCLEAR ====================
    
    case 'UNCLEAR': {
      // AI tidak paham - tanya balik dengan pertanyaan klarifikasi
      if (micro.clarification_question) {
        return { text: micro.clarification_question };
      }
      return {
        text: 'Maaf Kak, saya kurang paham maksudnya. Bisa diperjelas?\n\nSaya bisa membantu:\n• Informasi layanan desa\n• Pengaduan/laporan masalah\n• Nomor kontak penting (damkar, puskesmas, dll)',
      };
    }
    
    default:
      // Unknown action - let full NLU handle
      return null;
  }
}

/**
 * Extract phone number from message
 */
function extractPhoneFromMessage(message: string): string | null {
  // Match Indonesian phone formats
  const patterns = [
    /(?:0|\+?62)\s?8\d{2}[\s-]?\d{4}[\s-]?\d{2,4}/,
    /08\d{8,11}/,
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      // Normalize: remove spaces/dashes, ensure starts with 08 or +62
      let phone = match[0].replace(/[\s-]/g, '');
      if (phone.startsWith('+62')) {
        phone = '0' + phone.substring(3);
      } else if (phone.startsWith('62')) {
        phone = '0' + phone.substring(2);
      }
      return phone;
    }
  }
  return null;
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

  // LAZY RAG Loading - only fetch if message looks like it needs knowledge base
  // This saves ~200ms for simple messages
  let ragContext = '';
  if (message) {
    const needsRAG = shouldFetchRAG(message);
    if (needsRAG) {
      const ragResult = await searchKnowledge(message, [], village_id || '');
      ragContext = ragResult?.context || '';
      
      logger.debug('📚 RAG context collected', {
        messageLength: message.length,
        ragContextLength: ragContext.length,
        hasContext: !!ragContext,
      });
    } else {
      logger.debug('📚 RAG skipped (simple message)', { messageLength: message.length });
    }
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
 * Handle NLU intent with full context - ADAPTIVE VERSION
 */
async function handleNLUIntent(nlu: NLUOutput, context: ProcessingContext): Promise<NLUIntentResponse> {
  const { village_id, wa_user_id, message, village_profile } = context;
  const villageName = village_profile?.name || 'Desa';

  logger.info('🎯 Handling NLU intent', {
    intent: nlu.intent,
    confidence: nlu.confidence,
    village_id,
    extractedName: nlu.extracted_data?.nama_lengkap,
    hasInfoRequest: !!(nlu as any).info_request,
    hasComplaintRequest: !!(nlu as any).complaint_request,
  });

  // Type-safe access to new fields with fallback to old fields
  const infoRequest = (nlu as any).info_request;
  const complaintRequest = (nlu as any).complaint_request;
  const flowContext = (nlu as any).flow_context;
  const clarification = (nlu as any).clarification;

  switch (nlu.intent) {
    case 'GREETING': {
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

    // NEW: Unified ASK_INFO handles all information queries
    case 'ASK_INFO': {
      // Check for emergency request first
      const isEmergency = /darurat|urgent|segera|cepat|kebakaran|kecelakaan|tolong|emergency/i.test(message);
      
      // Topic: kontak - ALWAYS try to get vCards first (even if NLU provided suggested_answer)
      // vCards are better UX on WhatsApp than text-based phone numbers
      const topic = infoRequest?.topic || '';
      const keywords = infoRequest?.keywords || [];
      const isContactQuery = topic === 'kontak' || 
        keywords.some((k: string) => /nomor|kontak|telepon|hubungi|damkar|puskesmas|polisi|ambulan/i.test(k)) ||
        /nomor|kontak|telepon|hubungi|damkar|puskesmas|polisi|ambulan/i.test(message);
      
      if (isContactQuery) {
        const categoryKeyword = keywords[0] || message;
        const categoryMatch = mapKeywordToCategory(categoryKeyword);
        
        logger.info('📇 Processing contact query', {
          categoryKeyword,
          categoryMatch,
          isEmergency,
          village_id,
        });
        
        const mockNlu = {
          ...nlu,
          contact_request: {
            category_keyword: categoryKeyword,
            category_match: categoryMatch,
            is_emergency: isEmergency,
          },
        };
        
        const contactResult = await handleContactQuery(mockNlu, village_id, villageName, 'whatsapp');
        logger.info('📇 Contact query result', {
          found: contactResult.found,
          contactsCount: contactResult.contacts?.length || 0,
          responsePreview: contactResult.response?.substring(0, 100),
        });
        
        if (contactResult.found && contactResult.contacts && contactResult.contacts.length > 0) {
          const urgentPrefix = isEmergency ? '🚨 ' : '';
          logger.info('📇 Returning contacts as vCards', { 
            count: contactResult.contacts.length, 
            category: categoryMatch || categoryKeyword,
          });
          return {
            text: `${urgentPrefix}Berikut adalah nomor ${categoryMatch || categoryKeyword} di ${villageName}:`,
            contacts: contactResult.contacts.map(c => ({
              name: c.name,
              phone: c.phone,
              organization: c.category || villageName,
              title: c.description,
            })),
          };
        }
        // If no contacts in database, fall through to suggested_answer or KB
      }
      
      // If NLU already found the answer (and not a contact query that failed above)
      if (infoRequest?.answer_found && infoRequest?.suggested_answer) {
        return { text: infoRequest.suggested_answer };
      }
      
      // Topic: alamat
      if (topic === 'alamat' && village_profile?.address) {
        if (village_profile?.gmaps_url) {
          return { text: `Kantor ${villageName} beralamat di ${village_profile.address}.\nLokasi Google Maps:\n${village_profile.gmaps_url}` };
        }
        return { text: `Alamat Kantor ${villageName}: ${village_profile.address}` };
      }
      
      // Topic: jam operasional
      if (topic === 'jam' && village_profile?.operating_hours) {
        const hours = village_profile.operating_hours;
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
      
      // Topic: layanan - list available services or service info
      if (topic === 'layanan') {
        const serviceSlug = nlu.service_request?.service_slug_match || nlu.service_request?.service_keyword;
        if (serviceSlug) {
          const llmLike = { intent: 'SERVICE_INFO', fields: { service_slug: serviceSlug, village_id } };
          const result = await handleServiceInfo(wa_user_id, llmLike);
          return { text: typeof result === 'string' ? result : result.replyText };
        }
        
        // List available services
        if (context.available_services?.length) {
          const serviceList = context.available_services.slice(0, 10).map(s => `• ${s.name}`).join('\n');
          return { text: `Layanan yang tersedia di ${villageName}:\n\n${serviceList}\n\nSilakan sebutkan layanan yang ingin Kakak ketahui lebih lanjut.` };
        }
      }
      
      // Fallback: search in RAG context
      if (context.rag_context) {
        const llmLike = {
          intent: 'KNOWLEDGE_QUERY',
          fields: { village_id, knowledge_category: topic },
        };
        try {
          const result = await handleKnowledgeQuery(wa_user_id, message, llmLike);
          if (result && typeof result === 'string' && result.length > 20) {
            return { text: result };
          }
        } catch (error: any) {
          logger.warn('Knowledge handler failed', { error: error.message });
        }
      }
      
      return { text: 'Mohon maaf Kak, informasi yang dicari belum tersedia. Ada yang lain yang bisa saya bantu?' };
    }

    // NEW: CREATE_SERVICE with database check
    case 'CREATE_SERVICE': {
      const serviceSlug = nlu.service_request?.service_slug_match || nlu.service_request?.service_keyword;
      const existsInDb = nlu.service_request?.exists_in_database;
      
      // If service doesn't exist in database, only provide info
      if (existsInDb === false || !serviceSlug) {
        if (serviceSlug) {
          return { text: `Mohon maaf Kak, layanan "${serviceSlug}" belum tersedia di ${villageName}. Silakan hubungi kantor desa langsung untuk informasi lebih lanjut.` };
        }
        return { text: 'Layanan apa yang ingin Kakak ajukan? Silakan sebutkan jenis layanannya.' };
      }
      
      const llmLike = {
        intent: 'CREATE_SERVICE_REQUEST',
        fields: { service_slug: serviceSlug, village_id, ...nlu.extracted_data },
      };
      return { text: await handleServiceRequestCreation(wa_user_id, 'whatsapp', llmLike) };
    }

    // UPDATED: CREATE_COMPLAINT with better handling and emergency support
    case 'CREATE_COMPLAINT': {
      // Use new complaint_request if available, fallback to extracted_data
      const kategori = complaintRequest?.category_match || (nlu as any).extracted_data?.complaint_category || 'lainnya';
      const deskripsi = complaintRequest?.description || (nlu as any).extracted_data?.complaint_description;
      const lokasi = complaintRequest?.location || nlu.extracted_data?.alamat;
      const isEmergency = complaintRequest?.is_emergency || /darurat|kebakaran|kecelakaan|urgent|segera|tolong|emergency/i.test(message);
      
      const llmLike = {
        intent: 'CREATE_COMPLAINT',
        fields: {
          village_id,
          kategori,
          deskripsi,
          alamat: lokasi,
          is_emergency: isEmergency,
          ...nlu.extracted_data,
        },
      };
      
      const complaintResult = await handleComplaintCreation(wa_user_id, 'whatsapp', llmLike, message);
      
      // For emergency complaints, always try to send relevant contacts
      // Also send contacts if complaint type config says so
      let contactsToSend: ImportantContact[] = [];
      
      try {
        const { resolveComplaintTypeConfig } = await import('./unified-message-processor.service');
        const complaintTypeConfig = await resolveComplaintTypeConfig(kategori, village_id);
        
        if (complaintTypeConfig?.send_important_contacts && complaintTypeConfig?.important_contact_category) {
          const configContacts = await getImportantContacts(
            village_id,
            complaintTypeConfig.important_contact_category,
            undefined
          );
          if (configContacts) contactsToSend = configContacts;
        }
        
        // For emergency, also check for Damkar/Pemadam/RS/Ambulan contacts
        if (isEmergency && contactsToSend.length === 0) {
          // Try to get emergency contacts based on keywords in message
          const emergencyCategories = ['Damkar', 'Pemadam', 'Ambulan', 'Rumah Sakit', 'Polisi', 'Keamanan'];
          for (const cat of emergencyCategories) {
            if (message.toLowerCase().includes(cat.toLowerCase().substring(0, 4)) || 
                kategori.toLowerCase().includes(cat.toLowerCase().substring(0, 4))) {
              const emergencyContacts = await getImportantContacts(village_id, cat, undefined);
              if (emergencyContacts && emergencyContacts.length > 0) {
                contactsToSend = emergencyContacts;
                break;
              }
            }
          }
          
          // If still no contacts for emergency, try Damkar for fire-related
          if (contactsToSend.length === 0 && /api|bakar|kebakaran|asap/i.test(message)) {
            const damkarContacts = await getImportantContacts(village_id, 'Damkar', undefined) ||
                                   await getImportantContacts(village_id, 'Pemadam', undefined);
            if (damkarContacts) contactsToSend = damkarContacts;
          }
        }
      } catch (error: any) {
        logger.warn('Failed to fetch important contacts for complaint', { error: error.message });
      }
      
      if (contactsToSend.length > 0) {
        const emergencyPrefix = isEmergency ? '\n\n🚨 Berikut kontak darurat yang bisa dihubungi:' : '';
        return {
          text: complaintResult + emergencyPrefix,
          contacts: contactsToSend.slice(0, 5).map((c: ImportantContact) => ({
            name: c.name || '',
            phone: c.phone || '',
            organization: c.category?.name || 'Kontak Penting',
            title: c.description || undefined,
          })),
        };
      }
      
      return { text: complaintResult };
    }

    // NEW: CONTINUE_FLOW - Resume previous flow
    case 'CONTINUE_FLOW': {
      const previousIntent = flowContext?.previous_intent;
      const providedData = flowContext?.provided_data || {};
      
      logger.info('🔄 Continuing flow', { previousIntent, providedData });
      
      // Merge provided data into extracted_data
      const mergedData = { ...nlu.extracted_data, ...providedData };
      
      // Resume based on previous intent
      if (previousIntent === 'CREATE_COMPLAINT') {
        const llmLike = {
          intent: 'CREATE_COMPLAINT',
          fields: {
            village_id,
            kategori: mergedData.complaint_category || 'lainnya',
            deskripsi: mergedData.complaint_description,
            alamat: mergedData.alamat,
          },
        };
        return { text: await handleComplaintCreation(wa_user_id, 'whatsapp', llmLike, message) };
      }
      
      if (previousIntent === 'CREATE_SERVICE') {
        const llmLike = {
          intent: 'CREATE_SERVICE_REQUEST',
          fields: { village_id, ...mergedData },
        };
        return { text: await handleServiceRequestCreation(wa_user_id, 'whatsapp', llmLike) };
      }
      
      return { text: 'Ada yang bisa saya bantu selanjutnya?' };
    }

    // NEW: CLARIFY_NEEDED - Ask for clarification
    case 'CLARIFY_NEEDED': {
      const question = clarification?.question || 'Mohon maaf, bisa diperjelas maksud Kakak?';
      const options = clarification?.options;
      
      if (options && options.length > 0) {
        const optionList = options.map((o: string, i: number) => `${i + 1}. ${o}`).join('\n');
        return { text: `${question}\n\n${optionList}` };
      }
      
      return { text: question };
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

    // Legacy intents for backward compatibility - coerce to any for old-style NLU responses
    case 'ASK_CONTACT' as any: {
      const contactRequest = (nlu as any).contact_request;
      if (contactRequest && !contactRequest.category_match && contactRequest.category_keyword) {
        contactRequest.category_match = mapKeywordToCategory(contactRequest.category_keyword) || undefined;
      }
      const contactResult = await handleContactQuery(nlu as any, village_id, villageName, 'whatsapp');
      if (contactResult.found && contactResult.contacts && contactResult.contacts.length > 0) {
        return {
          text: `Berikut adalah nomor ${contactRequest?.category_match || contactRequest?.category_keyword || 'Penting'} di ${villageName}:`,
          contacts: contactResult.contacts.map(c => ({
            name: c.name, phone: c.phone, organization: c.category || villageName, title: c.description,
          })),
        };
      }
      return { text: contactResult.response };
    }

    case 'ASK_ADDRESS' as any: {
      if (!village_profile?.address) return { text: 'Mohon maaf Kak, informasi alamat kantor belum tersedia.' };
      if (village_profile?.gmaps_url) {
        return { text: `Kantor ${villageName} beralamat di ${village_profile.address}.\nLokasi Google Maps:\n${village_profile.gmaps_url}` };
      }
      return { text: `Alamat Kantor ${villageName}: ${village_profile.address}` };
    }

    case 'ASK_HOURS' as any: {
      const hours = village_profile?.operating_hours;
      if (!hours) return { text: 'Mohon maaf Kak, informasi jam operasional belum tersedia.' };
      const lines = ['Jam operasional:'];
      for (const [day, schedule] of Object.entries(hours as Record<string, any>)) {
        if (schedule?.open && schedule?.close) lines.push(`${day.charAt(0).toUpperCase() + day.slice(1)}: ${schedule.open}–${schedule.close}`);
      }
      return { text: lines.join('\n') };
    }

    case 'ASK_SERVICE_INFO' as any: {
      const serviceSlug = nlu.service_request?.service_slug_match || nlu.service_request?.service_keyword;
      if (!serviceSlug) return { text: 'Layanan apa yang ingin Kakak ketahui? Silakan sebutkan nama layanannya.' };
      const llmLike = { intent: 'SERVICE_INFO', fields: { service_slug: serviceSlug, village_id } };
      const result = await handleServiceInfo(wa_user_id, llmLike);
      return { text: typeof result === 'string' ? result : result.replyText };
    }

    case 'CREATE_SERVICE_REQUEST' as any: {
      const serviceSlug = nlu.service_request?.service_slug_match || nlu.service_request?.service_keyword;
      if (!serviceSlug) return { text: 'Layanan apa yang ingin Kakak ajukan? Silakan sebutkan jenis layanannya.' };
      const llmLike = { intent: 'CREATE_SERVICE_REQUEST', fields: { service_slug: serviceSlug, village_id, ...nlu.extracted_data } };
      return { text: await handleServiceRequestCreation(wa_user_id, 'whatsapp', llmLike) };
    }

    case 'ASK_KNOWLEDGE' as any:
    case 'ASK_ABOUT_CONVERSATION' as any: {
      const knowledgeReq = (nlu as any).knowledge_request;
      if (knowledgeReq?.suggested_answer) return { text: knowledgeReq.suggested_answer };
      if (context.rag_context) {
        const llmLike = { intent: 'KNOWLEDGE_QUERY', fields: { village_id } };
        try {
          const result = await handleKnowledgeQuery(wa_user_id, message, llmLike);
          if (result && typeof result === 'string' && result.length > 20) return { text: result };
        } catch { /* ignore */ }
      }
      return { text: 'Mohon maaf Kak, informasi yang dicari belum tersedia. Ada yang lain yang bisa saya bantu?' };
    }

    case 'UNKNOWN':
    default:
      return { text: 'Mohon maaf, saya kurang paham maksud Kakak. Bisa dijelaskan lebih detail? Saya bisa bantu untuk:\n• Informasi kontak penting\n• Informasi layanan\n• Membuat pengaduan/laporan\n• Mengurus layanan administrasi' };
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
