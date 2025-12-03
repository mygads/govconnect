import { z } from 'zod';

export const LLMResponseSchema = z.object({
  intent: z.enum(['CREATE_COMPLAINT', 'CREATE_TICKET', 'CHECK_STATUS', 'CANCEL_COMPLAINT', 'HISTORY', 'KNOWLEDGE_QUERY', 'QUESTION', 'UNKNOWN']),
  fields: z.object({
    kategori: z.string().optional(),
    alamat: z.string().optional(),
    deskripsi: z.string().optional(),
    rt_rw: z.string().optional(),
    jenis: z.string().optional(),
    knowledge_category: z.string().optional(), // For knowledge queries
    complaint_id: z.string().optional(), // For status check/cancel (LAP-XXXXXXXX-XXX)
    ticket_id: z.string().optional(), // For status check/cancel (TIK-XXXXXXXX-XXX)
    cancel_reason: z.string().optional(), // For cancellation reason
    missing_info: z.array(z.string()).optional(), // What info is still missing
  }),
  reply_text: z.string(),
  needs_knowledge: z.boolean().optional(), // Flag if knowledge lookup is needed
  guidance_text: z.string().optional(), // Optional follow-up guidance message (sent as separate bubble)
  follow_up_questions: z.array(z.string()).optional(), // Suggested follow-up questions
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export interface LLMMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
  tokenCount?: number;
  model: string;
}
