/**
 * NLU (Natural Language Understanding) LLM Service
 * 
 * Purpose: Detect user intent using LLM with structured output
 * Replaces regex-based intent detection for better accuracy
 * 
 * This service:
 * 1. Takes user message + RAG context + conversation history
 * 2. Calls LLM to understand user intent
 * 3. Returns structured output that the system can act on directly
 */

import logger from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';
import { modelStatsService } from './model-stats.service';

// Models for NLU (cheapest/fastest first)
const NLU_MODEL_PRIORITY = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

/**
 * NLU Input - What we send to the LLM
 */
export interface NLUInput {
  message: string;
  wa_user_id: string;
  village_id?: string;
  rag_context?: string;        // Knowledge base context from RAG search
  conversation_history?: string; // FIFO last 30 messages
  user_profile?: {
    nama_lengkap?: string;
    nik?: string;
    alamat?: string;
    no_hp?: string;
  };
  available_services?: Array<{ name: string; slug: string }>;
  available_contact_categories?: string[]; // e.g., ['Pelayanan', 'Pengaduan', 'Keamanan', 'Kesehatan', 'Pemadam']
}

/**
 * NLU Output - Structured intent detection
 * System uses this to determine action WITHOUT calling another LLM
 */
export interface NLUOutput {
  // Primary intent classification
  intent: 
    | 'GREETING'           // Salam, halo, hi
    | 'THANKS'             // Terima kasih, makasih
    | 'ASK_CONTACT'        // Minta nomor penting/kontak
    | 'ASK_ADDRESS'        // Tanya alamat kantor
    | 'ASK_HOURS'          // Tanya jam operasional
    | 'ASK_SERVICE_INFO'   // Tanya syarat/info layanan
    | 'CREATE_SERVICE_REQUEST' // Mau buat layanan
    | 'CREATE_COMPLAINT'   // Mau lapor/aduan
    | 'CHECK_STATUS'       // Cek status layanan/aduan
    | 'ASK_KNOWLEDGE'      // Tanya info dari knowledge base
    | 'CANCEL'             // Batalkan layanan/aduan
    | 'UPDATE_DATA'        // Update data (alamat, nama, dll)
    | 'HISTORY'            // Lihat riwayat
    | 'CONFIRMATION'       // Ya/tidak/oke response
    | 'ASK_ABOUT_CONVERSATION' // Pertanyaan tentang percakapan sebelumnya
    | 'UNKNOWN';           // Tidak jelas

  confidence: number; // 0.0 - 1.0

  // Contact-related (if intent === 'ASK_CONTACT')
  contact_request?: {
    category_keyword?: string;  // Kata kunci: 'puskesmas', 'polisi', 'damkar', etc.
    category_match?: string;    // Matched category name: 'Kesehatan', 'Keamanan', 'Pemadam'
    is_emergency?: boolean;     // Apakah darurat/urgent?
  };

  // Service-related (if intent involves services)
  service_request?: {
    service_keyword?: string;   // Kata kunci: 'ktp', 'kk', 'surat domisili'
    service_slug_match?: string; // Matched slug from available_services
  };

  // Knowledge query (if intent === 'ASK_KNOWLEDGE')
  knowledge_request?: {
    question_summary: string;   // Ringkasan pertanyaan
    answer_found_in_context?: boolean; // Apakah jawaban ada di RAG context?
    suggested_answer?: string;  // Jawaban dari context (jika ada)
  };

  // Data extraction
  extracted_data?: {
    nama_lengkap?: string;
    nik?: string;
    alamat?: string;
    no_hp?: string;
    tracking_number?: string;   // LAP-xxx atau LAY-xxx
    complaint_category?: string; // Kategori aduan: jalan_rusak, lampu_mati, dll
    complaint_description?: string;
  };

  // Confirmation detection (if intent === 'CONFIRMATION')
  confirmation?: {
    is_positive: boolean;       // true = ya/oke/setuju, false = tidak/batal
  };

