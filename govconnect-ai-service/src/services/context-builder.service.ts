import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { SYSTEM_PROMPT_WITH_KNOWLEDGE, getFullSystemPrompt } from '../prompts/system-prompt';
import { RAGContext } from '../types/embedding.types';
import { inferCategories, retrieveContext } from './rag.service';
import { getRealTimeContext, getVillageProfileSummary } from './knowledge.service';

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
  villageId?: string
) {
  logger.info('Building context for LLM', { wa_user_id });

  try {
    const effectiveVillageId = villageId || process.env.DEFAULT_VILLAGE_ID;

    const inferredCategories = inferCategories(currentMessage);

    const historyPromise = fetchMessageHistory(wa_user_id, config.maxHistoryMessages);

    const ragPromise: Promise<RAGContext | string | null> = (async () => {
      if (ragContext) return ragContext;
      try {
        return await retrieveContext(currentMessage, {
          topK: 5,
          minScore: 0.55,
          categories: inferredCategories.length > 0 ? inferredCategories : undefined,
          sourceTypes: ['knowledge', 'document'],
          villageId: effectiveVillageId,
        });
      } catch {
        return null;
      }
    })();

    const livePromise = getRealTimeContext(currentMessage, effectiveVillageId, wa_user_id);
    const villageProfilePromise = getVillageProfileSummary(effectiveVillageId);

    const [messages, ragResult, liveContext, villageProfile] = await Promise.all([
      historyPromise,
      ragPromise,
      livePromise,
      villageProfilePromise,
    ]);

    const conversationHistory = formatConversationHistory(messages);

    const SYSTEM_CONTEXT = buildSystemContext({
      rag: ragResult,
      liveContext,
      villageProfile,
    });

    const knowledgeSection = SYSTEM_CONTEXT ? `\n\nSYSTEM_CONTEXT\n${SYSTEM_CONTEXT}` : '';
    
    // Calculate current date and tomorrow for prompt
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const currentDate = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const tomorrowDate = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Build full prompt using complete system prompt (all parts combined)
    const systemPrompt = getFullSystemPrompt()
      .replace('{knowledge_context}', knowledgeSection)
      .replace('{history}', conversationHistory)
      .replace('{user_message}', currentMessage)
      .replace(/\{\{current_date\}\}/g, currentDate)
      .replace(/\{\{tomorrow_date\}\}/g, tomorrowDate);
    
    // Log the formatted history for debugging
    logger.debug('Conversation history formatted', {
      wa_user_id,
      history: conversationHistory.substring(0, 500), // First 500 chars
    });
    
    logger.debug('Context built successfully', {
      wa_user_id,
      messageCount: messages.length,
      promptLength: systemPrompt.length,
      hasKnowledge: !!SYSTEM_CONTEXT,
      knowledgeConfidence: typeof ragResult === 'object' && ragResult ? (ragResult as any)?.confidence?.level : 'N/A',
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

function buildSystemContext(input: {
  rag: RAGContext | string | null;
  liveContext: string;
  villageProfile: { name?: string | null; short_name?: string | null; address?: string | null; gmaps_url?: string | null } | null;
}): string {
  const sections: string[] = [];

  if (input.villageProfile && (input.villageProfile.name || input.villageProfile.address || input.villageProfile.gmaps_url)) {
    const profileLines = [
      input.villageProfile.name ? `Nama Desa/Kelurahan: ${input.villageProfile.name}` : null,
      input.villageProfile.short_name ? `Nama Singkat: ${input.villageProfile.short_name}` : null,
      input.villageProfile.address ? `Alamat: ${input.villageProfile.address}` : null,
      input.villageProfile.gmaps_url ? `Google Maps: ${input.villageProfile.gmaps_url}` : null,
    ].filter(Boolean).join('\n');

    if (profileLines) {
      sections.push(`--- VILLAGE PROFILE (LIVE) ---\n${profileLines}`);
    }
  }

  if (input.liveContext && input.liveContext.trim()) {
    sections.push(`--- LIVE DATABASE INFO ---\n${input.liveContext.trim()}`);
  }

  const docsSection = buildDocsSection(input.rag);
  if (docsSection) {
    sections.push(docsSection);
  }

  return sections.join('\n\n');
}

function buildDocsSection(rag: RAGContext | string | null): string {
  if (!rag) return '';

  if (typeof rag === 'string') {
    const content = rag.trim();
    if (!content) return '';
    return `--- KNOWLEDGE BASE (DOCS) ---\n${content}`;
  }

  if (rag.totalResults === 0 || !rag.contextString) return '';

  const confidence = rag.confidence;
  const confidenceLine = confidence
    ? `\n[CONFIDENCE: ${confidence.level.toUpperCase()} - ${confidence.reason}]`
    : '';

  return `--- KNOWLEDGE BASE (DOCS) ---\n${rag.contextString}${confidenceLine}`;
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

  try {
    // Fetch message history from Channel Service
    const messages = await fetchMessageHistory(wa_user_id, config.maxHistoryMessages);
    
    // Format conversation history
    const conversationHistory = formatConversationHistory(messages);
    
    // Build full prompt using knowledge-specific template
    const systemPrompt = SYSTEM_PROMPT_WITH_KNOWLEDGE
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
    const fallbackPrompt = SYSTEM_PROMPT_WITH_KNOWLEDGE
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
