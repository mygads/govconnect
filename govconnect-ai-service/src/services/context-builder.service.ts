import axios from 'axios';
import logger from '../utils/logger';
import { getWIBDateTime } from '../utils/wib-datetime';
import { config } from '../config/env';
import { getFullSystemPrompt, getAdaptiveSystemPrompt, type PromptFocus } from '../prompts/system-prompt';
import { RAGContext } from '../types/embedding.types';
import { summarizeConversation } from './micro-llm-matcher.service';
import { buildComplaintCategoriesText } from './complaint-handler';

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
  promptFocus?: PromptFocus,
  villageName?: string
) {
  logger.info('Building context for LLM', { wa_user_id, promptFocus: promptFocus || 'full' });

  try {
    // Fetch message history from Channel Service
    const messages = await fetchMessageHistory(wa_user_id, config.maxHistoryMessages);
    
    // Format conversation history (uses micro-LLM summarization for long histories)
    const conversationHistory = await formatConversationHistory(messages, wa_user_id);
    
    // Build knowledge section with confidence-aware instructions
    const knowledgeSection = buildKnowledgeSection(ragContext);
    const hasKnowledge = !!knowledgeSection.trim();
    
    // Calculate current date, time, and tomorrow for prompt (in WIB timezone)
    const wib = getWIBDateTime();
    const currentDate = wib.date;
    const tomorrowDate = wib.tomorrow;
    const currentTime = wib.time;
    const timeOfDay = wib.timeOfDay;

    // Default complaint categories: use dynamic DB-driven list when available
    const categoriesText = complaintCategoriesText || await buildComplaintCategoriesText(undefined);
    
    // Build full prompt using adaptive system prompt (filters by focus)
    // Pass hasKnowledge to skip PART5_KNOWLEDGE block when RAG returned no results (~400 tokens saved)
    const systemPrompt = (promptFocus ? getAdaptiveSystemPrompt(promptFocus, hasKnowledge) : getFullSystemPrompt())
      .replace('{knowledge_context}', knowledgeSection)
      .replace('{history}', conversationHistory)
      .replace('{user_message}', currentMessage)
      .replace(/\{\{current_date\}\}/g, currentDate)
      .replace(/\{\{tomorrow_date\}\}/g, tomorrowDate)
      .replace(/\{\{current_time\}\}/g, currentTime)
      .replace(/\{\{time_of_day\}\}/g, timeOfDay)
      .replace(/\{\{complaint_categories\}\}/g, categoriesText)
      .replace(/\{\{village_name\}\}/g, villageName || 'Desa');
    
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
    // Still need to replace all template placeholders to avoid raw strings in LLM
    const wibFallback = getWIBDateTime();
    
    const fallbackPrompt = getFullSystemPrompt()
      .replace('{knowledge_context}', '')
      .replace('{history}', '(No conversation history available)')
      .replace('{user_message}', currentMessage)
      .replace(/\{\{current_date\}\}/g, wibFallback.date)
      .replace(/\{\{tomorrow_date\}\}/g, wibFallback.tomorrow)
      .replace(/\{\{current_time\}\}/g, wibFallback.time)
      .replace(/\{\{time_of_day\}\}/g, wibFallback.timeOfDay)
      .replace(/\{\{complaint_categories\}\}/g, await buildComplaintCategoriesText(undefined))
      .replace(/\{\{village_name\}\}/g, villageName || 'Desa');
    
    return {
      systemPrompt: fallbackPrompt,
      messageCount: 0,
    };
  }
}

/**
 * Build knowledge section with confidence-aware instructions.
 * 
 * Includes:
 * - DB-FIRST PRIORITY: If context contains "[SUMBER: DATABASE RESMI]", instruct LLM
 *   to prioritize that data over RAG knowledge base results.
 * - CONFLICT HANDLING: If context contains "⚠️ [KONFLIK DATA", instruct LLM to show
 *   all conflicting versions and tell the user about the discrepancy.
 */