  // Processing notes
  reasoning: string;            // Brief explanation of the classification
}

/**
 * NLU System Prompt - ENHANCED for smarter understanding
 */
const NLU_SYSTEM_PROMPT = `Kamu adalah NLU (Natural Language Understanding) AI yang SANGAT PINTAR untuk layanan pemerintah desa.
Tugasmu adalah MEMAHAMI maksud pengguna dari pesan mereka dan mengembalikan output terstruktur.

## ATURAN UTAMA (WAJIB DIPATUHI)

1. **DILARANG MENGARANG** - Jika informasi tidak ada di knowledge base context, jawab "tidak ditemukan"
2. **WAJIB BACA CONTEXT** - Selalu baca dan pahami Knowledge Base Context yang diberikan
3. **JAWABAN DARI DATA** - Semua jawaban HARUS berdasarkan data yang tersedia, bukan asumsi

## KONTEKS
- Pesan dari warga melalui WhatsApp ke layanan desa/kelurahan
- Warga bisa menanyakan informasi, membuat pengaduan, atau mengurus layanan administrasi

## INPUT YANG DIBERIKAN
- Pesan pengguna
- **Konteks Knowledge Base** (PENTING: ini adalah sumber kebenaran untuk menjawab pertanyaan)
- Riwayat percakapan (30 pesan terakhir)
- Kategori kontak yang tersedia di desa ini
- Layanan yang tersedia di desa ini

## INTENT CLASSIFICATION RULES

### Untuk Pertanyaan Informasi:
1. **ASK_CONTACT** - Minta nomor penting (ambulan, polisi, puskesmas, dll)
   - WAJIB cari di knowledge base context
   - Jika tidak ada, jawab "tidak ditemukan"
   
2. **ASK_ADDRESS** - Tanya alamat kantor desa
   - Ambil dari village profile jika ada
   
3. **ASK_HOURS** - Tanya jam operasional
   - Ambil dari village profile jika ada
   
4. **ASK_SERVICE_INFO** - Tanya syarat/prosedur layanan
   - Cari di knowledge base context
   - Jika tidak ada, set answer_found_in_context = false
   
5. **ASK_KNOWLEDGE** - Pertanyaan umum lainnya
   - WAJIB cari jawabannya di knowledge base context
   - Jika ketemu, set answer_found_in_context = true DAN isi suggested_answer
   - Jika tidak ketemu, set answer_found_in_context = false

### Untuk Aksi:
6. **CREATE_SERVICE_REQUEST** - Mau buat layanan administrasi
7. **CREATE_COMPLAINT** - Mau lapor/aduan masalah
8. **CHECK_STATUS** - Cek status layanan/aduan
9. **CANCEL** - Batalkan layanan/aduan
10. **HISTORY** - Lihat riwayat

### Lainnya:
11. **GREETING** - Salam, halo, perkenalan diri
    - JIKA user memperkenalkan diri (misal: "halo saya yoga", "saya budi"), EKSTRAK NAMA ke extracted_data.nama_lengkap
12. **THANKS** - Terima kasih
13. **CONFIRMATION** - Ya/tidak
14. **UPDATE_DATA** - Update data
15. **ASK_ABOUT_CONVERSATION** - Pertanyaan tentang percakapan sebelumnya
    - Contoh: "siapa saya?", "apa yang saya tanyakan tadi?", "tadi saya bilang apa?"
    - WAJIB jawab dari Riwayat Percakapan jika ada
    - Isi suggested_answer dengan jawaban dari riwayat
16. **UNKNOWN** - Tidak jelas

## PENTING untuk ASK_CONTACT
- Cocokkan kata kunci pengguna dengan kategori yang tersedia
- Contoh mapping:
  * "ambulan/ambulans/rs/rumah sakit/puskesmas/UGD" → Kesehatan
  * "polisi/keamanan" → Keamanan  
  * "pemadam/damkar/kebakaran" → Pemadam
  * "pelayanan/layanan" → Pelayanan
  * "pengaduan/aduan" → Pengaduan
  
## PENTING untuk ASK_KNOWLEDGE
- Baca dengan teliti Knowledge Base Context
- Jika pertanyaan user bisa dijawab dari context:
  * Set answer_found_in_context = true
  * Isi suggested_answer dengan jawaban LENGKAP dari context
  * JANGAN singkat jawaban, berikan semua informasi yang relevan
- Jika tidak ada di context:
  * Set answer_found_in_context = false
  * JANGAN mengarang jawaban

Berikan output JSON yang terstruktur.`;

