/**
 * Micro NLU Service - Ultra-lightweight LLM intent classification
 * 
 * Menggantikan pattern matching yang kaku dengan LLM call sangat kecil.
 * Prompt ~200 tokens, output ~100 tokens. 
 * 
 * Keuntungan:
 * - Memahami variasi bahasa manusia (tidak kaku)
 * - Bisa paham konteks dari riwayat chat
 * - Tetap hemat token (jauh lebih kecil dari full NLU)
 * 
 * Contoh yang sekarang bisa dipahami:
 * - "rumah saya terbakar" → EMERGENCY_CONTACT (damkar)
 * - "anak saya sakit ada nomor rs?" → CONTACT (kesehatan)
 * - "saya mau lapor kebakaran" → CREATE_COMPLAINT (kebakaran)
 */

import logger from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';
import { modelStatsService } from './model-stats.service';

// ==================== MICRO NLU OUTPUT ====================

export interface MicroNLUResult {
  // What does user want?
  action: 
    | 'GREETING'           // Salam biasa
    | 'THANKS'             // Terima kasih
    | 'CONFIRMATION'       // Ya/tidak/oke
    | 'ASK_CONTACT'        // Minta nomor kontak/telepon
    | 'ASK_INFO'           // Tanya informasi umum
    | 'CREATE_COMPLAINT'   // Mau lapor masalah
    | 'CREATE_SERVICE'     // Mau buat layanan
    | 'CHECK_STATUS'       // Cek status
    | 'CANCEL'             // Batalkan
    | 'HISTORY'            // Lihat riwayat
    | 'CONTINUE_FLOW'      // Lanjutkan proses (kasih data alamat, dll)
    | 'PROVIDE_NAME'       // User memberikan nama
    | 'PROVIDE_PHONE'      // User memberikan nomor HP
    | 'UNCLEAR';           // Tidak jelas - perlu tanya balik
  
  // Is this urgent/emergency?
  is_emergency: boolean;
  
  // Topic/category being discussed
  topic?: string;  // e.g., "damkar", "puskesmas", "kebakaran", "jalan rusak"
  
  // Extracted data (if any)
  extracted_data?: {
    nama?: string;
    alamat?: string;
    no_hp?: string;
    tracking_number?: string;
  };
  
  // For clarification - pertanyaan untuk ditanyakan ke user
  clarification_question?: string;
  
  // Brief reasoning
  reasoning: string;
  
  // Confidence 0.0 - 1.0
  confidence: number;
}

// ==================== MICRO PROMPT ====================

const MICRO_PROMPT = `Kamu AI CERDAS asisten desa. Pahami MAKSUD user secara natural.

PESAN USER: "{message}"

RIWAYAT CHAT TERAKHIR:
{history}

## ACTIONS (pilih yang paling tepat):
- GREETING: salam/halo/hai/assalamualaikum
- THANKS: terima kasih/makasih/thanks
- CONFIRMATION: ya/tidak/oke/setuju/baik/siap
- ASK_CONTACT: minta nomor/kontak/telepon seseorang/instansi
- ASK_INFO: tanya informasi umum (jam buka, alamat, syarat, biaya, prosedur)
- CREATE_COMPLAINT: mau LAPOR/ADUKAN masalah/kejadian/kerusakan
- CREATE_SERVICE: mau BUAT/AJUKAN layanan administrasi (KTP, surat, dll)
- CHECK_STATUS: cek status pengaduan/layanan (cari LAP-/LAY-)
- CANCEL: batalkan pengajuan
- HISTORY: lihat riwayat/histori
- CONTINUE_FLOW: melanjutkan percakapan sebelumnya (kasih data: nama, alamat, dll)
- PROVIDE_NAME: user memberikan nama lengkapnya
- PROVIDE_PHONE: user memberikan nomor HP/WhatsApp
- UNCLEAR: BENAR-BENAR tidak paham (gunakan ini untuk tanya balik)

## CARA MEMAHAMI:
1. Baca RIWAYAT CHAT untuk paham konteks percakapan
2. Jika sebelumnya AI tanya nama → user jawab nama → PROVIDE_NAME
3. Jika sebelumnya AI tanya HP → user jawab nomor → PROVIDE_PHONE
4. Jika sebelumnya CREATE_COMPLAINT dan user kasih alamat → CONTINUE_FLOW
5. Situasi DARURAT (kebakaran, kecelakaan, sakit parah) → is_emergency=true

## CONTOH PEMAHAMAN:
- "rumah saya terbakar minta nomor pemadam" → ASK_CONTACT, topic=damkar, is_emergency=true
- "saya mau lapor ada kebakaran di RT 5" → CREATE_COMPLAINT, topic=kebakaran
- "ada nomor puskesmas?" → ASK_CONTACT, topic=puskesmas
- "Budi Santoso" (setelah AI tanya nama) → PROVIDE_NAME, extracted_data.nama="Budi Santoso"
- "081234567890" (setelah AI tanya HP) → PROVIDE_PHONE, extracted_data.no_hp="081234567890"
- "jalan rusak depan SD" → CREATE_COMPLAINT, topic=infrastruktur
- "mau bikin KTP" → CREATE_SERVICE, topic=ktp
- Jika TIDAK YAKIN → UNCLEAR + tulis clarification_question

## LARANGAN:
- JANGAN menebak jika tidak yakin
- JANGAN abaikan RIWAYAT CHAT
- Jika ambigu → gunakan UNCLEAR dan tulis pertanyaan klarifikasi

OUTPUT JSON SAJA (tanpa markdown/code block):
{"action":"..","is_emergency":false,"topic":"..","extracted_data":{"nama":"","no_hp":"","alamat":""},"clarification_question":"","reasoning":"alasan singkat","confidence":0.0-1.0}`;