function buildKnowledgeSection(ragContext?: RAGContext | string): string {
  if (!ragContext) {
    return '';
  }
  
  // Handle legacy string format (backward compatibility)
  if (typeof ragContext === 'string') {
    if (!ragContext.trim()) return '';
    return `\n\nKNOWLEDGE BASE YANG TERSEDIA:\n${sanitizeKnowledgeContext(ragContext)}`;
  }
  
  // Handle full RAGContext object
  if (ragContext.totalResults === 0 || !ragContext.contextString) {
    return '';
  }

  const contextStr = sanitizeKnowledgeContext(ragContext.contextString);
  
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

  // DB-FIRST PRIORITY instruction — only added when DB data is present
  let dbPriorityInstruction = '';
  if (contextStr.includes('[SUMBER: DATABASE RESMI')) {
    dbPriorityInstruction = `\n\n[PRIORITAS DATA]
ATURAN: Untuk field yang tercantum di DATABASE RESMI (nama desa, alamat, jam operasional, kepala desa, dll), SELALU gunakan data DATABASE RESMI karena bersifat otoritatif.
Untuk informasi yang TIDAK tercantum di DATABASE RESMI (misalnya struktur organisasi, sejarah desa, dll), gunakan data dari knowledge base/dokumen.
JANGAN katakan "belum memiliki informasi" jika data tersedia di knowledge base/dokumen meskipun tidak ada di DATABASE RESMI.`;
  }

  // CONFLICT DETECTION instruction — only added when conflicts are detected
  let conflictInstruction = '';
  if (contextStr.includes('KONFLIK DATA')) {
    conflictInstruction = `\n\n[PENANGANAN DATA BERBEDA]
ATURAN: Jika ditemukan data yang BERBEDA dari sumber berbeda tentang topik yang sama (ditandai ⚠️ KONFLIK DATA):
1. Tampilkan SEMUA versi data yang ditemukan.
2. Beri tahu user: "Kami menemukan beberapa data yang berbeda mengenai topik ini dari sumber yang berbeda:"
3. Sebutkan sumber masing-masing data.
4. Sarankan user untuk mengonfirmasi ke kantor desa/kelurahan untuk data yang paling terbaru.
5. JANGAN pilih salah satu — biarkan user yang menentukan mana yang benar.
KECUALI: Jika salah satu sumber adalah DATABASE RESMI, maka prioritaskan data DATABASE RESMI dan jelaskan bahwa sumber lain mungkin sudah tidak berlaku.`;
  }
  
  return `\n\nKNOWLEDGE BASE YANG TERSEDIA:
${contextStr}
${confidenceInstruction}${dbPriorityInstruction}${conflictInstruction}`;
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

PRIORITAS DATA:
- Jika ada data bertanda [SUMBER: DATABASE RESMI], gunakan data tersebut untuk field yang tercantum di dalamnya karena bersifat otoritatif.
- Untuk informasi yang TIDAK tercantum di DATABASE RESMI, gunakan data dari knowledge base/dokumen.
- JANGAN katakan "belum memiliki informasi" jika data tersedia di knowledge base/dokumen meskipun tidak ada di DATABASE RESMI.

PENANGANAN DATA BERBEDA:
- Jika ditemukan data yang BERBEDA dari sumber berbeda (ditandai ⚠️ KONFLIK DATA), tampilkan SEMUA versi dan beri tahu user bahwa ada perbedaan data dari beberapa sumber.
- Sarankan user untuk mengonfirmasi ke kantor desa/kelurahan untuk data terbaru.
- KECUALI jika salah satu sumber adalah DATABASE RESMI — gunakan DATABASE RESMI dan jelaskan bahwa sumber lain mungkin sudah tidak berlaku.

KNOWLEDGE_CONTEXT:
{knowledge_context}

CONVERSATION_HISTORY:
{history}

PESAN TERAKHIR USER:
{user_message}`;

  try {
    // Fetch message history from Channel Service
    const messages = await fetchMessageHistory(wa_user_id, config.maxHistoryMessages);
    
    // Format conversation history (micro-LLM summarization for long histories)
    const conversationHistory = await formatConversationHistory(messages, wa_user_id);
    
    // Build full prompt using knowledge-specific template
    const systemPrompt = KNOWLEDGE_QA_SYSTEM_PROMPT
      .replace('{knowledge_context}', sanitizeKnowledgeContext(knowledgeContext))
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
 * Uses micro-LLM summarization for histories > SUMMARIZE_THRESHOLD messages
 */
async function formatConversationHistory(messages: Message[], wa_user_id?: string): Promise<string> {
  if (messages.length === 0) {
    return '(Ini adalah percakapan pertama dengan user)';
  }
  
  // Extract user's name from history
  const userName = extractUserName(messages);
  
  // Threshold for micro-LLM summarization (saves ~500-1000 tokens for long conversations)
  const SUMMARIZE_THRESHOLD = 8;
  const MAX_RECENT_MESSAGES = 6;
  let formatted = '';
  
  // Add user name context at the top if found
  if (userName) {
    formatted += `[INFO USER: Nama user adalah "${userName}" - GUNAKAN nama ini untuk memanggil!]\n\n`;
  }
  
  if (messages.length > SUMMARIZE_THRESHOLD) {
    // Split: older messages for summary, recent messages kept verbatim
    const olderMessages = messages.slice(0, messages.length - MAX_RECENT_MESSAGES);
    const recentMessages = messages.slice(-MAX_RECENT_MESSAGES);
    
    // Try micro-LLM summarization first (smarter, more concise)
    const olderForSummary = olderMessages.map(m => ({
      role: m.direction === 'IN' ? 'User' : 'Assistant',
      content: m.message_text,
    }));
    
    let summaryText: string | null = null;
    try {
      summaryText = await summarizeConversation(olderForSummary, { wa_user_id });
    } catch (err: any) {
      logger.warn('Micro-LLM summarization failed, falling back to keyword extraction', {
        wa_user_id, error: err.message,
      });
    }
    
    if (summaryText) {
      formatted += `[RINGKASAN PERCAKAPAN SEBELUMNYA (${olderMessages.length} pesan)]\n${summaryText}\n\n[PERCAKAPAN TERBARU]\n`;
    } else {
      // Fallback: keyword-based extraction
      const extractedInfo = extractKeyInfo(olderMessages);
      if (extractedInfo) {
        formatted += `[RINGKASAN PERCAKAPAN SEBELUMNYA]\n${extractedInfo}\n\n[PERCAKAPAN TERBARU]\n`;
      }
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
 * Extract key information from older messages for context.
 * This is only the fallback when micro-LLM summarization fails.
 * 
 * Instead of using hardcoded regex patterns for address/topic extraction,
 * we keep it minimal — only the user's name. The LLM handles topic/address
 * extraction via its structured JSON output (fields.alamat, fields.kategori, etc.).
 */
function extractKeyInfo(messages: Message[]): string {
  const info: string[] = [];
  
  // Extract user's name (structural pattern — not classification)
  const userName = extractUserName(messages);
  if (userName) {
    info.push(`- Nama user: ${userName} (GUNAKAN nama ini!)`);
  }
  
  // Include a raw excerpt of recent user messages so LLM has context.
  // No regex extraction — let the LLM interpret the content.
  const userMessages = messages
    .filter(m => m.direction === 'IN')
    .slice(-5)  // Last 5 user messages
    .map(m => m.message_text.substring(0, 100));
  
  if (userMessages.length > 0) {
    info.push(`- Pesan user sebelumnya: ${userMessages.join(' | ')}`);
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
    // Indonesian prompt injection patterns
    /abaikan\s+(instruksi|perintah|aturan)\s+(sebelumnya|di\s*atas|semua)/gi,
    /lupakan\s+(instruksi|perintah|aturan)/gi,
    /kamu\s+(sekarang|adalah)\s+(seorang|menjadi)/gi,
    // Role injection prevention (could trick LLM via conversation history)
    /^(assistant|system)\s*:/gmi,
  ];
  
  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '');
  }
  
  return sanitized.trim();
}

/**
 * Sanitize knowledge context retrieved from RAG before injecting into prompts.
 * Lighter than sanitizeUserInput — knowledge is admin-managed but could still
 * contain injection patterns if malicious content was uploaded to KB.
 */
function sanitizeKnowledgeContext(context: string): string {
  if (!context) return '';

  let sanitized = context;

  // Remove control characters (except \n, \r, \t for formatting)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Strip prompt injection patterns that could override system instructions
  const injectionPatterns = [
    /ignore\s+(previous|all|above)\s+instructions?/gi,
    /you\s+are\s+(now|a)\s+/gi,
    /\[\s*INST\s*\]/gi,
    /<\/?system>/gi,
    /\{\{[^}]+\}\}/g,
    /abaikan\s+(instruksi|perintah|aturan)\s+(sebelumnya|di\s*atas|semua)/gi,
    /lupakan\s+(instruksi|perintah|aturan)/gi,
    /^(assistant|system)\s*:/gmi,
  ];

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '');
  }

  return sanitized;
}
