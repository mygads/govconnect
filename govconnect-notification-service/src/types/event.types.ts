export interface AIReplyEvent {
  wa_user_id: string;
  reply_text: string;
}

export interface ComplaintCreatedEvent {
  wa_user_id: string;
  complaint_id: string;
  kategori: string;
}

export interface ServiceRequestedEvent {
  wa_user_id: string;
  request_number: string;
  service_id: string;
  service_name?: string;
}

export interface StatusUpdatedEvent {
  wa_user_id: string;
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
  wa_user_id: string;
  created_at: string;
}
