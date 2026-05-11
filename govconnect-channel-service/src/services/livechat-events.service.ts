export type LivechatEventType = 'message' | 'message_status' | 'conversation' | 'takeover' | 'delete' | 'typing' | 'wa_session_status' | 'heartbeat' | 'complaint_created' | 'complaint_updated' | 'urgent_alert' | 'webchat_system_notification';

export interface LivechatEvent {
  type: LivechatEventType;
  village_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier?: string;
  message_id?: string;
  message?: string;
  notification_type?: string;
  reference_number?: string | null;
  delivery_status?: string | null;
  sent_at?: Date | string | null;
  delivered_at?: Date | string | null;
  read_at?: Date | string | null;
  failed_at?: Date | string | null;
  admin_read_at?: Date | string | null;
  status_error?: string | null;
  typing_state?: 'composing' | 'paused';
  actor?: 'user' | 'admin' | 'ai';
  wa_session_status?: string;
  wa_session_event?: string;
  at: number;
}

type LivechatEventListener = (event: LivechatEvent) => void;

const listeners = new Set<LivechatEventListener>();

const sseMetrics = {
  totalEventsPublished: 0,
  lastEventPublishedAt: 0,
};

export function getSseMetrics() {
  return {
    ...sseMetrics,
    activeListeners: listeners.size,
  };
}

export function publishLivechatEvent(event: Omit<LivechatEvent, 'at'>): void {
  const payload: LivechatEvent = { ...event, at: Date.now() };
  sseMetrics.totalEventsPublished += 1;
  sseMetrics.lastEventPublishedAt = payload.at;
  for (const listener of listeners) {
    listener(payload);
  }
}

export function subscribeLivechatEvents(listener: LivechatEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
