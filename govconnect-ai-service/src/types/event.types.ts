export type ChannelType = 'WHATSAPP' | 'WEBCHAT';

export interface MessageReceivedEvent {
  village_id?: string;
  // Channel-aware fields (preferred)
  channel?: ChannelType;
  channel_identifier?: string;
  // Legacy field (deprecated - use channel_identifier)
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
  // Batched messages (when multiple messages are combined)
  is_batched?: boolean;
  batched_message_ids?: string[];  // All message IDs in this batch
  original_messages?: string[];    // Original messages before combining
}

export interface AIReplyEvent {
  village_id?: string;
  // Channel-aware fields (preferred)
  channel?: ChannelType;
  channel_identifier?: string;
  // Legacy field (deprecated - use channel_identifier)
  wa_user_id: string;
  reply_text: string;
  guidance_text?: string;  // Optional second bubble for guidance/follow-up
  message_id?: string;     // Single message ID that was answered
  batched_message_ids?: string[];  // Message IDs that were answered in this reply (for batched)
  // Contacts to send as separate vCard messages (WhatsApp only)
  contacts?: Array<{
    name: string;
    phone: string;
    organization?: string;  // e.g., "Pemadam Kebakaran", "Puskesmas"
    title?: string;         // e.g., "Hotline Darurat", "Nomor Layanan"
  }>;
}

export interface AIErrorEvent {
  village_id?: string;
  // Channel-aware fields (preferred)
  channel?: ChannelType;
  channel_identifier?: string;
  // Legacy field (deprecated - use channel_identifier)
  wa_user_id: string;
  error_message: string;
  pending_message_id?: string;  // Message ID that failed processing
  batched_message_ids?: string[];  // All message IDs if batched
  can_retry?: boolean;  // Flag for dashboard to show retry button
}

// Event to notify channel service about message status
export interface MessageStatusEvent {
  village_id?: string;
  // Channel-aware fields (preferred)
  channel?: ChannelType;
  channel_identifier?: string;
  // Legacy field (deprecated - use channel_identifier)
  wa_user_id: string;
  message_ids: string[];
  status: 'processing' | 'completed' | 'failed';
  error_message?: string;
}
