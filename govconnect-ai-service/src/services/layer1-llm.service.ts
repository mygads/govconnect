/**
 * Layer 1 LLM Service - Intent & Understanding Layer
 * 
 * Purpose: Focus on understanding user input and normalizing data
 * Uses smallest/cheapest models for cost efficiency
 * 
 * Responsibilities:
 * - Intent classification
 * - Typo correction & language normalization
 * - Data extraction (nama, NIK, alamat, etc.)
 * - Context understanding
 */

import logger from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';

// Layer 1 uses the smallest, cheapest models first
const LAYER1_MODEL_PRIORITY = [
  'gemini-2.0-flash-lite',    // Smallest, cheapest
  'gemini-2.5-flash-lite',    // Backup small model
  'gemini-2.0-flash',         // Fallback to regular if needed
];

export interface Layer1Input {
  message: string;
  wa_user_id: string;
  conversation_history?: string;
}

export interface Layer1Output {
  intent: 'CREATE_COMPLAINT' | 'CREATE_RESERVATION' | 'CHECK_STATUS' | 'CANCEL_COMPLAINT' | 'CANCEL_RESERVATION' | 'HISTORY' | 'KNOWLEDGE_QUERY' | 'QUESTION' | 'UNKNOWN';
  normalized_message: string;
  extracted_data: {
    nama_lengkap?: string;
    nik?: string;
    alamat?: string;
    no_hp?: string;
    keperluan?: string;
    service_code?: string;
    kategori?: string;
    deskripsi?: string;
    complaint_id?: string;
    reservation_id?: string;
    reservation_date?: string;
    reservation_time?: string;
    knowledge_category?: string;
  };
  confidence: number;
  needs_clarification: string[];
  processing_notes: string;
}

/**
 * Layer 1 System Prompt - Focused on Understanding & Extraction
 */
const LAYER1_SYSTEM_PROMPT = `Anda adalah Layer 1 AI - INTENT & UNDERSTANDING SPECIALIST.

TUGAS UTAMA:
1. KLASIFIKASI INTENT user
2. KOREKSI TYPO & normalisasi bahasa
3. EKSTRAKSI DATA dari pesan user
4. ANALISIS tingkat kepercayaan

ATURAN TYPO CORRECTION:
- srat → surat
- gw/gue/gua → saya  
- bsk → besok
- jln/jl → jalan
- gg → gang
- ga/gak/nggak/engga → tidak
- hlo/hai/hi → halo
- bikin → buat
- gimana/gmn → bagaimana

INTENT CLASSIFICATION:
- CREATE_COMPLAINT: lapor masalah (jalan rusak, lampu mati, sampah, dll)
- CREATE_RESERVATION: buat surat/layanan (SKD, SKTM, SPKTP, dll)
- CHECK_STATUS: cek status laporan/reservasi
- CANCEL_COMPLAINT/CANCEL_RESERVATION: batalkan
- HISTORY: riwayat/daftar laporan
- KNOWLEDGE_QUERY: tanya info (jam buka, syarat, alamat)
- QUESTION: greeting, terima kasih, pertanyaan umum
- UNKNOWN: tidak jelas

DATA EXTRACTION PATTERNS:
- Nama: "nama saya X", "gw X", "saya X"
- NIK: 16 digit angka
- Alamat: "tinggal di X", "alamat X", pola RT/RW, landmark
- No HP: 08xxx, 628xxx, +628xxx
- Service: SKD, SKTM, SPKTP, dll
- Kategori complaint: jalan_rusak, lampu_mati, sampah, dll

OUTPUT FORMAT (JSON):
{
  "intent": "CREATE_RESERVATION",
  "normalized_message": "halo kak, mau buat surat domisili, nama saya budi...",
  "extracted_data": {
    "nama_lengkap": "budi",
    "service_code": "SKD",
    "nik": "3201234567890123",
    "alamat": "jalan melati no 45 rt 03 rw 05",
    "no_hp": "081234567890",
    "keperluan": "buka rekening bank"
  },
  "confidence": 0.95,
  "needs_clarification": [],
  "processing_notes": "Complete data extracted successfully"
}

CONFIDENCE SCORING:
- 0.9-1.0: Sangat yakin (data lengkap, intent jelas)
- 0.7-0.89: Yakin (intent jelas, data sebagian)
- 0.5-0.69: Cukup yakin (intent jelas, data minimal)
- 0.3-0.49: Kurang yakin (intent tidak jelas)
- 0.0-0.29: Tidak yakin (perlu klarifikasi)

PESAN USER: {user_message}
HISTORY: {conversation_history}

Analisis dan berikan output JSON:`;

