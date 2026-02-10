/**
 * Live Chat Hook
 * Mengelola state dan logic untuk live chat widget
 */

"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChatMessage,
  ChatSession,
  ChatVillage,
  LiveChatState,
  LIVECHAT_SESSION_KEY,
  generateSessionId,
  generateMessageId,
} from '@/lib/live-chat-types';

// Processing status from AI service
interface ProcessingStatus {
  stage: 'receiving' | 'reading' | 'searching' | 'thinking' | 'preparing' | 'sending' | 'completed' | 'error';
  message: string;
  progress: number;
}

const INITIAL_STATE: LiveChatState = {
  isOpen: false,
  isMinimized: false,
  session: null,
  isTyping: false,
  unreadCount: 0,
};

export function useLiveChat() {
  const [state, setState] = useState<LiveChatState>(INITIAL_STATE);
  const [isLoaded, setIsLoaded] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const statusPollingRef = useRef<NodeJS.Timeout | null>(null);

  // Load session from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const savedSession = localStorage.getItem(LIVECHAT_SESSION_KEY);
      if (savedSession) {
        const parsed = JSON.parse(savedSession) as ChatSession;

        // Backward-compat: older sessions didn't store village
        if (!parsed || !(parsed as any).village?.id) {
          localStorage.removeItem(LIVECHAT_SESSION_KEY);
          setIsLoaded(true);
          return;
        }

        // Convert date strings back to Date objects
        parsed.createdAt = new Date(parsed.createdAt);
        parsed.lastActivity = new Date(parsed.lastActivity);
        parsed.messages = parsed.messages.map(msg => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        }));
        setState(prev => ({ ...prev, session: parsed }));
      }
    } catch (error) {
      console.error('Error loading chat session:', error);
    }
    setIsLoaded(true);
  }, []);

  // Save session to localStorage whenever it changes
  useEffect(() => {
    if (!isLoaded || typeof window === 'undefined') return;
    
    if (state.session) {
      localStorage.setItem(LIVECHAT_SESSION_KEY, JSON.stringify(state.session));
    }
  }, [state.session, isLoaded]);

  // Scroll to bottom when new messages arrive - always scroll to latest
  useEffect(() => {
    // Use setTimeout to ensure DOM is updated before scrolling
    const scrollToBottom = () => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    };
    
    // Immediate scroll
    scrollToBottom();
    
    // Also scroll after a short delay to handle any rendering delays
    const timeoutId = setTimeout(scrollToBottom, 100);
    // Additional scroll after longer delay for initial load
    const timeoutId2 = setTimeout(scrollToBottom, 300);
    
    return () => {
      clearTimeout(timeoutId);
      clearTimeout(timeoutId2);
    };
  }, [state.session?.messages, state.session?.messages?.length]);

  // Auto scroll when chat is opened or maximized
  useEffect(() => {
    if (state.isOpen && !state.isMinimized && messagesEndRef.current) {
      // Delay to ensure DOM is ready
      const timeoutId = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
      }, 150);
      return () => clearTimeout(timeoutId);
    }
  }, [state.isOpen, state.isMinimized]);


  // Initialize new session
  const initSession = useCallback((village: ChatVillage) => {
    const newSession: ChatSession = {
      sessionId: generateSessionId(),
      village,
      messages: [],
      createdAt: new Date(),
      lastActivity: new Date(),
      isActive: true,
    };
    setState(prev => ({ ...prev, session: newSession }));
    return newSession;
  }, []);

  // Select/switch village
  const selectVillage = useCallback((village: ChatVillage) => {
    setState(prev => {
      if (!prev.session) {
        const newSession: ChatSession = {
          sessionId: generateSessionId(),
          village,
          messages: [],
          createdAt: new Date(),
          lastActivity: new Date(),
          isActive: true,
        };
        return { ...prev, session: newSession, unreadCount: 0 };
      }

      // If switching village, start fresh session
      if (prev.session.village?.id !== village.id) {
        const newSession: ChatSession = {
          sessionId: generateSessionId(),
          village,
          messages: [],
          createdAt: new Date(),
          lastActivity: new Date(),
          isActive: true,
        };
        return { ...prev, session: newSession, unreadCount: 0 };
      }

      return prev;
    });
  }, []);

  // Open chat widget
  const openChat = useCallback(() => {
    setState(prev => {
      return { ...prev, isOpen: true, isMinimized: false, unreadCount: 0 };
    });
  }, []);

  // Close chat widget
  const closeChat = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false }));
  }, []);

  // Minimize chat widget
  const minimizeChat = useCallback(() => {
    setState(prev => ({ ...prev, isMinimized: true }));
  }, []);

  // Maximize chat widget
  const maximizeChat = useCallback(() => {
    setState(prev => ({ ...prev, isMinimized: false, unreadCount: 0 }));
  }, []);

  // Toggle chat widget
  const toggleChat = useCallback(() => {
    setState(prev => {
      if (!prev.isOpen) {
        return { ...prev, isOpen: true, isMinimized: false, unreadCount: 0 };
      }
      return { ...prev, isOpen: false };
    });
  }, []);

  // Add message to session
  const addMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMessage: ChatMessage = {
      ...message,
      id: generateMessageId(),
      timestamp: new Date(),
    };

    setState(prev => {
      if (!prev.session) return prev;
      
      const updatedSession: ChatSession = {
        ...prev.session,
        messages: [...prev.session.messages, newMessage],
        lastActivity: new Date(),
      };

      // Increment unread if minimized and message is from assistant
      const unreadCount = prev.isMinimized && message.role === 'assistant' 
        ? prev.unreadCount + 1 
        : prev.unreadCount;

      return { ...prev, session: updatedSession, unreadCount };
    });

    // Force scroll to bottom after adding message
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 50);

    return newMessage;
  }, []);

  // Update message status
  const updateMessageStatus = useCallback((messageId: string, status: ChatMessage['status']) => {
    setState(prev => {
      if (!prev.session) return prev;
      
      const updatedMessages = prev.session.messages.map(msg =>
        msg.id === messageId ? { ...msg, status } : msg
      );

      return {
        ...prev,
        session: { ...prev.session, messages: updatedMessages },
      };
    });
  }, []);


  // Send message to AI
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    // Require village selection before sending
    const currentSession = state.session;
    if (!currentSession?.village?.id) {
      return;
    }

    // Add user message
    const userMessage = addMessage({
      content: content.trim(),
      role: 'user',
      status: 'sending',
    });

    // Set typing indicator
    setState(prev => ({ ...prev, isTyping: true }));

    // Start polling for processing status
    const sessionId = currentSession?.sessionId || state.session?.sessionId;
    if (sessionId) {
      statusPollingRef.current = setInterval(async () => {
        try {
          const statusResponse = await fetch(`/api/webchat/status?sessionId=${sessionId}`);
          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            if (statusData.success && statusData.data?.status) {
              setProcessingStatus({
                stage: statusData.data.status.stage,
                message: statusData.data.status.message,
                progress: statusData.data.status.progress,
              });
            }
          }
        } catch (e) {
          // Silently fail - status polling is best effort
        }
      }, 500);
    }

    try {
      // Update user message status to sent
      updateMessageStatus(userMessage.id, 'sent');

      // Call API - menggunakan webchat endpoint
      const response = await fetch('/api/webchat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: currentSession?.sessionId || state.session?.sessionId,
          villageId: currentSession.village.id,
          message: content.trim(),
        }),
      });

      const data = await response.json();

      // Update user message status to delivered
      updateMessageStatus(userMessage.id, 'delivered');

      if (data.success && data.response) {
        // Add AI response
        addMessage({
          content: data.response,
          role: 'assistant',
          status: 'delivered',
        });

        if (data.guidanceText && String(data.guidanceText).trim()) {
          setTimeout(() => {
            addMessage({
              content: String(data.guidanceText),
              role: 'assistant',
              status: 'delivered',
            });
          }, 300);
        }

        // Mark user message as read
        setTimeout(() => {
          updateMessageStatus(userMessage.id, 'read');
        }, 500);
      } else if (data.success && (data.response === '' || data.intent === 'TAKEOVER')) {
        // Takeover mode or silent response — AI returned empty reply.
        // Don't add any bubble; admin will respond via poll.
        updateMessageStatus(userMessage.id, 'read');
      } else {
        // Add error message
        addMessage({
          content: data.error || 'Maaf, terjadi kesalahan. Silakan coba lagi.',
          role: 'assistant',
          status: 'delivered',
        });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      updateMessageStatus(userMessage.id, 'error');
      
      addMessage({
        content: 'Maaf, tidak dapat terhubung ke server. Silakan coba lagi nanti.',
        role: 'assistant',
        status: 'delivered',
      });
    } finally {
      // Stop status polling
      if (statusPollingRef.current) {
        clearInterval(statusPollingRef.current);
        statusPollingRef.current = null;
      }
      setProcessingStatus(null);
      setState(prev => ({ ...prev, isTyping: false }));
    }
  }, [state.session, initSession, addMessage, updateMessageStatus]);

  // Clear chat / Start new session
  const clearChat = useCallback(() => {
    // Clear AI caches/profile so user starts fresh (fire-and-forget)
    const oldSessionId = state.session?.sessionId;
    if (oldSessionId) {
      fetch('/api/webchat/clear-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: oldSessionId }),
      }).catch(() => { /* non-blocking */ });
    }

    setState(prev => {
      if (!prev.session?.village?.id) return prev;

      const newSession: ChatSession = {
        sessionId: generateSessionId(),
        village: prev.session.village,
        messages: [],
        createdAt: new Date(),
        lastActivity: new Date(),
        isActive: true,
      };
      return { ...prev, session: newSession, unreadCount: 0 };
    });
  }, [state.session?.sessionId]);

  const switchVillage = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(LIVECHAT_SESSION_KEY);
    }
    setState(prev => ({ ...prev, session: null, unreadCount: 0 }));
  }, []);

  // Mark all messages as read
  const markAllAsRead = useCallback(() => {
    setState(prev => ({ ...prev, unreadCount: 0 }));
  }, []);

  // Track takeover status
  const [isTakeover, setIsTakeover] = useState(false);
  const [adminName, setAdminName] = useState<string | null>(null);
  const lastPollRef = useRef<Date>(new Date());
  const processedMessagesRef = useRef<Set<string>>(new Set());

  // Poll for admin messages - always poll when session exists
  useEffect(() => {
    if (!state.session?.sessionId || !state.session?.village?.id) return;

    const sessionId = state.session.sessionId;
    const villageId = state.session.village.id;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/webchat/poll?sessionId=${encodeURIComponent(sessionId)}&villageId=${encodeURIComponent(villageId)}&since=${lastPollRef.current.toISOString()}`
        );
        
        if (!response.ok) return;
        
        const data = await response.json();
        
        // Update takeover status
        setIsTakeover(data.is_takeover || false);
        setAdminName(data.admin_name || null);
        
        // Add new admin messages
        if (data.messages && data.messages.length > 0) {
          let hasNewMessages = false;
          
          for (const msg of data.messages) {
            // Create unique key for message deduplication (prefer message_id if available)
            const msgKey = msg.message_id || msg.id || `${msg.content}_${msg.timestamp}`;
            
            // Check if message already processed
            if (processedMessagesRef.current.has(msgKey)) {
              continue;
            }
            
            // Check if message already exists in session
            const exists = state.session?.messages.some(
              m => m.role === 'assistant' && m.content === msg.content
            );
            
            if (!exists) {
              processedMessagesRef.current.add(msgKey);
              hasNewMessages = true;
              
              // Add message directly to state to avoid dependency issues
              setState(prev => {
                if (!prev.session) return prev;
                
                const newMessage: ChatMessage = {
                  id: generateMessageId(),
                  content: msg.content,
                  role: 'assistant',
                  timestamp: new Date(msg.timestamp),
                  status: 'delivered',
                };
                
                const updatedSession: ChatSession = {
                  ...prev.session,
                  messages: [...prev.session.messages, newMessage],
                  lastActivity: new Date(),
                };

                // Increment unread if minimized
                const unreadCount = prev.isMinimized 
                  ? prev.unreadCount + 1 
                  : prev.unreadCount;

                return { ...prev, session: updatedSession, unreadCount };
              });
            }
          }
          
          if (hasNewMessages) {
            lastPollRef.current = new Date();
            // Force scroll to bottom after new messages
            setTimeout(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 100);
          }
        }
      } catch (error) {
        // Silently fail - polling is best effort
        console.debug('Poll error:', error);
      }
    }, 2000); // Poll every 2 seconds for faster response

    return () => clearInterval(pollInterval);
  }, [state.session?.sessionId, state.session?.village?.id]);

  return {
    // State
    isOpen: state.isOpen,
    isMinimized: state.isMinimized,
    session: state.session,
    selectedVillage: state.session?.village || null,
    messages: state.session?.messages || [],
    isTyping: state.isTyping,
    processingStatus, // Real-time AI processing status
    unreadCount: state.unreadCount,
    isLoaded,
    isTakeover,
    adminName,
    
    // Actions
    openChat,
    closeChat,
    minimizeChat,
    maximizeChat,
    toggleChat,
    sendMessage,
    clearChat,
    selectVillage,
    switchVillage,
    markAllAsRead,
    
    // Refs
    messagesEndRef,
  };
}
