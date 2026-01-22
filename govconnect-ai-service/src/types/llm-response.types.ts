import { z } from 'zod';

export const LLMResponseSchema = z.object({
  intent: z.enum([
    'CREATE_COMPLAINT', 
    'SERVICE_INFO',
    'CREATE_SERVICE_REQUEST',
    'UPDATE_SERVICE_REQUEST',
    'UPDATE_COMPLAINT',
    'CHECK_STATUS', 
    'CANCEL_COMPLAINT', 
    'CANCEL_SERVICE_REQUEST',
    'HISTORY', 
    'KNOWLEDGE_QUERY', 
    'QUESTION', 
    'UNKNOWN'
  ]),
  fields: z.object({
    // For CREATE_COMPLAINT
    kategori: z.string().optional(),
    alamat: z.string().optional(),
    deskripsi: z.string().optional(),
    rt_rw: z.string().optional(),
    jenis: z.string().optional(),
    
    // For SERVICE_INFO / CREATE_SERVICE_REQUEST
    service_id: z.string().optional(),
    service_slug: z.string().optional(),
    request_number: z.string().optional(),
    citizen_data: z.object({
      nama_lengkap: z.string().optional(),
      nik: z.string().optional(),
      alamat: z.string().optional(),
      no_hp: z.string().optional(),
    }).passthrough().optional(), // passthrough allows additional fields per service
    
    // For KNOWLEDGE_QUERY
    knowledge_category: z.string().optional(),
    
    // For CHECK_STATUS / CANCEL / UPDATE_COMPLAINT
    complaint_id: z.string().optional(),
    cancel_reason: z.string().optional(),
    
    // Common
    missing_info: z.array(z.string()).optional(),
  }),
  reply_text: z.string(),
  needs_knowledge: z.boolean().optional(),
  guidance_text: z.string().optional(),
  follow_up_questions: z.array(z.string()).optional(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export interface LLMMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
  tokenCount?: number;
  model: string;
}