/**
 * Call Layer 1 LLM for intent understanding and data extraction
 */
export async function callLayer1LLM(input: Layer1Input): Promise<Layer1Output | null> {
  const startTime = Date.now();
  
  logger.info('🔍 Layer 1 LLM call started', {
    wa_user_id: input.wa_user_id,
    messageLength: input.message.length,
    models: LAYER1_MODEL_PRIORITY,
  });

  // Build prompt
  const prompt = LAYER1_SYSTEM_PROMPT
    .replace('{user_message}', input.message)
    .replace('{conversation_history}', input.conversation_history || 'Tidak ada history');

  // Try models in priority order (cheapest first)
  for (let i = 0; i < LAYER1_MODEL_PRIORITY.length; i++) {
    const model = LAYER1_MODEL_PRIORITY[i];
    
    try {
      logger.info('🔄 Layer 1 attempting model', {
        wa_user_id: input.wa_user_id,
        model,
        attempt: i + 1,
      });

      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      const geminiModel = genAI.getGenerativeModel({ 
        model,
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent extraction
          maxOutputTokens: 1000, // Smaller output for Layer 1
        }
      });

      const result = await geminiModel.generateContent(prompt);
      const responseText = result.response.text();
      
      // Parse JSON response
      let parsedResponse: Layer1Output;
      try {
        // Clean response (remove markdown code blocks if present)
        const cleanedResponse = responseText
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        
        parsedResponse = JSON.parse(cleanedResponse);
      } catch (parseError) {
        logger.warn('Layer 1 JSON parse failed, trying repair', {
          wa_user_id: input.wa_user_id,
          model,
          error: parseError,
        });
        
        // Try to repair JSON
        const repairedJson = repairLayer1JSON(responseText);
        if (repairedJson) {
          parsedResponse = repairedJson;
        } else {
          throw new Error('JSON parsing failed completely');
        }
      }

      // Validate response structure
      if (!parsedResponse.intent || !parsedResponse.normalized_message) {
        throw new Error('Invalid response structure');
      }

      // Normalize extracted_data field names (LLM sometimes returns different names)
      parsedResponse.extracted_data = normalizeExtractedData(parsedResponse.extracted_data);

      const durationMs = Date.now() - startTime;
      
      logger.info('✅ Layer 1 LLM success', {
        wa_user_id: input.wa_user_id,
        model,
        intent: parsedResponse.intent,
        confidence: parsedResponse.confidence,
        durationMs,
        extractedDataKeys: Object.keys(parsedResponse.extracted_data || {}),
      });

      return parsedResponse;
      
    } catch (error: any) {
      logger.warn('❌ Layer 1 model failed', {
        wa_user_id: input.wa_user_id,
        model,
        attempt: i + 1,
        error: error.message,
      });
      
      // If this is the last model, return null
      if (i === LAYER1_MODEL_PRIORITY.length - 1) {
        logger.error('🚨 All Layer 1 models failed', {
          wa_user_id: input.wa_user_id,
          totalAttempts: LAYER1_MODEL_PRIORITY.length,
        });
        return null;
      }
      
      // Continue to next model
      continue;
    }
  }

  return null;
}

/**
 * Repair malformed JSON from Layer 1 LLM
 */
function repairLayer1JSON(responseText: string): Layer1Output | null {
  try {
    // Common repairs
    let repaired = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/,\s*}/g, '}')  // Remove trailing commas
      .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
      .trim();

    // Try to find JSON object
    const jsonMatch = repaired.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      repaired = jsonMatch[0];
    }

    const parsed = JSON.parse(repaired);
    
    // Ensure required fields exist
    if (!parsed.intent) parsed.intent = 'UNKNOWN';
    if (!parsed.normalized_message) parsed.normalized_message = '';
    if (!parsed.extracted_data) parsed.extracted_data = {};
    if (typeof parsed.confidence !== 'number') parsed.confidence = 0.5;
    if (!Array.isArray(parsed.needs_clarification)) parsed.needs_clarification = [];
    if (!parsed.processing_notes) parsed.processing_notes = 'Auto-repaired response';

    return parsed as Layer1Output;
  } catch (error) {
    logger.error('Layer 1 JSON repair failed completely', { error });
    return null;
  }
}

/**
 * Apply typo corrections to message
 */
