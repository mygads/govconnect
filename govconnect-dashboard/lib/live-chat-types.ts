/**
 * Live Chat Types
 * Types untuk fitur live chat di landing page
 */

export interface ChatMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'error';
}

export interface ChatVillage {
  id: string;
  name: string;
  slug?: string;
}

export interface ChatSession {
  sessionId: string;
  village: ChatVillage;
  messages: ChatMessage[];
  createdAt: Date;
  lastActivity: Date;
  isActive: boolean;
}

export interface LiveChatState {
  isOpen: boolean;
  isMinimized: boolean;
  session: ChatSession | null;
  isTyping: boolean;
  unreadCount: number;
}

export interface SendMessagePayload {
  sessionId: string;
  villageId: string;
  message: string;
}

export interface ChatResponse {
  success: boolean;
  message?: string;
  response?: string;
  guidanceText?: string;
  error?: string;
}

// Local storage keys
export const LIVECHAT_SESSION_KEY = 'govconnect_livechat_session';
export const LIVECHAT_STATE_KEY = 'govconnect_livechat_state';

// Generate unique session ID
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  return `web_${timestamp}_${randomPart}`;
}

// Generate unique message ID
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
