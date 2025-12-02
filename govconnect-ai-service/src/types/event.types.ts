export interface MessageReceivedEvent {
  wa_user_id: string;
  message: string;
  message_id: string;
  received_at: string;
  // Media information (optional)
  has_media?: boolean;
  media_type?: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  media_url?: string;              // Internal URL for Case Service (Docker network)
  media_public_url?: string;       // Public URL for Dashboard (browser access)
  media_caption?: string;
  media_mime_type?: string;
  media_file_name?: string;
}

export interface AIReplyEvent {
  wa_user_id: string;
  reply_text: string;
}

export interface AIErrorEvent {
  wa_user_id: string;
  error_message: string;
}