export function applyTypoCorrections(message: string): string {
  const typoCorrections: Record<string, string> = {
    // Document typos
    'srat': 'surat',
    'surat': 'surat', // keep correct
    'domisili': 'domisili', // already correct
    'keterangan': 'keterangan', // keep correct
    'sktm': 'SKTM',
    'skd': 'SKD',
    
    // Informal language
    'gw': 'saya',
    'gue': 'saya', 
    'gua': 'saya',
    'aku': 'saya',
    'w': 'saya', // single letter
    
    // Time expressions
    'bsk': 'besok',
    'besok': 'besok', // keep correct
    'lusa': 'lusa', // keep correct
    
    // Location/address
    'jln': 'jalan',
    'jl': 'jalan',
    'gg': 'gang',
    'rt': 'RT',
    'rw': 'RW',
    
    // Greetings
    'hlo': 'halo',
    'hai': 'halo',
    'hi': 'halo',
    'hello': 'halo',
    
    // Common words
    'mau': 'mau', // keep correct
    'pengen': 'ingin',
    'butuh': 'perlu',
    'bikin': 'buat',
    'gimana': 'bagaimana',
    'gmn': 'bagaimana',
    'bisa': 'bisa', // keep correct
    
    // Negation
    'ga': 'tidak',
    'gak': 'tidak',
    'nggak': 'tidak',
    'engga': 'tidak',
    'enggak': 'tidak',
    
    // Politeness
    'kak': 'kak', // keep correct
    'bang': 'bang', // keep correct
    'pak': 'pak', // keep correct
    
    // Common typos
    'nih': 'nih', // keep correct
    'dong': 'dong', // keep correct
    'ya': 'ya', // keep correct
    'iya': 'iya', // keep correct
    'ok': 'oke',
    'okay': 'oke',
  };

  let corrected = message;
  
  // Apply typo corrections (word boundaries to avoid partial matches)
  for (const [typo, correct] of Object.entries(typoCorrections)) {
    const regex = new RegExp(`\\b${typo}\\b`, 'gi');
    corrected = corrected.replace(regex, correct);
  }
  
  return corrected;
}


/**
 * Normalize extracted_data field names
 * LLM sometimes returns different field names (e.g., kategori_complaint instead of kategori)
 */
function normalizeExtractedData(data: any): Layer1Output['extracted_data'] {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const normalized: Layer1Output['extracted_data'] = {};

  // Field name mappings (LLM variant -> standard name)
  const fieldMappings: Record<string, keyof Layer1Output['extracted_data']> = {
    // Kategori variants
    'kategori_complaint': 'kategori',
    'kategori_laporan': 'kategori',
    'jenis_laporan': 'kategori',
    'jenis_masalah': 'kategori',
    'tipe_laporan': 'kategori',
    'kategori': 'kategori',
    
    // Deskripsi variants
    'deskripsi_masalah': 'deskripsi',
    'detail_masalah': 'deskripsi',
    'keterangan': 'deskripsi',
    'deskripsi': 'deskripsi',
    
    // Alamat variants
    'alamat_lengkap': 'alamat',
    'lokasi': 'alamat',
    'alamat': 'alamat',
    
    // Nama variants
    'nama': 'nama_lengkap',
    'nama_lengkap': 'nama_lengkap',
    
    // NIK variants
    'nik': 'nik',
    'no_ktp': 'nik',
    'nomor_ktp': 'nik',
    
    // No HP variants
    'no_hp': 'no_hp',
    'nomor_hp': 'no_hp',
    'no_telepon': 'no_hp',
    'telepon': 'no_hp',
    
    // Service code variants
    'service_code': 'service_code',
    'kode_layanan': 'service_code',
    'jenis_surat': 'service_code',
    
    // Keperluan variants
    'keperluan': 'keperluan',
    'tujuan': 'keperluan',
    
    // ID variants
    'complaint_id': 'complaint_id',
    'id_laporan': 'complaint_id',
    'nomor_laporan': 'complaint_id',
    'reservation_id': 'reservation_id',
    'id_reservasi': 'reservation_id',
    'nomor_reservasi': 'reservation_id',
    
    // Date/time variants
    'reservation_date': 'reservation_date',
    'tanggal_reservasi': 'reservation_date',
    'tanggal': 'reservation_date',
    'reservation_time': 'reservation_time',
    'jam_reservasi': 'reservation_time',
    'jam': 'reservation_time',
    
    // Knowledge category
    'knowledge_category': 'knowledge_category',
    'kategori_pertanyaan': 'knowledge_category',
  };

  // Process each field in the data
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === '') continue;
    
    const normalizedKey = fieldMappings[key.toLowerCase()];
    if (normalizedKey) {
      normalized[normalizedKey] = value as string;
    } else {
      // Keep unknown fields as-is (might be useful)
      (normalized as any)[key] = value;
    }
  }

  return normalized;
}
