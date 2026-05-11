export type MessageDeliveryStatus = 'received' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageKind = 'text' | 'media' | 'location' | 'contact' | 'buttons' | 'list' | 'sticker' | 'poll' | 'reaction' | 'edit' | 'delete' | 'system';

export interface MessageData {
  village_id?: string;
  wa_user_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier: string;
  message_id: string;
  message_text: string;
  reference_number?: string | null;
  notification_type?: string | null;
  entity_status?: string | null;
  media_type?: string | null;
  media_url?: string | null;
  media_public_url?: string | null;
  mime_type?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  storage_key?: string | null;
  delivery_status?: MessageDeliveryStatus;
  status_error?: string | null;
  wa_chat_jid?: string | null;
  wa_sender_jid?: string | null;
  wa_sender_phone?: string | null;
  wa_chat_phone?: string | null;
  wa_message_type?: string | null;
  wa_context_info?: unknown;
  wa_raw_info?: unknown;
  wa_raw_message?: unknown;
  quoted_message_id?: string | null;
  quoted_stanza_id?: string | null;
  quoted_participant?: string | null;
  quoted_text?: string | null;
  quoted_message_json?: unknown;
  message_kind?: MessageKind;
  location_latitude?: number | null;
  location_longitude?: number | null;
  location_name?: string | null;
  location_address?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_vcard?: string | null;
  interactive_payload?: unknown;
  timestamp?: Date;
}

export interface IncomingMessageData extends MessageData {
  direction: 'IN';
  source: 'WA_WEBHOOK';
}

export interface OutgoingMessageData extends MessageData {
  direction: 'OUT';
  source: 'AI' | 'SYSTEM' | 'ADMIN';
}

export interface MessageHistoryQuery {
  village_id?: string;
  channel_identifier: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  limit?: number;
}

export interface SendMessageRequest {
  village_id?: string;
  wa_user_id?: string;
  channel?: 'WHATSAPP' | 'WEBCHAT';
  channel_identifier?: string;
  message: string;
}

export interface SendMessageResponse {
  status: 'sent' | 'failed';
  message_id?: string;
  error?: string;
}

export interface MessageHistoryResponse {
  messages: Array<{
    id: string;
    message_text: string;
    direction: string;
    source: string;
    timestamp: Date;
  }>;
  total: number;
}

export interface RabbitMQMessagePayload {
  village_id?: string;
  wa_user_id: string;
  message: string;
  message_id: string;
  received_at: string;
}
