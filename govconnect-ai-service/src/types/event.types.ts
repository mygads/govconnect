export interface MessageReceivedEvent {
  wa_user_id: string;
  message: string;
  message_id: string;
  received_at: string;
}

export interface AIReplyEvent {
  wa_user_id: string;
  reply_text: string;
}
