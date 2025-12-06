/**
 * Webhook types for genfity-wa / clivy-wa-support
 * 
 * genfity-wa sends webhooks in JSON format with the following structure:
 * {
 *   "type": "Message",
 *   "event": { Info: {...}, Message: {...} },
 *   "base64": "...", // optional, for media
 *   "mimeType": "...",
 *   "fileName": "..."
 * }
 */

// =====================================================
// GENFITY-WA WEBHOOK TYPES (Primary)
// =====================================================

export interface GenfityWebhookPayload {
  type: string; // "Message", "MessageSent", "Receipt", "Connected", etc.
  event?: GenfityEvent;
  base64?: string;
  mimeType?: string;
  fileName?: string;
  s3?: S3Data;
  // Additional fields sent by genfity-wa
  jsonData?: string; // Raw JSON data (form mode)
  userID?: string;
  instanceName?: string;
}

export interface GenfityEvent {
  Info: GenfityMessageInfo;
  Message?: GenfityMessage;
}

export interface GenfityMessageInfo {
  ID: string;
  Timestamp: string;
  Chat: string; // JID format: "628xxx@s.whatsapp.net" or LID "93849498181695@lid"
  Sender?: {
    User: string;
    Server: string;
    AD?: boolean;
  } | string; // Can be object or string like "93849498181695:24@lid"
  SenderAlt?: string; // Alternative sender JID for LID: "6281233784490@s.whatsapp.net"
  RecipientAlt?: string; // Alternative recipient JID for LID
  IsFromMe: boolean;
  IsGroup: boolean;
  PushName?: string;
  Type?: string;
  Category?: string;
  MessageType?: string; // For MessageSent events
}

export interface GenfityMessage {
  Conversation?: string;
  ExtendedTextMessage?: {
    Text: string;
    ContextInfo?: {
      StanzaId?: string;
      Participant?: string;
    };
  };
  ImageMessage?: GenfityMediaMessage;
  VideoMessage?: GenfityMediaMessage;
  AudioMessage?: GenfityMediaMessage;
  DocumentMessage?: GenfityMediaMessage & {
    FileName?: string;
  };
  StickerMessage?: GenfityMediaMessage;
  LocationMessage?: {
    DegreesLatitude: number;
    DegreesLongitude: number;
    Name?: string;
  };
  ContactMessage?: {
    DisplayName: string;
    Vcard?: string;
  };
  ReactionMessage?: {
    Text: string;
    Key?: {
      ID: string;
    };
  };
  ProtocolMessage?: {
    Type: number;
    Key?: {
      ID: string;
    };
  };
}

export interface GenfityMediaMessage {
  URL?: string;
  Caption?: string;
  Mimetype?: string;
  FileSHA256?: string;
  FileLength?: number;
  // Additional fields for media download
  MediaKey?: string;       // Base64 encoded byte array
  DirectPath?: string;
  FileEncSha256?: string;  // Base64 encoded byte array
  // Thumbnail (always available as fallback)
  JPEGThumbnail?: string;  // Base64 encoded thumbnail
}

export interface S3Data {
  url: string;
  key: string;
  bucket: string;
  size: number;
  mimeType: string;
  fileName: string;
}

// =====================================================
// WHATSAPP CLOUD API TYPES (Compatibility/Reference)
// =====================================================

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: WhatsAppValue;
  field: string;
}

export interface WhatsAppValue {
  messaging_product: string;
  metadata: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location';
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mime_type: string;
    sha256: string;
    caption?: string;
  };
  context?: {
    from: string;
    id: string;
  };
}

export interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

