export type LivechatEventType = 'message' | 'message_status' | 'conversation' | 'takeover' | 'delete' | 'typing' | 'heartbeat';

export interface LivechatEvent {
  type: LivechatEventType;
  village_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier?: string;
  message_id?: string;
  delivery_status?: string | null;
  sent_at?: Date | string | null;
  delivered_at?: Date | string | null;
  read_at?: Date | string | null;
  failed_at?: Date | string | null;
  admin_read_at?: Date | string | null;
  status_error?: string | null;
  typing_state?: 'composing' | 'paused';
  actor?: 'user' | 'admin' | 'ai';
  at: number;
}

type LivechatEventListener = (event: LivechatEvent) => void;

const listeners = new Set<LivechatEventListener>();

export function publishLivechatEvent(event: Omit<LivechatEvent, 'at'>): void {
  const payload: LivechatEvent = { ...event, at: Date.now() };
  for (const listener of listeners) {
    listener(payload);
  }
}

export function subscribeLivechatEvents(listener: LivechatEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
