import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { SYSTEM_PROMPT_WITH_KNOWLEDGE, getFullSystemPrompt, getAdaptiveSystemPrompt, type PromptFocus } from '../prompts/system-prompt';
import { RAGContext } from '../types/embedding.types';

interface Message {
  id: string;
  message_text: string;
  direction: 'IN' | 'OUT';
  source: string;
  timestamp: string;
}

interface MessageHistoryResponse {
  messages: Message[];
  total: number;
}

/**
 * Build context for LLM including system prompt and conversation history
 * Now accepts full RAGContext to utilize confidence scoring
 */
export async function buildContext(
  wa_user_id: string, 
  currentMessage: string, 
  ragContext?: RAGContext | string,
  complaintCategoriesText?: string,
  promptFocus?: PromptFocus
) {
  logger.info('Building context for LLM', { wa_user_id, promptFocus: promptFocus || 'full' });

  try {
    // Fetch message history from Channel Service
    const messages = await fetchMessageHistory(wa_user_id, config.maxHistoryMessages);
    
    // Format conversation history
    const conversationHistory = formatConversationHistory(messages);
    
    // Build knowledge section with confidence-aware instructions
    const knowledgeSection = buildKnowledgeSection(ragContext);
    
    // Calculate current date, time, and tomorrow for prompt (in WIB timezone)
    const now = new Date();
    const wibOffset = 7 * 60; // WIB is UTC+7
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const wibTime = new Date(utc + (wibOffset * 60000));
    
    const currentDate = wibTime.toISOString().split('T')[0]; // YYYY-MM-DD
    const tomorrow = new Date(wibTime);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Get current time info for greeting
    const currentHour = wibTime.getHours();
    let timeOfDay = 'malam';
    if (currentHour >= 5 && currentHour < 11) timeOfDay = 'pagi';
    else if (currentHour >= 11 && currentHour < 15) timeOfDay = 'siang';
    else if (currentHour >= 15 && currentHour < 18) timeOfDay = 'sore';
    
    const currentTime = wibTime.toTimeString().split(' ')[0].substring(0, 5); // HH:MM

    // Default complaint categories fallback
    const categoriesText = complaintCategoriesText || 'jalan_rusak, lampu_mati, sampah, drainase, pohon_tumbang, fasilitas_rusak, banjir, tindakan_kriminal, kebakaran, lainnya';
    
    // Build full prompt using adaptive system prompt (filters by focus)
    const systemPrompt = (promptFocus ? getAdaptiveSystemPrompt(promptFocus) : getFullSystemPrompt())
      .replace('{knowledge_context}', knowledgeSection)
      .replace('{history}', conversationHistory)
      .replace('{user_message}', currentMessage)
      .replace(/\{\{current_date\}\}/g, currentDate)
      .replace(/\{\{tomorrow_date\}\}/g, tomorrowDate)
      .replace(/\{\{current_time\}\}/g, currentTime)
      .replace(/\{\{time_of_day\}\}/g, timeOfDay)
      .replace(/\{\{complaint_categories\}\}/g, categoriesText);
    
    // Log the formatted history for debugging
    logger.debug('Conversation history formatted', {
      wa_user_id,
      history: conversationHistory.substring(0, 500), // First 500 chars
    });
    
    logger.debug('Context built successfully', {
      wa_user_id,
      messageCount: messages.length,
      promptLength: systemPrompt.length,
      hasKnowledge: !!ragContext,
      knowledgeConfidence: typeof ragContext === 'object' ? ragContext?.confidence?.level : 'N/A',
    });
    
    return {
      systemPrompt,
      messageCount: messages.length,
    };
  } catch (error: any) {
    logger.error('Failed to build context', {
      wa_user_id,
      error: error.message,
    });
    
    // Fallback: return prompt without history
    const fallbackPrompt = getFullSystemPrompt()
      .replace('{knowledge_context}', '')
      .replace('{history}', '(No conversation history available)')
      .replace('{user_message}', currentMessage);
    
    return {
      systemPrompt: fallbackPrompt,
      messageCount: 0,
    };
  }
}

/**
 * Build knowledge section with confidence-aware instructions
 */
