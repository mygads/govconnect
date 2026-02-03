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
    | 'GREETING'               // Salam biasa
    | 'THANKS'                 // Terima kasih
    | 'CONFIRMATION_YES'       // Ya/setuju/oke/mau
    | 'CONFIRMATION_NO'        // Tidak/batal/jangan
    | 'ASK_CONTACT'            // Minta nomor kontak/telepon
    | 'ASK_INFO'               // Tanya informasi umum
    | 'ASK_SERVICE_LIST'       // Tanya daftar layanan tersedia
    | 'ASK_COMPLAINT_CATEGORY' // Tanya kategori pengaduan
    | 'ASK_SERVICE_INFO'       // Tanya info/syarat layanan tertentu
    | 'CREATE_COMPLAINT'       // Mau lapor masalah
    | 'CHECK_COMPLAINT_STATUS' // Cek status pengaduan
    | 'CANCEL_COMPLAINT'       // Batalkan pengaduan
    | 'CREATE_SERVICE'         // Mau buat layanan
    | 'CHECK_SERVICE_STATUS'   // Cek status layanan
    | 'CANCEL_SERVICE'         // Batalkan layanan
    | 'CHECK_STATUS'           // Cek status (generic)
    | 'CANCEL'                 // Batalkan (generic)
    | 'HISTORY'                // Lihat riwayat
    | 'PROVIDE_NAME'           // User memberikan nama
    | 'PROVIDE_PHONE'          // User memberikan nomor HP
    | 'PROVIDE_ADDRESS'        // User memberikan alamat/lokasi
    | 'PROVIDE_TRACKING'       // User memberikan nomor tracking
    | 'UNCLEAR';               // Tidak jelas - perlu tanya balik
  
  // Is this urgent/emergency?
  is_emergency: boolean;
  
  // Topic/category being discussed
  topic?: string;  // e.g., "damkar", "puskesmas", "kebakaran", "jalan rusak"
  
  // Extracted data (if any) - LLM must extract all relevant data
  extracted_data?: {
    nama?: string;
    alamat?: string;
    no_hp?: string;
    tracking_number?: string;
    service_type?: string;
    complaint_type?: string;
  };
  
  // For clarification - pertanyaan untuk ditanyakan ke user
  clarification_question?: string;
  
  // Brief reasoning
  reasoning: string;
  
  // Confidence 0.0 - 1.0
  confidence: number;
}

// ==================== MICRO PROMPT ====================

