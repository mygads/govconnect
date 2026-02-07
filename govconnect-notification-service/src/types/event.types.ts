export type ChannelType = 'WHATSAPP' | 'WEBCHAT';

export interface BaseChannelEvent {
  village_id?: string;
  channel: ChannelType;
  channel_identifier: string;
  // Legacy support - deprecated
  wa_user_id?: string;
}

export interface AIReplyEvent extends BaseChannelEvent {
  reply_text: string;
}

export interface ComplaintCreatedEvent extends BaseChannelEvent {
  complaint_id: string;
  kategori: string;
}

export interface ServiceRequestedEvent extends BaseChannelEvent {
  request_number: string;
  service_id: string;
  service_name?: string;
}

export interface StatusUpdatedEvent extends BaseChannelEvent {
  complaint_id?: string;
  request_number?: string;
  status: string;
  admin_notes?: string;
}

export interface UrgentAlertEvent {
  type: string;
  complaint_id: string;
  kategori: string;
  deskripsi: string;
  alamat?: string;
  rt_rw?: string;
  channel: ChannelType;
  channel_identifier: string;
  wa_user_id?: string; // Legacy
  created_at: string;
}
