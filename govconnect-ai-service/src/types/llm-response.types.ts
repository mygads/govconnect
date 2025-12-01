import { z } from 'zod';

export const LLMResponseSchema = z.object({
  intent: z.enum(['CREATE_COMPLAINT', 'CREATE_TICKET', 'CHECK_STATUS', 'KNOWLEDGE_QUERY', 'QUESTION', 'UNKNOWN']),
  fields: z.object({
    kategori: z.string().optional(),
    alamat: z.string().optional(),
    deskripsi: z.string().optional(),
    rt_rw: z.string().optional(),
    jenis: z.string().optional(),
    knowledge_category: z.string().optional(), // For knowledge queries
    complaint_id: z.string().optional(), // For status check (LAP-XXXXXXXX-XXX)
    ticket_id: z.string().optional(), // For status check (TIK-XXXXXXXX-XXX)
  }),
  reply_text: z.string(),
  needs_knowledge: z.boolean().optional(), // Flag if knowledge lookup is needed
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export interface LLMMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
  tokenCount?: number;
  model: string;
}
