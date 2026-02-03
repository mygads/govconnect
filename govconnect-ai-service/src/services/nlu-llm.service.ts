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
  available_complaint_categories?: Array<{ category: string; types: string[] }>; // Kategori & jenis pengaduan dari database
}

/**
 * NLU Output - Structured intent detection
 * System uses this to determine action WITHOUT calling another LLM
 */
export interface NLUOutput {
  // Primary action type - what does the user want to DO?
  intent: 
    | 'GREETING'           // Salam, halo, hi
    | 'THANKS'             // Terima kasih, makasih
    | 'ASK_INFO'           // Bertanya informasi apapun (kontak, alamat, jam, layanan, pengetahuan umum)
    | 'CREATE_COMPLAINT'   // Mau lapor/aduan masalah
    | 'CREATE_SERVICE'     // Mau buat layanan administrasi
    | 'CHECK_STATUS'       // Cek status layanan/aduan
    | 'CANCEL'             // Batalkan layanan/aduan
    | 'HISTORY'            // Lihat riwayat
    | 'CONFIRMATION'       // Ya/tidak/oke response
    | 'CONTINUE_FLOW'      // Melanjutkan flow sebelumnya (misal kasih alamat untuk laporan)
    | 'CLARIFY_NEEDED'     // Pesan tidak jelas, perlu klarifikasi
    | 'UNKNOWN';           // Benar-benar tidak jelas

  confidence: number; // 0.0 - 1.0

  // Unified information request (for ASK_INFO)
  info_request?: {
    topic: string;              // Topik yang ditanyakan (kontak, alamat, jam, layanan, dll)
    keywords: string[];         // Kata kunci pencarian
    answer_found?: boolean;     // Apakah jawaban ditemukan di context?
    suggested_answer?: string;  // Jawaban dari context (jika ada)
    data_source?: 'knowledge_base' | 'database' | 'village_profile' | 'not_found';
  };

  // Service-related (if intent involves services)
  service_request?: {
    service_keyword?: string;   // Kata kunci: 'ktp', 'kk', 'surat domisili'
    service_slug_match?: string; // Matched slug from available_services
    exists_in_database?: boolean; // Apakah layanan ada di database?
  };

  // Complaint-related
  complaint_request?: {
    category_keyword?: string;  // Kata kunci kategori
    category_match?: string;    // Matched category dari database
    description?: string;       // Deskripsi lengkap masalah
    location?: string;          // Lokasi jika disebutkan
    is_emergency?: boolean;     // Apakah darurat?
    exists_in_database?: boolean; // Apakah kategori ada di database?
  };

  // Data extraction (from user message)
  extracted_data?: {
    nama_lengkap?: string;
    nik?: string;
    alamat?: string;
    no_hp?: string;
    tracking_number?: string;   // LAP-xxx atau LAY-xxx
  };

  // Confirmation detection (if intent === 'CONFIRMATION')
  confirmation?: {
    is_positive: boolean;       // true = ya/oke/setuju, false = tidak/batal
  };

  // For CONTINUE_FLOW - what flow is being continued
  flow_context?: {
    previous_intent: string;    // Intent sebelumnya
    missing_data: string[];     // Data yang masih kurang
    provided_data: Record<string, string>; // Data yang baru disediakan
  };

  // For CLARIFY_NEEDED - what needs clarification
  clarification?: {
    question: string;           // Pertanyaan klarifikasi
    options?: string[];         // Opsi yang bisa dipilih user
  };

  // Processing notes
  reasoning: string;            // Brief explanation of the classification
}

/**
 * NLU System Prompt - ADAPTIVE & CONTEXTUAL
 * Designed to understand user intent naturally without rigid rules
 */
