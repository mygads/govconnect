// GovConnect - Type Definitions
// Types untuk sistem pelayanan desa/kelurahan

import { 
  UserRole, 
  KnowledgeCategoryType, 
  RequirementType, 
  ServiceRequestStatus, 
  DeliveryMethod,
  ReportStatus,
  ChannelType,
  ConversationStatus,
  MessageRole
} from '@prisma/client';

// Re-export Prisma enums
export {
  UserRole,
  KnowledgeCategoryType,
  RequirementType,
  ServiceRequestStatus,
  DeliveryMethod,
  ReportStatus,
  ChannelType,
  ConversationStatus,
  MessageRole
};

// ==================== USER TYPES ====================

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  phone?: string | null;
  avatar_url?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserSession {
  id: string;
  user_id: string;
  token: string;
  expires_at: Date;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: Date;
}

export interface AuthUser extends User {
  village?: Village | null;
}

// ==================== VILLAGE TYPES ====================

export interface Village {
  id: string;
  user_id: string;
  name: string;
  short_name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gmaps_url?: string | null;
  website?: string | null;
  kode_pos?: string | null;
  kecamatan?: string | null;
  kabupaten?: string | null;
  provinsi?: string | null;
  kepala_desa?: string | null;
  nip_kepala_desa?: string | null;
  logo_url?: string | null;
  whatsapp_enabled: boolean;
  whatsapp_token?: string | null;
  whatsapp_number?: string | null;
  whatsapp_webhook_url?: string | null;
  webchat_enabled: boolean;
  ai_enabled: boolean;
  ai_greeting?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface VillageOperatingHours {
  id: string;
  village_id: string;
  day_of_week: number; // 0=Minggu, 1=Senin, dst
  is_open: boolean;
  open_time?: string | null;
  close_time?: string | null;
}

export interface VillageWithDetails extends Village {
  user: User;
  operating_hours: VillageOperatingHours[];
}

// ==================== KNOWLEDGE BASE TYPES ====================

export interface KnowledgeCategory {
  id: string;
  village_id: string;
  name: string;
  type: KnowledgeCategoryType;
  description?: string | null;
  icon?: string | null;
  order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface KnowledgeFile {
  id: string;
  village_id: string;
  category_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  file_path: string;
  is_processed: boolean;
  processed_content?: string | null;
  total_chunks?: number | null;
  error_message?: string | null;
  title?: string | null;
  description?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface KnowledgeText {
  id: string;
  village_id: string;
  category_id: string;
  title: string;
  content: string;
  keywords: string[];
  order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface KnowledgeCategoryWithContent extends KnowledgeCategory {
  files: KnowledgeFile[];
  texts: KnowledgeText[];
}

// ==================== IMPORTANT NUMBERS TYPES ====================

export interface ImportantNumberCategory {
  id: string;
  village_id: string;
  name: string;
  icon?: string | null;
  order: number;
  created_at: Date;
  updated_at: Date;
}

export interface ImportantNumber {
  id: string;
  category_id: string;
  name: string;
  phone: string;
  description?: string | null;
  address?: string | null;
  is_active: boolean;
  order: number;
  created_at: Date;
  updated_at: Date;
}

export interface ImportantNumberCategoryWithNumbers extends ImportantNumberCategory {
  numbers: ImportantNumber[];
}

// ==================== SERVICE TYPES ====================

export interface ServiceCategory {
  id: string;
  village_id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Service {
  id: string;
  village_id: string;
  category_id: string;
  name: string;
  slug: string;
  description?: string | null;
  processing_time?: string | null;
  notes?: string | null;
  delivery_method: DeliveryMethod;
  is_active: boolean;
  order: number;
  created_at: Date;
  updated_at: Date;
}

export interface ServiceRequirement {
  id: string;
  service_id: string;
  name: string;
  type: RequirementType;
  description?: string | null;
  is_required: boolean;
  order: number;
  accepted_file_types?: string | null;
  max_file_size?: number | null;
  options: string[];
  placeholder?: string | null;
  min_length?: number | null;
  max_length?: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface ServiceWithDetails extends Service {
  category: ServiceCategory;
  requirements: ServiceRequirement[];
}

export interface ServiceCategoryWithServices extends ServiceCategory {
  services: ServiceWithDetails[];
}

// ==================== SERVICE REQUEST TYPES ====================

export interface ServiceRequest {
  id: string;
  ticket_number: string;
  village_id: string;
  service_id: string;
  applicant_name: string;
  applicant_phone: string;
  applicant_email?: string | null;
  applicant_nik?: string | null;
  applicant_address?: string | null;
  status: ServiceRequestStatus;
  delivery_method: DeliveryMethod;
  admin_notes?: string | null;
  reject_reason?: string | null;
  result_file_url?: string | null;
  result_notes?: string | null;
  created_at: Date;
  updated_at: Date;
  processed_at?: Date | null;
  completed_at?: Date | null;
}

export interface ServiceRequestRequirement {
  id: string;
  request_id: string;
  requirement_id: string;
  text_value?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  created_at: Date;
}

export interface ServiceRequestStatusHistory {
  id: string;
  request_id: string;
  status: ServiceRequestStatus;
  notes?: string | null;
  created_by?: string | null;
  created_at: Date;
}

export interface ServiceRequestWithDetails extends ServiceRequest {
  village: Village;
  service: ServiceWithDetails;
  requirements: (ServiceRequestRequirement & {
    requirement: ServiceRequirement;
  })[];
  status_history: ServiceRequestStatusHistory[];
}

// ==================== REPORT TYPES ====================

export interface ReportCategory {
  id: string;
  village_id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ReportType {
  id: string;
  category_id: string;
  name: string;
  description?: string | null;
  is_urgent: boolean;
  requires_address: boolean;
  requires_photo: boolean;
  send_number_to_user: boolean;
  auto_response?: string | null;
  is_active: boolean;
  order: number;
  created_at: Date;
  updated_at: Date;
}

export interface ReportTypeWithNumbers extends ReportType {
  important_numbers: {
    important_number: ImportantNumber;
  }[];
}

export interface ReportCategoryWithTypes extends ReportCategory {
  types: ReportTypeWithNumbers[];
}

export interface Report {
  id: string;
  ticket_number: string;
  village_id: string;
  type_id: string;
  reporter_phone: string;
  reporter_name?: string | null;
  description: string;
  address?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  photo_urls: string[];
  status: ReportStatus;
  is_urgent: boolean;
  created_at: Date;
  updated_at: Date;
  resolved_at?: Date | null;
}

export interface ReportResponse {
  id: string;
  report_id: string;
  message: string;
  image_urls: string[];
  created_by: string;
  created_at: Date;
}

export interface ReportWithDetails extends Report {
  village: Village;
  type: ReportTypeWithNumbers & {
    category: ReportCategory;
  };
  responses: ReportResponse[];
}

// ==================== CONVERSATION TYPES ====================

export interface Conversation {
  id: string;
  village_id: string;
  channel: ChannelType;
  external_id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  status: ConversationStatus;
  is_takeover: boolean;
  takeover_by?: string | null;
  takeover_at?: Date | null;
  last_message_at?: Date | null;
  message_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  intent?: string | null;
  is_read: boolean;
  created_at: Date;
}

export interface ConversationWithMessages extends Conversation {
  village: Village;
  messages: Message[];
}

// ==================== API RESPONSE TYPES ====================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ==================== FORM TYPES ====================

export interface RegisterFormData {
  email: string;
  password: string;
  name: string;
  phone?: string;
  village_name: string;
  village_short_name: string;
  kecamatan?: string;
  kabupaten?: string;
  provinsi?: string;
}

export interface LoginFormData {
  email: string;
  password: string;
}

export interface VillageProfileFormData {
  name: string;
  short_name: string;
  address?: string;
  phone?: string;
  email?: string;
  gmaps_url?: string;
  website?: string;
  kode_pos?: string;
  kecamatan?: string;
  kabupaten?: string;
  provinsi?: string;
  kepala_desa?: string;
  nip_kepala_desa?: string;
}

export interface ServiceFormData {
  category_id: string;
  name: string;
  slug?: string;
  description?: string;
  processing_time?: string;
  notes?: string;
  delivery_method: DeliveryMethod;
  is_active: boolean;
  requirements: ServiceRequirementFormData[];
}

export interface ServiceRequirementFormData {
  id?: string;
  name: string;
  type: RequirementType;
  description?: string;
  is_required: boolean;
  order: number;
  accepted_file_types?: string;
  max_file_size?: number;
  options?: string[];
  placeholder?: string;
  min_length?: number;
  max_length?: number;
}

export interface ReportTypeFormData {
  category_id: string;
  name: string;
  description?: string;
  is_urgent: boolean;
  requires_address: boolean;
  requires_photo: boolean;
  send_number_to_user: boolean;
  auto_response?: string;
  important_number_ids: string[];
}

// ==================== DASHBOARD STATS TYPES ====================

export interface DashboardStats {
  total_services: number;
  total_service_requests: number;
  pending_requests: number;
  total_reports: number;
  urgent_reports: number;
  pending_reports: number;
  total_conversations: number;
  active_conversations: number;
}

export interface SuperAdminStats {
  total_villages: number;
  total_users: number;
  total_service_requests: number;
  total_reports: number;
  active_channels: number;
}

// ==================== DAY OF WEEK HELPER ====================

export const DAY_NAMES = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu'
] as const;

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ==================== STATUS LABELS ====================

export const SERVICE_REQUEST_STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  PENDING: 'Menunggu',
  IN_PROGRESS: 'Diproses',
  COMPLETED: 'Selesai',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan'
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  RECEIVED: 'Diterima',
  IN_PROGRESS: 'Ditangani',
  RESOLVED: 'Selesai',
  CLOSED: 'Ditutup'
};

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  ONLINE: 'Dikirim Online',
  PICKUP: 'Ambil ke Kantor',
  BOTH: 'Online / Ambil ke Kantor'
};

export const REQUIREMENT_TYPE_LABELS: Record<RequirementType, string> = {
  FILE: 'Upload File',
  TEXT: 'Teks Singkat',
  TEXTAREA: 'Teks Panjang',
  SELECT: 'Pilihan',
  DATE: 'Tanggal',
  NUMBER: 'Angka',
  PHONE: 'Nomor Telepon',
  EMAIL: 'Email'
};

export const KNOWLEDGE_CATEGORY_TYPE_LABELS: Record<KnowledgeCategoryType, string> = {
  PROFIL_DESA: 'Profil Desa',
  FAQ: 'FAQ',
  PANDUAN: 'Panduan',
  STRUKTUR_DESA: 'Struktur Desa',
  DATA_RT_RW: 'Data RT/RW',
  LAYANAN: 'Informasi Layanan',
  CUSTOM: 'Kustom'
};
