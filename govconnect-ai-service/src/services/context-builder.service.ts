import axios from 'axios';
import logger from '../utils/logger';
import { config } from '../config/env';
import { SYSTEM_PROMPT_TEMPLATE } from '../prompts/system-prompt';

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
 */
export async function buildContext(wa_user_id: string, currentMessage: string) {
  logger.info('Building context for LLM', { wa_user_id });

  try {
    // Fetch message history from Channel Service
    const messages = await fetchMessageHistory(wa_user_id, config.maxHistoryMessages);
    
    // Format conversation history
    const conversationHistory = formatConversationHistory(messages);
    
    // Build full prompt
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace('{history}', conversationHistory)
      .replace('{user_message}', currentMessage);
    
    logger.debug('Context built successfully', {
      wa_user_id,
      messageCount: messages.length,
      promptLength: systemPrompt.length,
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
    const fallbackPrompt = SYSTEM_PROMPT_TEMPLATE
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
 * Format conversation history for LLM
 */
function formatConversationHistory(messages: Message[]): string {
  if (messages.length === 0) {
    return '(Ini adalah percakapan pertama dengan user)';
  }
  
  // Messages are already sorted oldest first from Channel Service
  const formatted = messages.map(msg => {
    const role = msg.direction === 'IN' ? 'User' : 'Assistant';
    return `${role}: ${msg.message_text}`;
  }).join('\\n');
  
  return formatted;
}