function buildKnowledgeSection(ragContext?: RAGContext | string): string {
  if (!ragContext) {
    return '';
  }
  
  // Handle legacy string format (backward compatibility)
  if (typeof ragContext === 'string') {
    if (!ragContext.trim()) return '';
    return `\n\nKNOWLEDGE BASE YANG TERSEDIA:\n${ragContext}`;
  }
  
  // Handle full RAGContext object
  if (ragContext.totalResults === 0 || !ragContext.contextString) {
    return '';
  }
  
  const confidence = ragContext.confidence;
  let confidenceInstruction = '';
  
  if (confidence) {
    switch (confidence.level) {
      case 'high':
        confidenceInstruction = `\n[CONFIDENCE: TINGGI - ${confidence.reason}]
INSTRUKSI: Jawab berdasarkan knowledge di atas. Informasi sangat relevan dengan pertanyaan user.`;
        break;
      case 'medium':
        confidenceInstruction = `\n[CONFIDENCE: SEDANG - ${confidence.reason}]
INSTRUKSI: Gunakan knowledge di atas sebagai sumber utama. Boleh tambahkan info umum jika perlu.`;
        break;
      case 'low':
        confidenceInstruction = `\n[CONFIDENCE: RENDAH - ${confidence.reason}]
INSTRUKSI: Knowledge mungkin hanya sebagian relevan. Gunakan dengan hati-hati, boleh jawab dengan pengetahuan umum.`;
        break;
      default:
        confidenceInstruction = '';
    }
  }
  
  return `\n\nKNOWLEDGE BASE YANG TERSEDIA:
${ragContext.contextString}
${confidenceInstruction}`;
}

/**
 * Build context specifically for knowledge query (second LLM call)
 */
export async function buildKnowledgeQueryContext(
  wa_user_id: string, 
  currentMessage: string, 
  knowledgeContext: string
) {
  logger.info('Building knowledge query context', { wa_user_id });

  const KNOWLEDGE_QA_SYSTEM_PROMPT = `Anda adalah **Gana** (petugas layanan desa/kelurahan).

ATURAN OUTPUT (WAJIB):
1) Output HANYA JSON valid sesuai schema sistem (intent, fields, reply_text, guidance_text, needs_knowledge, follow_up_questions)
2) intent WAJIB = "KNOWLEDGE_QUERY"
3) reply_text WAJIB menjawab pertanyaan user berdasarkan KNOWLEDGE_CONTEXT.

ATURAN ANTI-HALUSINASI (KRITIS):
- Jawab HANYA dari KNOWLEDGE_CONTEXT di bawah.
- DILARANG mengarang alamat, jam operasional, nomor telepon, tautan, biaya, atau prosedur yang tidak ada di KNOWLEDGE_CONTEXT.
- DILARANG mengarahkan user untuk mengisi form publik / mengirim link layanan, kecuali link tersebut benar-benar ada di KNOWLEDGE_CONTEXT.
- Jika informasi tidak ada di KNOWLEDGE_CONTEXT, reply_text harus menyatakan data belum tersedia untuk desa/kelurahan ini dan (opsional) menyarankan hubungi kantor pada jam kerja.

KNOWLEDGE_CONTEXT:
{knowledge_context}

CONVERSATION_HISTORY:
{history}

PESAN TERAKHIR USER:
{user_message}`;

  try {
    // Fetch message history from Channel Service
    const messages = await fetchMessageHistory(wa_user_id, config.maxHistoryMessages);
    
    // Format conversation history
    const conversationHistory = formatConversationHistory(messages);
    
    // Build full prompt using knowledge-specific template
    const systemPrompt = KNOWLEDGE_QA_SYSTEM_PROMPT
      .replace('{knowledge_context}', knowledgeContext)
      .replace('{history}', conversationHistory)
      .replace('{user_message}', currentMessage);
    
    logger.debug('Knowledge query context built', {
      wa_user_id,
      messageCount: messages.length,
      knowledgeLength: knowledgeContext.length,
    });
    
    return {
      systemPrompt,
      messageCount: messages.length,
    };
  } catch (error: any) {
    logger.error('Failed to build knowledge query context', {
      wa_user_id,
      error: error.message,
    });
    
    // Fallback
    const fallbackPrompt = KNOWLEDGE_QA_SYSTEM_PROMPT
      .replace('{knowledge_context}', knowledgeContext)
      .replace('{history}', '(No conversation history available)')
      .replace('{user_message}', currentMessage);
    
    return {
      systemPrompt: fallbackPrompt,
      messageCount: 0,
    };
  }
}

