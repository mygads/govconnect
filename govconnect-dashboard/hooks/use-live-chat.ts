/**
 * Live Chat Hook
 * Mengelola state dan logic untuk live chat widget
 */

"use client";

import { useState, useEffect, useCallback, useRef } from 'react';

type RealtimeState = 'connecting' | 'live' | 'fallback' | 'offline';

interface WebchatIncomingMessage {
  message_id?: string;
  id?: string;
  content: string;
  admin_name?: string | null;
  timestamp?: string;
}

interface WebchatSseMessageEvent {
  sessionId: string;
  message_id?: string;
  content: string;
  role?: 'assistant' | 'user';
  source?: 'admin' | 'ai';
  admin_name?: string | null;
  timestamp?: string;
  at?: number;
}

interface WebchatSseTakeoverEvent {
  sessionId: string;
  is_takeover: boolean;
  admin_name?: string | null;
  at?: number;
}

interface WebchatSseStatusEvent {
  sessionId: string;
  stage: ProcessingStatus['stage'];
  message: string;
  progress: number;
  done?: boolean;
  at?: number;
}

const SSE_FAILURE_THRESHOLD = 3;
const FALLBACK_POLL_INTERVAL_MS = 4000;
const FALLBACK_STATUS_POLL_INTERVAL_MS = 2500;
const RETRY_SSE_WHILE_FALLBACK_MS = 30000;
const MAX_RECONNECT_DELAY_MS = 15000;

function getReconnectDelay(attempt: number) {
  return Math.min(1000 * 2 ** Math.max(attempt, 0), MAX_RECONNECT_DELAY_MS);
}

function parseEventData<T>(event: MessageEvent<string>): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

function eventTimestampToIso(value?: string | number) {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return new Date().toISOString();
}

function buildProcessedMessageKey(message: Pick<WebchatIncomingMessage, 'message_id' | 'id' | 'content' | 'timestamp'>) {
  return message.message_id || message.id || `${message.content}_${message.timestamp || 'no-ts'}`;
}

function isDocumentVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function supportsEventSource() {
  return typeof window !== 'undefined' && typeof window.EventSource !== 'undefined';
}