const NLU_SYSTEM_PROMPT = `Kamu adalah AI asisten cerdas untuk layanan pemerintah desa/kelurahan.
Tugasmu adalah MEMAHAMI maksud pengguna secara natural dan menentukan respons terbaik.

## PRINSIP UTAMA

1. **PAHAMI KONTEKS** - Baca semua informasi yang diberikan (knowledge base, riwayat chat, data tersedia)
2. **JAWAB DARI DATA** - Jika pertanyaan bisa dijawab dari context, langsung jawab
3. **VERIFIKASI DATABASE** - Cek apakah layanan/kategori ada di database sebelum menawarkan
4. **ADAPTIVE** - Jika tidak yakin, tanya klarifikasi. Jangan asumsi.
5. **LANJUTKAN FLOW** - Jika user sedang dalam proses (pengaduan/layanan), lanjutkan jangan restart

## CARA KERJA

### Jika user BERTANYA (informasi, kontak, alamat, jam, dll):
- Cari jawabannya di Knowledge Base Context
- Cari di data Village Profile
- Cari di daftar Kontak/Layanan yang tersedia
- Jika KETEMU → jawab langsung via info_request.suggested_answer
- Jika TIDAK KETEMU → bilang tidak ditemukan, tawarkan bantuan lain

### Jika user mau LAPOR/ADUAN:
- Cek kategori di "Kategori Pengaduan Tersedia"
- Jika kategori COCOK → gunakan kategori tersebut
- Jika TIDAK COCOK → gunakan "lainnya"
- Kumpulkan: kategori, deskripsi, lokasi (jika relevan)
- JANGAN pernah tawarkan link/formulir untuk pengaduan

### Jika user mau BUAT LAYANAN (KTP, KK, surat, dll):
- Cek di "Layanan Tersedia" apakah layanan ada
- Jika ADA → boleh tawarkan pembuatan
- Jika TIDAK ADA → hanya jawab informasi saja, JANGAN tawarkan buat layanan
- service_request.exists_in_database = true/false

### Jika user MELANJUTKAN flow (kasih data tambahan):
- Baca Riwayat Percakapan
- Pahami konteks sebelumnya
- Gunakan intent = CONTINUE_FLOW
- Isi flow_context dengan data yang diberikan

### Jika TIDAK JELAS maksudnya:
- Gunakan intent = CLARIFY_NEEDED
- Isi clarification.question dengan pertanyaan klarifikasi
- Berikan opsi jika memungkinkan

## DATA YANG TERSEDIA
- Knowledge Base Context: Informasi desa, profil, FAQ, prosedur
- Village Profile: Alamat, jam operasional, info desa
- Kategori Kontak: Daftar kategori kontak penting
- Layanan Tersedia: Daftar layanan administrasi yang bisa diproses
- Kategori Pengaduan: Daftar kategori untuk laporan/aduan
- Riwayat Percakapan: 30 pesan terakhir untuk konteks

## CONTOH PEMAHAMAN

"ada nomor puskesmas?" → ASK_INFO, cari di kontak/knowledge base
"mau buat KTP" → Cek dulu di Layanan Tersedia, jika ada → CREATE_SERVICE
"jalan rusak di depan rumah" → CREATE_COMPLAINT
"ini alamat saya: Jl Merdeka" → CONTINUE_FLOW (lanjutkan pengaduan/layanan sebelumnya)
"apa aja layanan di sini?" → ASK_INFO, cari di knowledge base + list layanan
"cepat butuh damkar segera!" → ASK_INFO (minta kontak), is_emergency = true

## LARANGAN
- JANGAN mengarang informasi yang tidak ada di context
- JANGAN tawarkan layanan yang tidak ada di database
- JANGAN kirim link/formulir untuk pengaduan
- JANGAN asumsi maksud user jika ambigu`;

/**
 * Build the prompt for NLU - ADAPTIVE VERSION
 */