// ==================== IMPLEMENTATION ====================

import { incrementCallCount } from './nlu-llm.service';

// ==================== MODEL CONFIGURATION ====================

const DEFAULT_MICRO_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

function parseModelListEnv(envValue: string | undefined, fallback: string[]): string[] {
  const raw = (envValue || '').trim();
  if (!raw) return fallback;

  const models = raw.split(',').map((m) => m.trim()).filter(Boolean);
  const unique: string[] = [];
  for (const model of models) {
    if (!unique.includes(model)) unique.push(model);
  }
  return unique.length > 0 ? unique : fallback;
}

const MICRO_NLU_MODELS = parseModelListEnv(process.env.MICRO_NLU_MODELS, DEFAULT_MICRO_MODELS);
const MICRO_MODEL = MICRO_NLU_MODELS[0]; // Primary model (first in list)

/**
 * Call Micro NLU - ultra-fast intent classification
 * ~200 tokens input, ~100 tokens output
 * 
 * NOTE: This call counts toward MAX_LLM_CALLS_PER_EVENT (10 max per user/minute)
 */
export async function callMicroNLU(
  message: string,
  conversationHistory?: string,
  userId?: string, // Optional user ID for rate limiting
): Promise<MicroNLUResult | null> {
  const startTime = Date.now();
  
  // Check call count if userId provided
  if (userId && !incrementCallCount(userId)) {
    logger.warn('🚫 Micro NLU: Max LLM calls reached', { userId });
    return null;
  }
  
  try {
    // Build prompt with message and recent history
    const historySnippet = conversationHistory 
      ? conversationHistory.split('\n').slice(-6).join('\n').substring(0, 500) // Last 3 turns, max 500 chars
      : 'tidak ada';
    
    const prompt = MICRO_PROMPT
      .replace('{message}', message.substring(0, 300)) // Max 300 chars message
      .replace('{history}', historySnippet);
    
    // Call LLM
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({ 
      model: MICRO_MODEL,
      generationConfig: {
        temperature: 0.1, // Very deterministic
        maxOutputTokens: 200,
      },
    });
    
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Track usage
    const usage = result.response.usageMetadata;
    if (usage) {
      modelStatsService.recordSuccess(MICRO_MODEL, Date.now() - startTime);
    }
    
    // Parse JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Micro NLU: no JSON found', { responseText: responseText.substring(0, 200) });
      return null;
    }
    
    const parsed = JSON.parse(jsonMatch[0]) as MicroNLUResult;
    
    const durationMs = Date.now() - startTime;
    logger.info('⚡ Micro NLU result', {
      action: parsed.action,
      topic: parsed.topic,
      is_emergency: parsed.is_emergency,
      confidence: parsed.confidence,
      durationMs,
      inputTokens: usage?.promptTokenCount,
      outputTokens: usage?.candidatesTokenCount,
    });
    
    return parsed;
    
  } catch (error: any) {
    logger.error('Micro NLU error', { error: error.message });
    return null;
  }
}

/**
 * Map Micro NLU result to full NLU intent
 * This bridges the gap between micro and full NLU
 */
export function mapMicroToIntent(micro: MicroNLUResult): string {
  switch (micro.action) {
    case 'GREETING': return 'GREETING';
    case 'THANKS': return 'THANKS';
    case 'CONFIRMATION': return 'CONFIRMATION';
    case 'ASK_CONTACT': return 'ASK_INFO'; // Handled by ASK_INFO with topic=kontak
    case 'ASK_INFO': return 'ASK_INFO';
    case 'CREATE_COMPLAINT': return 'CREATE_COMPLAINT';
    case 'CREATE_SERVICE': return 'CREATE_SERVICE';
    case 'CHECK_STATUS': return 'CHECK_STATUS';
    case 'CANCEL': return 'CANCEL';
    case 'HISTORY': return 'HISTORY';
    case 'CONTINUE_FLOW': return 'CONTINUE_FLOW';
    case 'UNCLEAR': return 'CLARIFY_NEEDED';
    default: return 'UNKNOWN';
  }
}

/**
 * Check if micro result indicates contact request
 */
export function isContactRequest(micro: MicroNLUResult): boolean {
  return micro.action === 'ASK_CONTACT' || 
    (micro.action === 'ASK_INFO' && /kontak|nomor|telepon|hp/i.test(micro.topic || ''));
}

/**
 * Check if micro result indicates complaint creation
 */
export function isComplaintRequest(micro: MicroNLUResult): boolean {
  return micro.action === 'CREATE_COMPLAINT';
}