function clearTimer(ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (ref.current) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

function clearIntervalRef(ref: React.MutableRefObject<ReturnType<typeof setInterval> | null>) {
  if (ref.current) {
    clearInterval(ref.current);
    ref.current = null;
  }
}

function closeEventSource(ref: React.MutableRefObject<EventSource | null>) {
  if (ref.current) {
    ref.current.close();
    ref.current = null;
  }
}
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
  const [serviceError, setServiceError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const statusPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fallbackPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retrySseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const consecutiveSseFailuresRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const isFallbackModeRef = useRef(false);
  const lastEventAtRef = useRef<string>(new Date().toISOString());
  const realtimeStateRef = useRef<RealtimeState>('offline');
  const isStatusPollingActiveRef = useRef(false);
  const lastSessionKeyRef = useRef<string | null>(null);
  const processedMessagesRef = useRef<Set<string>>(new Set());
  const isUnmountingRef = useRef(false);

  const [realtimeState, setRealtimeState] = useState<RealtimeState>('offline');
  const [isTakeover, setIsTakeover] = useState(false);
  const [adminName, setAdminName] = useState<string | null>(null);

  const setRealtimeMode = useCallback((nextState: RealtimeState) => {
    realtimeStateRef.current = nextState;
    setRealtimeState(nextState);
  }, []);

  const resetRealtimeBuffers = useCallback(() => {
    processedMessagesRef.current.clear();
    lastEventAtRef.current = new Date().toISOString();
    consecutiveSseFailuresRef.current = 0;
    reconnectAttemptRef.current = 0;
    isFallbackModeRef.current = false;
    isStatusPollingActiveRef.current = false;
    setIsTakeover(false);
    setAdminName(null);
    setProcessingStatus(null);
    setRealtimeMode('offline');
  }, [setRealtimeMode]);

  const stopStatusPolling = useCallback(() => {
    clearIntervalRef(statusPollingRef);
    isStatusPollingActiveRef.current = false;
  }, []);

  const stopFallbackPolling = useCallback(() => {
    clearIntervalRef(fallbackPollingRef);
  }, []);

  const stopRealtime = useCallback(() => {
    stopStatusPolling();
    stopFallbackPolling();
    clearTimer(reconnectTimeoutRef);
    clearTimer(retrySseTimeoutRef);
    closeEventSource(eventSourceRef);
  }, [stopFallbackPolling, stopStatusPolling]);

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

    // If SSE is not live, enable status polling as fallback during send
    const sessionId = currentSession?.sessionId || state.session?.sessionId;
    if (sessionId && realtimeStateRef.current !== 'live') {
      isStatusPollingActiveRef.current = true;
      try {
        const statusResponse = await fetch(`/api/webchat/status?sessionId=${sessionId}`);
        const statusData = await statusResponse.json().catch(() => null);
        if (statusResponse.ok && statusData?.success && statusData.data?.status) {
          setServiceError(null);
          setProcessingStatus({
            stage: statusData.data.status.stage,
            message: statusData.data.status.message,
            progress: statusData.data.status.progress,
          });
        }
      } catch {
        // Ignore; polling loop will retry
      }
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

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        updateMessageStatus(userMessage.id, 'error');
        const fallback = data?.fallbackResponse || data?.response || data?.error || 'Maaf, sistem sedang bermasalah. Silakan coba lagi nanti.';
        setServiceError(data?.error || fallback);
        addMessage({
          content: fallback,
          role: 'assistant',
          status: 'delivered',
        });
        return;
      }

      // Update user message status to delivered
      updateMessageStatus(userMessage.id, 'delivered');
      setServiceError(null);

      if (data?.success && data.response) {
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
      } else if (data?.success && (data.response === '' || data.intent === 'TAKEOVER')) {
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
      setServiceError('Tidak dapat terhubung ke server webchat.');

      addMessage({
        content: 'Maaf, tidak dapat terhubung ke server. Silakan coba lagi nanti.',
        role: 'assistant',
        status: 'delivered',
      });
    } finally {
      stopStatusPolling();
      setProcessingStatus(null);
      setState(prev => ({ ...prev, isTyping: false }));
    }
  }, [state.session, initSession, addMessage, updateMessageStatus, stopStatusPolling]);

  // Clear chat / Start new session
  const clearChat = useCallback(() => {
    const oldSessionId = state.session?.sessionId;
    if (oldSessionId) {
      stopRealtime();
      resetRealtimeBuffers();
      fetch('/api/webchat/clear-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: oldSessionId }),
      })
        .then(async (response) => {
          const data = await response.json().catch(() => null);
          if (!response.ok || data?.success === false) {
            setServiceError(data?.error || 'Sesi lama tidak dapat dibersihkan di server.');
            return;
          }
          setServiceError(null);
        })
        .catch((error: any) => {
          setServiceError(error?.message || 'Sesi lama tidak dapat dibersihkan di server.');
        });
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
  }, [state.session?.sessionId, stopRealtime, resetRealtimeBuffers]);

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

  const catchUpPoll = useCallback(async (sessionId: string, villageId: string) => {
    try {
      const since = lastEventAtRef.current;
      const response = await fetch(
        `/api/webchat/poll?sessionId=${encodeURIComponent(sessionId)}&villageId=${encodeURIComponent(villageId)}&since=${since}`
      );

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) return;

      if (data.is_takeover !== undefined) setIsTakeover(data.is_takeover);
      if (data.admin_name) setAdminName(data.admin_name);

      const messages: WebchatIncomingMessage[] = data.messages || [];
      for (const msg of messages) {
        const key = buildProcessedMessageKey({
          message_id: msg.message_id,
          id: msg.id,
          content: msg.content,
          timestamp: msg.timestamp,
        });
        if (processedMessagesRef.current.has(key)) continue;

        processedMessagesRef.current.add(key);
        lastEventAtRef.current = eventTimestampToIso(msg.timestamp);

        setState(prev => {
          if (!prev.session) return prev;
          const newMessage: ChatMessage = {
            id: generateMessageId(),
            content: msg.content,
            role: 'assistant',
            timestamp: new Date(msg.timestamp || Date.now()),
            status: 'delivered',
          };
          return {
            ...prev,
            session: {
              ...prev.session,
              messages: [...prev.session.messages, newMessage],
              lastActivity: new Date(),
            },
            unreadCount: prev.isMinimized ? prev.unreadCount + 1 : prev.unreadCount,
          };
        });
      }
    } catch (error: any) {
      console.debug('Catch-up poll error:', error);
    }
  }, []);

  const openSse = useCallback((sessionId: string, villageId: string) => {
    if (isUnmountingRef.current) return;
    if (!supportsEventSource()) {
      isFallbackModeRef.current = true;
      setRealtimeMode('fallback');
      return;
    }

    closeEventSource(eventSourceRef);
    setRealtimeMode('connecting');

    const url = `/api/webchat/events?sessionId=${encodeURIComponent(sessionId)}&villageId=${encodeURIComponent(villageId)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      if (isUnmountingRef.current) return;
      consecutiveSseFailuresRef.current = 0;
      reconnectAttemptRef.current = 0;
      isFallbackModeRef.current = false;
      setRealtimeMode('live');
      stopFallbackPolling();
      clearTimer(retrySseTimeoutRef);
    };

    eventSource.onerror = () => {
      if (isUnmountingRef.current) return;
      closeEventSource(eventSourceRef);

      const failures = consecutiveSseFailuresRef.current + 1;
      consecutiveSseFailuresRef.current = failures;

      if (failures >= SSE_FAILURE_THRESHOLD) {
        isFallbackModeRef.current = true;
        setRealtimeMode('fallback');
      } else {
        setRealtimeMode('connecting');
      }

      const delay = getReconnectDelay(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;

      clearTimer(reconnectTimeoutRef);
      reconnectTimeoutRef.current = setTimeout(() => {
        if (isUnmountingRef.current || !state.session?.sessionId || !state.session?.village?.id) return;
        openSse(state.session.sessionId, state.session.village.id);
      }, delay);
    };

    eventSource.addEventListener('connected', (event: MessageEvent<string>) => {
      if (isUnmountingRef.current) return;
      const payload = parseEventData<{ sessionId?: string; at?: number }>(event);
      if (payload) {
        lastEventAtRef.current = new Date(payload.at || Date.now()).toISOString();
      }
    });

    eventSource.addEventListener('processing_status', (event: MessageEvent<string>) => {
      if (isUnmountingRef.current) return;
      const payload = parseEventData<WebchatSseStatusEvent>(event);
      if (!payload) return;
      lastEventAtRef.current = new Date(payload.at || Date.now()).toISOString();
      setProcessingStatus({
        stage: payload.stage,
        message: payload.message,
        progress: payload.progress,
      });
      if (payload.done) {
        setTimeout(() => {
          if (!isUnmountingRef.current) setProcessingStatus(null);
        }, 300);
      }
    });

    eventSource.addEventListener('message', (event: MessageEvent<string>) => {
      if (isUnmountingRef.current) return;
      const payload = parseEventData<WebchatSseMessageEvent>(event);
      if (!payload) return;

      const key = buildProcessedMessageKey({
        message_id: payload.message_id,
        content: payload.content,
        timestamp: payload.timestamp,
      });
      if (processedMessagesRef.current.has(key)) return;
      processedMessagesRef.current.add(key);

      const timestamp = eventTimestampToIso(payload.timestamp || payload.at);
      lastEventAtRef.current = timestamp;

      setState(prev => {
        if (!prev.session) return prev;
        const newMessage: ChatMessage = {
          id: generateMessageId(),
          content: payload.content,
          role: 'assistant',
          timestamp: new Date(timestamp),
          status: 'delivered',
        };
        return {
          ...prev,
          session: {
            ...prev.session,
            messages: [...prev.session.messages, newMessage],
            lastActivity: new Date(),
          },
          unreadCount: prev.isMinimized ? prev.unreadCount + 1 : prev.unreadCount,
        };
      });
    });

    eventSource.addEventListener('takeover', (event: MessageEvent<string>) => {
      if (isUnmountingRef.current) return;
      const payload = parseEventData<WebchatSseTakeoverEvent>(event);
      if (!payload) return;
      lastEventAtRef.current = new Date(payload.at || Date.now()).toISOString();
      setIsTakeover(payload.is_takeover);
      setAdminName(payload.admin_name || null);
    });

    eventSource.addEventListener('heartbeat', () => {
      lastEventAtRef.current = new Date().toISOString();
    });
  }, [setRealtimeMode, stopFallbackPolling, state.session?.sessionId, state.session?.village?.id]);

  const startRealtime = useCallback((sessionId: string, villageId: string) => {
    stopRealtime();
    resetRealtimeBuffers();
    lastSessionKeyRef.current = `${sessionId}:${villageId}`;
    openSse(sessionId, villageId);
  }, [stopRealtime, resetRealtimeBuffers, openSse]);

  useEffect(() => {
    if (!state.session?.sessionId || !state.session?.village?.id) {
      stopRealtime();
      return;
    }

    const sessionId = state.session.sessionId;
    const villageId = state.session.village.id;
    const sessionKey = `${sessionId}:${villageId}`;

    if (lastSessionKeyRef.current !== sessionKey) {
      startRealtime(sessionId, villageId);
    }

    return () => {
      stopRealtime();
    };
  }, [state.session?.sessionId, state.session?.village?.id, startRealtime, stopRealtime]);

  useEffect(() => {
    if (!isFallbackModeRef.current || !state.session?.sessionId || !state.session?.village?.id) return;

    const sessionId = state.session.sessionId;
    const villageId = state.session.village.id;

    const poll = async () => {
      if (isUnmountingRef.current) return;
      await catchUpPoll(sessionId, villageId);
    };

    poll();
    fallbackPollingRef.current = setInterval(poll, FALLBACK_POLL_INTERVAL_MS);

    return () => {
      stopFallbackPolling();
    };
  }, [realtimeState, state.session?.sessionId, state.session?.village?.id, catchUpPoll, stopFallbackPolling]);

  useEffect(() => {
    if (!isFallbackModeRef.current || !isStatusPollingActiveRef.current || !state.session?.sessionId) return;

    const sessionId = state.session.sessionId;

    const pollStatus = async () => {
      if (isUnmountingRef.current) return;
      try {
        const response = await fetch(`/api/webchat/status?sessionId=${sessionId}`);
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success || !data.data?.status) return;
        setProcessingStatus({
          stage: data.data.status.stage,
          message: data.data.status.message,
          progress: data.data.status.progress,
        });
      } catch (error) {
        console.debug('Fallback status poll error:', error);
      }
    };

    statusPollingRef.current = setInterval(pollStatus, FALLBACK_STATUS_POLL_INTERVAL_MS);

    return () => {
      stopStatusPolling();
    };
  }, [realtimeState, state.session?.sessionId, stopStatusPolling]);

  useEffect(() => {
    if (!isFallbackModeRef.current || realtimeStateRef.current === 'live') return;

    const attemptReconnect = () => {
      if (isUnmountingRef.current || realtimeStateRef.current === 'live') return;
      if (state.session?.sessionId && state.session?.village?.id) {
        openSse(state.session.sessionId, state.session.village.id);
      }
    };

    retrySseTimeoutRef.current = setInterval(attemptReconnect, RETRY_SSE_WHILE_FALLBACK_MS);

    return () => {
      clearTimer(retrySseTimeoutRef);
    };
  }, [realtimeState, state.session?.sessionId, state.session?.village?.id, openSse]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && state.session?.sessionId && state.session?.village?.id) {
        catchUpPoll(state.session.sessionId, state.session.village.id);
        if (!eventSourceRef.current && !isFallbackModeRef.current) {
          openSse(state.session.sessionId, state.session.village.id);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [state.session?.sessionId, state.session?.village?.id, catchUpPoll, openSse]);

  useEffect(() => {
    isUnmountingRef.current = false;
    return () => {
      isUnmountingRef.current = true;
      stopRealtime();
    };
  }, [stopRealtime]);


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
    serviceError,
    realtimeState,

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