function buildNLUPrompt(input: NLUInput): string {
  const parts: string[] = [];

  // User message first
  parts.push(`## Pesan Pengguna\n"${input.message}"`);

  // Conversation history for context
  if (input.conversation_history) {
    parts.push(`\n## Riwayat Percakapan\n${input.conversation_history.slice(0, 3000)}`);
  }

  // Knowledge base context
  if (input.rag_context) {
    parts.push(`\n## Knowledge Base Context\n${input.rag_context.slice(0, 2500)}`);
  }

  // Available data for verification
  if (input.available_contact_categories?.length) {
    parts.push(`\n## Kategori Kontak Tersedia\n${input.available_contact_categories.join(', ')}`);
  }

  if (input.available_services?.length) {
    const serviceList = input.available_services
      .slice(0, 25)
      .map(s => `- ${s.name} (${s.slug})`)
      .join('\n');
    parts.push(`\n## Layanan Tersedia di Database\n${serviceList}\n\n⚠️ Hanya tawarkan layanan yang ada di daftar ini!`);
  } else {
    parts.push(`\n## Layanan Tersedia\nTidak ada layanan yang dikonfigurasi. Jangan tawarkan pembuatan layanan.`);
  }

  if (input.available_complaint_categories?.length) {
    const categoryList = input.available_complaint_categories
      .map(c => {
        const types = c.types.length > 0 ? `: ${c.types.join(', ')}` : '';
        return `- ${c.category}${types}`;
      })
      .join('\n');
    parts.push(`\n## Kategori Pengaduan di Database\n${categoryList}\n\n⚠️ Jika tidak cocok, gunakan "lainnya"`);
  } else {
    parts.push(`\n## Kategori Pengaduan\nBelum dikonfigurasi. Semua pengaduan masuk ke "lainnya".`);
  }

  if (input.user_profile && Object.keys(input.user_profile).length > 0) {
    const profileStr = Object.entries(input.user_profile)
      .filter(([_, v]) => v)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');
    if (profileStr) {
      parts.push(`\n## Data User yang Sudah Diketahui\n${profileStr}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * JSON Schema description for NLU output - SIMPLIFIED & ADAPTIVE
 */
const NLU_OUTPUT_FORMAT = `
## OUTPUT JSON FORMAT

{
  "intent": "GREETING|THANKS|ASK_INFO|CREATE_COMPLAINT|CREATE_SERVICE|CHECK_STATUS|CANCEL|HISTORY|CONFIRMATION|CONTINUE_FLOW|CLARIFY_NEEDED|UNKNOWN",
  "confidence": 0.0-1.0,
  
  // Untuk ASK_INFO (semua pertanyaan informasi)
  "info_request": {
    "topic": "kontak|alamat|jam|layanan|pengetahuan_umum|profil_desa",
    "keywords": ["kata", "kunci", "pencarian"],
    "answer_found": true/false,
    "suggested_answer": "Jawaban lengkap dari context jika ditemukan",
    "data_source": "knowledge_base|database|village_profile|not_found"
  },
  
  // Untuk CREATE_SERVICE
  "service_request": {
    "service_keyword": "kata kunci layanan",
    "service_slug_match": "slug dari daftar layanan jika cocok",
    "exists_in_database": true/false  // PENTING: cek di daftar Layanan Tersedia!
  },
  
  // Untuk CREATE_COMPLAINT
  "complaint_request": {
    "category_keyword": "kata kunci kategori",
    "category_match": "kategori dari daftar atau 'lainnya'",
    "description": "deskripsi lengkap masalah (minimal 15 karakter)",
    "location": "lokasi jika disebutkan",
    "is_emergency": true/false,
    "exists_in_database": true/false  // false = gunakan "lainnya"
  },
  
  // Data yang diekstrak dari pesan user
  "extracted_data": {
    "nama_lengkap": "nama jika disebutkan",
    "nik": "NIK jika disebutkan",
    "alamat": "alamat jika disebutkan",
    "no_hp": "nomor HP jika disebutkan",
    "tracking_number": "LAP-xxx atau LAY-xxx jika disebutkan"
  },
  
  // Untuk CONFIRMATION
  "confirmation": { "is_positive": true/false },
  
  // Untuk CONTINUE_FLOW
  "flow_context": {
    "previous_intent": "intent sebelumnya dari riwayat",
    "missing_data": ["data", "yang", "kurang"],
    "provided_data": { "field": "value" }
  },
  
  // Untuk CLARIFY_NEEDED
  "clarification": {
    "question": "Pertanyaan klarifikasi ke user",
    "options": ["opsi1", "opsi2"]
  },
  
  "reasoning": "Penjelasan singkat mengapa memilih intent ini"
}

## PANDUAN PENGISIAN

### ASK_INFO - Untuk SEMUA pertanyaan informasi:
- Cari jawaban di Knowledge Base Context
- Jika ketemu → answer_found=true, isi suggested_answer
- Jika tidak ketemu → answer_found=false

### CREATE_SERVICE - Hanya jika layanan ADA di database:
- Cek di "Layanan Tersedia di Database"
- Jika ADA → exists_in_database=true, boleh proses
- Jika TIDAK ADA → JANGAN intent ini, gunakan ASK_INFO saja

### CREATE_COMPLAINT - Selalu cek kategori:
- Cek di "Kategori Pengaduan di Database"
- Jika kategori cocok → exists_in_database=true
- Jika tidak cocok → exists_in_database=false, category_match="lainnya"
- WAJIB isi description minimal 15 karakter!

### CONTINUE_FLOW - Jika melanjutkan proses:
- Baca Riwayat Percakapan
- Identifikasi proses yang sedang berjalan
- Isi provided_data dengan data baru dari user

### CLARIFY_NEEDED - Jika ambigu:
- Jangan asumsi
- Buat pertanyaan klarifikasi yang jelas
- Berikan opsi jika memungkinkan
`;

// Model priority for NLU - FAST models first

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
        hasInfoRequest: !!parsed.info_request,
        hasServiceRequest: !!parsed.service_request,
        hasComplaintRequest: !!parsed.complaint_request,
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