/**
 * Fetch message history from Channel Service internal API
 */
async function fetchMessageHistory(wa_user_id: string, limit: number): Promise<Message[]> {
  try {
    const url = `${config.channelServiceUrl}/internal/messages`;
    const response = await axios.get<MessageHistoryResponse>(url, {
      params: { wa_user_id, limit },
      headers: {
        'x-internal-api-key': config.internalApiKey,
      },
      timeout: 5000,
    });
    
    logger.debug('Fetched message history', {
      wa_user_id,
      count: response.data.messages.length,
    });
    
    return response.data.messages || [];
  } catch (error: any) {
    logger.error('Failed to fetch message history', {
      wa_user_id,
      error: error.message,
    });
    return [];
  }
}

/**
 * Extract user's name from conversation history
 * Looks for patterns like "nama saya X", "saya X", "panggil saya X"
 */
function extractUserName(messages: Message[]): string | null {
  // Patterns to detect name introduction
  const namePatterns = [
    /nama\s+(?:saya|aku|gue|gw)\s+(?:adalah\s+)?([a-zA-Z]+)/i,
    /(?:saya|aku|gue|gw)\s+([a-zA-Z]+)(?:\s+kak)?$/i,
    /panggil\s+(?:saya|aku)\s+([a-zA-Z]+)/i,
    /(?:^|\s)([a-zA-Z]+)\s+(?:kak|pak|bu)?\s*$/i,  // Simple name at end of message
  ];
  
  // Check user messages (IN direction) for name patterns
  for (const msg of messages) {
    if (msg.direction !== 'IN') continue;
    const text = msg.message_text.trim();
    
    // Skip if message is too long (probably not just a name)
    if (text.length > 50) continue;
    
    // Skip common non-name responses
    const skipPatterns = [
      /^(ya|iya|ok|oke|baik|siap|terima kasih|makasih|halo|hai|hi|hello)$/i,
      /^(mau|ingin|butuh|perlu|tolong|bantu)/i,
      /^(jalan|lampu|sampah|rusak|mati)/i,
    ];
    if (skipPatterns.some(p => p.test(text))) continue;
    
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        // Validate: name should be 2-20 chars, only letters
        if (name.length >= 2 && name.length <= 20 && /^[a-zA-Z]+$/.test(name)) {
          // Capitalize first letter
          return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
        }
      }
    }
  }
  
  return null;
}

/**
 * Format conversation history for LLM
 * Includes timestamp context and message summarization for long histories
 * Now also extracts and highlights user's name if found
 */
function formatConversationHistory(messages: Message[]): string {
  if (messages.length === 0) {
    return '(Ini adalah percakapan pertama dengan user)';
  }
  
  // Extract user's name from history
  const userName = extractUserName(messages);
  
  // If history is very long, summarize older messages
  const MAX_DETAILED_MESSAGES = 10;
  let formatted = '';
  
  // Add user name context at the top if found
  if (userName) {
    formatted += `[INFO USER: Nama user adalah "${userName}" - GUNAKAN nama ini untuk memanggil!]\n\n`;
  }
  
  if (messages.length > MAX_DETAILED_MESSAGES) {
    // Summarize older messages
    const olderMessages = messages.slice(0, messages.length - MAX_DETAILED_MESSAGES);
    const recentMessages = messages.slice(-MAX_DETAILED_MESSAGES);
    
    // Extract key info from older messages (complaints, addresses, etc.)
    const extractedInfo = extractKeyInfo(olderMessages);
    if (extractedInfo) {
      formatted += `[RINGKASAN PERCAKAPAN SEBELUMNYA]\n${extractedInfo}\n\n[PERCAKAPAN TERBARU]\n`;
    }
    
    // Format recent messages with relative time
    formatted += recentMessages.map(msg => {
      const role = msg.direction === 'IN' ? 'User' : 'Assistant';
      const timeAgo = getRelativeTime(msg.timestamp);
      return `${role} (${timeAgo}): ${msg.message_text}`;
    }).join('\n');
  } else {
    // Format all messages normally
    formatted += messages.map(msg => {
      const role = msg.direction === 'IN' ? 'User' : 'Assistant';
      return `${role}: ${msg.message_text}`;
    }).join('\n');
  }
  
  return formatted;
}

