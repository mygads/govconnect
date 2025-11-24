export interface MessageData {
  wa_user_id: string;
  message_id: string;
  message_text: string;
  timestamp?: Date;
}

export interface IncomingMessageData extends MessageData {
  direction: 'IN';
  source: 'WA_WEBHOOK';
}

export interface OutgoingMessageData extends MessageData {
  direction: 'OUT';
  source: 'AI' | 'SYSTEM';
}

export interface MessageHistoryQuery {
  wa_user_id: string;
  limit?: number;
}

export interface SendMessageRequest {
  wa_user_id: string;
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
  wa_user_id: string;
  message: string;
  message_id: string;
  received_at: string;
}