const MICRO_PROMPT = `Kamu AI CERDAS asisten desa/kelurahan. Pahami MAKSUD user secara natural dan EKSTRAK semua data.

PESAN USER: "{message}"

RIWAYAT CHAT TERAKHIR:
{history}

## SUMBER DATA YANG TERSEDIA:
1. **Knowledge Base (RAG)** - Informasi umum desa (jam buka, prosedur, sejarah, dll)
2. **Database Layanan** - Layanan tersedia, syarat-syarat, status aktif/tidak, mode online/offline
3. **Database Pengaduan** - Kategori & jenis pengaduan, apakah butuh alamat, urgent, kirim nomor penting
4. **Nomor Penting** - Kontak darurat (Damkar, Ambulan, Polisi, Puskesmas, dll)
5. **Profil Desa** - Nama, alamat kantor, jam operasional, kontak resmi

## ACTIONS (pilih SATU yang paling tepat):
### Sapaan & Respon Dasar
- GREETING: salam (halo, hai, assalamualaikum, selamat pagi/siang/sore/malam)
- THANKS: terima kasih, makasih, thanks
- CONFIRMATION_YES: setuju/ya/iya/ok/oke/mau/boleh/siap/benar/betul/bersedia
- CONFIRMATION_NO: tidak/nggak/ga/batal/jangan/tidak mau/cancel/tidak jadi

### Permintaan Informasi
- ASK_CONTACT: minta nomor kontak/telepon (damkar, puskesmas, RT, ambulan, polisi, dll)
- ASK_INFO: tanya info umum (jam buka, alamat kantor, syarat layanan, biaya, prosedur, visi misi)
- ASK_SERVICE_LIST: tanya daftar layanan apa saja yang tersedia
- ASK_COMPLAINT_CATEGORY: tanya kategori pengaduan apa saja yang bisa dilaporkan

### Pengaduan/Laporan
- CREATE_COMPLAINT: mau LAPOR/ADUKAN masalah (jalan rusak, lampu mati, banjir, sampah, dll)
- CHECK_COMPLAINT_STATUS: cek status laporan/pengaduan (LAP-xxx)
- CANCEL_COMPLAINT: batalkan laporan/pengaduan

### Layanan Administrasi
- ASK_SERVICE_INFO: tanya INFO/SYARAT layanan tertentu (syarat KTP, biaya akta, dll)
- CREATE_SERVICE: mau BUAT/AJUKAN layanan (KTP, akta, surat keterangan, dll)
- CHECK_SERVICE_STATUS: cek status permohonan layanan (LAY-xxx)
- CANCEL_SERVICE: batalkan permohonan layanan

### Riwayat & Status
- HISTORY: lihat semua riwayat pengaduan & layanan saya
- CHECK_STATUS: cek status (bisa pengaduan atau layanan)

### User Memberikan Data
- PROVIDE_NAME: user memberikan NAMA lengkapnya
- PROVIDE_PHONE: user memberikan NOMOR HP/WhatsApp
- PROVIDE_ADDRESS: user memberikan ALAMAT/LOKASI kejadian
- PROVIDE_TRACKING: user memberikan nomor tracking (LAP-xxx atau LAY-xxx)

### Tidak Paham
- UNCLEAR: tidak paham maksud user (WAJIB tulis clarification_question!)

## EXTRACTED_DATA - WAJIB diisi jika ada dalam pesan:
- nama: nama lengkap orang
- no_hp: nomor HP/WhatsApp (08xxx, +62xxx)
- alamat: lokasi/alamat (jalan, RT/RW, patokan)
- tracking_number: nomor laporan/layanan (LAP-xxx, LAY-xxx)
- service_type: jenis layanan (KTP, akta kelahiran, surat pindah, SKTM, dll)
- complaint_type: jenis pengaduan (jalan rusak, banjir, lampu mati, sampah, dll)

## CARA MEMAHAMI - BACA RIWAYAT CHAT!
1. AI tanya "nama lengkap?" → user jawab → PROVIDE_NAME
2. AI tanya "nomor HP?" → user jawab → PROVIDE_PHONE  
3. AI tanya "lokasi kejadian?" → user jawab → PROVIDE_ADDRESS
4. AI tanya "ya/tidak?" → user jawab → CONFIRMATION_YES/NO
5. Ada LAP-xxx/LAY-xxx → extract ke tracking_number
6. Darurat (kebakaran, kecelakaan, banjir, sakit parah) → is_emergency=true

## CONTOH PEMAHAMAN:
- "halo" → GREETING
- "ada nomor damkar?" → ASK_CONTACT, topic="damkar"
- "jam buka kantor?" → ASK_INFO, topic="jam buka"
- "layanan apa saja?" → ASK_SERVICE_LIST
- "syarat bikin KTP apa?" → ASK_SERVICE_INFO, service_type="KTP"
- "mau bikin KTP" → CREATE_SERVICE, service_type="KTP"
- "ada jalan rusak di depan SD" → CREATE_COMPLAINT, complaint_type="jalan rusak", alamat="depan SD"
- "rumah saya kebakaran!" → ASK_CONTACT, topic="damkar", is_emergency=true
- "cek LAP-20260203-001" → CHECK_STATUS, tracking_number="LAP-20260203-001"
- "cek laporan terakhir saya" → CHECK_STATUS (tanpa tracking_number - sistem akan cari)
- "status pengaduan saya gimana?" → CHECK_STATUS (tanpa tracking_number - sistem akan cari)
- Riwayat: "AI: nama lengkap?" User: "Budi Santoso" → PROVIDE_NAME, nama="Budi Santoso"
- Tidak paham → UNCLEAR, clarification_question="Maaf, bisa diperjelas maksudnya?"

## LARANGAN:
- JANGAN menebak jika tidak yakin → gunakan UNCLEAR
- JANGAN abaikan riwayat chat
- JANGAN buat data palsu

OUTPUT JSON SAJA (tanpa markdown/code block):
{"action":"..","is_emergency":false,"topic":"..","extracted_data":{"nama":"","no_hp":"","alamat":"","tracking_number":"","service_type":"","complaint_type":""},"clarification_question":"","reasoning":"alasan singkat","confidence":0.0-1.0}`;

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
    // Basic responses
    case 'GREETING': return 'GREETING';
    case 'THANKS': return 'THANKS';
    case 'CONFIRMATION_YES': return 'CONFIRMATION_YES';
    case 'CONFIRMATION_NO': return 'CONFIRMATION_NO';
    
    // Information requests
    case 'ASK_CONTACT': return 'ASK_CONTACT';
    case 'ASK_INFO': return 'ASK_INFO';
    case 'ASK_SERVICE_LIST': return 'ASK_SERVICE_LIST';
    case 'ASK_COMPLAINT_CATEGORY': return 'ASK_COMPLAINT_CATEGORY';
    case 'ASK_SERVICE_INFO': return 'ASK_SERVICE_INFO';
    
    // Complaint actions
    case 'CREATE_COMPLAINT': return 'CREATE_COMPLAINT';
    case 'CHECK_COMPLAINT_STATUS': return 'CHECK_COMPLAINT_STATUS';
    case 'CANCEL_COMPLAINT': return 'CANCEL_COMPLAINT';
    
    // Service actions
    case 'CREATE_SERVICE': return 'CREATE_SERVICE';
    case 'CHECK_SERVICE_STATUS': return 'CHECK_SERVICE_STATUS';
    case 'CANCEL_SERVICE': return 'CANCEL_SERVICE';
    
    // Generic status/cancel (backward compatibility)
    case 'CHECK_STATUS': return 'CHECK_STATUS';
    case 'CANCEL': return 'CANCEL';
    case 'HISTORY': return 'HISTORY';
    
    // User providing data
    case 'PROVIDE_NAME': return 'PROVIDE_NAME';
    case 'PROVIDE_PHONE': return 'PROVIDE_PHONE';
    case 'PROVIDE_ADDRESS': return 'PROVIDE_ADDRESS';
    case 'PROVIDE_TRACKING': return 'CHECK_STATUS';
    
    // Unclear
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