/**
 * Extract key information from older messages for context
 */
function extractKeyInfo(messages: Message[]): string {
  const info: string[] = [];
  
  // First, try to extract user's name
  const userName = extractUserName(messages);
  if (userName) {
    info.push(`- Nama user: ${userName} (GUNAKAN nama ini!)`);
  }
  
  // Look for addresses mentioned
  const addressPatterns = [
    /(?:di|alamat|lokasi)\s+([a-zA-Z0-9\s,.-]+(?:gang|jalan|jln|jl|rt|rw|no|blok)[a-zA-Z0-9\s,.-]*)/gi,
    /(?:depan|dekat|belakang|samping)\s+([a-zA-Z0-9\s]+)/gi,
  ];
  
  // Look for complaint types
  const complaintKeywords = ['rusak', 'mati', 'sampah', 'banjir', 'tumbang', 'tersumbat'];
  
  // Look for service types
  const serviceKeywords = ['surat', 'domisili', 'pengantar', 'izin', 'skck'];
  
  const mentionedAddresses: string[] = [];
  const mentionedProblems: string[] = [];
  const mentionedServices: string[] = [];
  
  for (const msg of messages) {
    if (msg.direction !== 'IN') continue;
    const text = msg.message_text.toLowerCase();
    
    // Check for complaints
    for (const keyword of complaintKeywords) {
      if (text.includes(keyword) && !mentionedProblems.includes(keyword)) {
        mentionedProblems.push(keyword);
      }
    }
    
    // Check for services
    for (const keyword of serviceKeywords) {
      if (text.includes(keyword) && !mentionedServices.includes(keyword)) {
        mentionedServices.push(keyword);
      }
    }
    
    // Extract addresses (simplified)
    for (const pattern of addressPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 3 && !mentionedAddresses.includes(match[1].trim())) {
          mentionedAddresses.push(match[1].trim());
        }
      }
    }
  }
  
  if (mentionedProblems.length > 0) {
    info.push(`- Masalah disebutkan: ${mentionedProblems.join(', ')}`);
  }
  if (mentionedServices.length > 0) {
    info.push(`- Layanan diminta: ${mentionedServices.join(', ')}`);
  }
  if (mentionedAddresses.length > 0) {
    info.push(`- Alamat disebutkan: ${mentionedAddresses.slice(0, 2).join(', ')}`);
  }
  
  return info.length > 0 ? info.join('\n') : '';
}

/**
 * Get relative time string from timestamp
 */
function getRelativeTime(timestamp: string): string {
  const now = new Date();
  const msgTime = new Date(timestamp);
  const diffMs = now.getTime() - msgTime.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return 'baru saja';
  if (diffMins < 60) return `${diffMins} menit lalu`;
  if (diffHours < 24) return `${diffHours} jam lalu`;
  if (diffDays === 1) return 'kemarin';
  return `${diffDays} hari lalu`;
}

/**
 * Sanitize user input to prevent prompt injection
 * Removes potentially harmful patterns while preserving valid content
 */
export function sanitizeUserInput(input: string): string {
  if (!input) return '';
  
  // Remove excessive whitespace
  let sanitized = input.replace(/\s+/g, ' ').trim();
  
  // Remove control characters (except newlines)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Limit length to prevent context overflow
  if (sanitized.length > 1000) {
    sanitized = sanitized.substring(0, 1000) + '...';
  }
  
  // Remove potential prompt injection patterns
  const injectionPatterns = [
    /ignore\s+(previous|all|above)\s+instructions?/gi,
    /you\s+are\s+(now|a)\s+/gi,
    /system\s*:\s*/gi,
    /\[\s*INST\s*\]/gi,
    /<\/?system>/gi,
    /\{\{[^}]+\}\}/g,  // Template injection
  ];
  
  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '');
  }
  
  return sanitized.trim();
}