/**
 * Build the prompt for NLU
 */
function buildNLUPrompt(input: NLUInput): string {
  const parts: string[] = [];

  parts.push(`## Pesan Pengguna\n${input.message}`);

  if (input.rag_context) {
    parts.push(`\n## Konteks Knowledge Base\n${input.rag_context.slice(0, 2000)}`);
  }

  if (input.conversation_history) {
    parts.push(`\n## Riwayat Percakapan (30 pesan terakhir)\n${input.conversation_history.slice(0, 3000)}`);
  }

  if (input.available_contact_categories?.length) {
    parts.push(`\n## Kategori Kontak Tersedia\n${input.available_contact_categories.join(', ')}`);
  }

  if (input.available_services?.length) {
    const serviceList = input.available_services
      .slice(0, 20)
      .map(s => `- ${s.name} (${s.slug})`)
      .join('\n');
    parts.push(`\n## Layanan Tersedia\n${serviceList}`);
  }

  if (input.user_profile && Object.keys(input.user_profile).length > 0) {
    const profileStr = Object.entries(input.user_profile)
      .filter(([_, v]) => v)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');
    if (profileStr) {
      parts.push(`\n## Profil Pengguna\n${profileStr}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * JSON Schema description for NLU output (used in prompt, not as structured schema)
 */
const NLU_OUTPUT_FORMAT = `
OUTPUT JSON FORMAT:
{
  "intent": "GREETING|THANKS|ASK_CONTACT|ASK_ADDRESS|ASK_HOURS|ASK_SERVICE_INFO|CREATE_SERVICE_REQUEST|CREATE_COMPLAINT|CHECK_STATUS|ASK_KNOWLEDGE|CANCEL|UPDATE_DATA|HISTORY|CONFIRMATION|ASK_ABOUT_CONVERSATION|UNKNOWN",
  "confidence": 0.0-1.0,
  "contact_request": { "category_keyword": "...", "category_match": "...", "is_emergency": true/false } // only if ASK_CONTACT
  "service_request": { "service_keyword": "...", "service_slug_match": "..." } // only if service-related
  "knowledge_request": { "question_summary": "...", "answer_found_in_context": true/false, "suggested_answer": "..." } // if ASK_KNOWLEDGE or ASK_ABOUT_CONVERSATION
  "extracted_data": { "nama_lengkap": "...", "nik": "...", "alamat": "...", "no_hp": "...", "tracking_number": "...", "complaint_category": "...", "complaint_description": "..." }
  "confirmation": { "is_positive": true/false } // only if CONFIRMATION
  "reasoning": "Brief explanation"
}

PENTING untuk GREETING dengan perkenalan:
- Jika user menyebutkan nama (misal "halo saya yoga", "nama saya budi"), tetap intent=GREETING tapi ISI extracted_data.nama_lengkap

PENTING untuk ASK_ABOUT_CONVERSATION:
- Jika user tanya tentang percakapan sebelumnya (misal "siapa saya?", "tadi saya tanya apa?")
- WAJIB baca Riwayat Percakapan dan jawab dari sana
- Isi knowledge_request.suggested_answer dengan jawaban yang relevan
`;

/**
 * Call NLU LLM to understand user intent
 */
export async function callNLU(input: NLUInput): Promise<NLUOutput | null> {
  const startTime = Date.now();

  logger.info('🧠 NLU LLM call started', {
    wa_user_id: input.wa_user_id,
    messageLength: input.message.length,
    hasRagContext: !!input.rag_context,
    hasHistory: !!input.conversation_history,
    availableCategories: input.available_contact_categories?.length || 0,
    availableServices: input.available_services?.length || 0,
  });

  const userPrompt = buildNLUPrompt(input);

  for (let i = 0; i < NLU_MODEL_PRIORITY.length; i++) {
    const model = NLU_MODEL_PRIORITY[i];

    try {
      logger.info('🔄 NLU attempting model', {
        wa_user_id: input.wa_user_id,
        model,
        attempt: i + 1,
      });

      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      const geminiModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
          temperature: 0.1, // Low for consistent classification
          maxOutputTokens: 1500,
          responseMimeType: 'application/json',
        },
        systemInstruction: NLU_SYSTEM_PROMPT + '\n\n' + NLU_OUTPUT_FORMAT,
      });

      const result = await geminiModel.generateContent(userPrompt);
      const responseText = result.response.text();

      // Parse response
      let parsed: NLUOutput;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        // Try to extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Invalid JSON response');
        }
      }

      // Validate required fields
      if (!parsed.intent || typeof parsed.confidence !== 'number') {
        throw new Error('Missing required fields');
      }

      const durationMs = Date.now() - startTime;
      modelStatsService.recordSuccess(model, durationMs);

      logger.info('✅ NLU LLM success', {
        wa_user_id: input.wa_user_id,
        model,
        intent: parsed.intent,
        confidence: parsed.confidence,
        hasContactRequest: !!parsed.contact_request,
        hasServiceRequest: !!parsed.service_request,
        hasKnowledgeRequest: !!parsed.knowledge_request,
        durationMs,
      });

      return parsed;

    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      modelStatsService.recordFailure(model, error.message, durationMs);

      logger.warn('❌ NLU model failed', {
        wa_user_id: input.wa_user_id,
        model,
        attempt: i + 1,
        error: error.message,
      });

      if (i === NLU_MODEL_PRIORITY.length - 1) {
        logger.error('🚨 All NLU models failed', {
          wa_user_id: input.wa_user_id,
        });
        return null;
      }
    }
  }

  return null;
}

/**
 * Quick intent check for simple patterns (no LLM call needed)
 * Used as fallback or for very simple messages
 */
export function quickIntentCheck(message: string): Partial<NLUOutput> | null {
  const normalized = message.toLowerCase().trim();

  // Greeting
  if (/^(halo|hai|hi|selamat\s+(pagi|siang|sore|malam)|assalamualaikum|salam)[\s.,!]*$/i.test(normalized)) {
    return {
      intent: 'GREETING',
      confidence: 0.95,
      reasoning: 'Simple greeting detected',
    };
  }

  // Thanks
  if (/^(makasih|terima\s*kasih|thanks|trims|thank\s*you)[\s.,!]*$/i.test(normalized)) {
    return {
      intent: 'THANKS',
      confidence: 0.95,
      reasoning: 'Simple thanks detected',
    };
  }

  // Simple yes/no
  if (/^(ya|iya|oke|ok|siap|boleh|mau|setuju)\s*$/i.test(normalized)) {
    return {
      intent: 'CONFIRMATION',
      confidence: 0.9,
      confirmation: { is_positive: true },
      reasoning: 'Positive confirmation detected',
    };
  }

  if (/^(tidak|ga|gak|nggak|enggak|batal|no|nope)\s*$/i.test(normalized)) {
    return {
      intent: 'CONFIRMATION',
      confidence: 0.9,
      confirmation: { is_positive: false },
      reasoning: 'Negative confirmation detected',
    };
  }

  // Tracking number check
  const trackingMatch = normalized.match(/\b(LAP|LAY)-\d{8}-\d{3}\b/i);
  if (trackingMatch) {
    return {
      intent: 'CHECK_STATUS',
      confidence: 0.85,
      extracted_data: { tracking_number: trackingMatch[0].toUpperCase() },
      reasoning: 'Tracking number detected in message',
    };
  }

  return null;
}
