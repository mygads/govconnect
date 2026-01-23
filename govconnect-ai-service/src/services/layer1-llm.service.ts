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
import { modelStatsService } from './model-stats.service';

// Layer 1 uses the smallest, cheapest models first.
// Override via ENV (comma-separated): LAYER1_MODELS=gemini-2.0-flash-lite,gemini-2.5-flash-lite
const DEFAULT_LAYER1_MODEL_PRIORITY = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

const LAYER1_ALLOWED_MODELS = new Set([
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
]);

function parseModelListEnv(envValue: string | undefined, fallback: string[]): string[] {
  const raw = (envValue || '').trim();
  if (!raw) return fallback;

  const models = raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const unique: string[] = [];
  for (const model of models) {
    if (!LAYER1_ALLOWED_MODELS.has(model)) continue;
    if (!unique.includes(model)) unique.push(model);
  }

  return unique.length > 0 ? unique : fallback;
}

const LAYER1_MODEL_PRIORITY = parseModelListEnv(process.env.LAYER1_MODELS, DEFAULT_LAYER1_MODEL_PRIORITY);

export interface Layer1Input {
  message: string;
  wa_user_id: string;
  conversation_history?: string;
  pre_extracted_data?: Record<string, any>; // Data from entity-extractor
}

export interface Layer1Output {
  intent: 'CREATE_COMPLAINT' | 'UPDATE_COMPLAINT' | 'SERVICE_INFO' | 'CREATE_SERVICE_REQUEST' | 'UPDATE_SERVICE_REQUEST' | 'CHECK_STATUS' | 'CANCEL_COMPLAINT' | 'CANCEL_SERVICE_REQUEST' | 'HISTORY' | 'KNOWLEDGE_QUERY' | 'QUESTION' | 'UNKNOWN';
  normalized_message: string;
  extracted_data: {
    nama_lengkap?: string;
    nik?: string;
    alamat?: string;
    no_hp?: string;
    keperluan?: string;
    service_id?: string;
    service_slug?: string;
    kategori?: string;
    deskripsi?: string;
    rt_rw?: string;
    complaint_id?: string;
    request_number?: string;
    knowledge_category?: string;
  };
  confidence: number;
  needs_clarification: string[];
  processing_notes: string;
}

/**
 * Layer 1 System Prompt - OPTIMIZED VERSION
 * Focused on Intent Classification & Data Validation
 * 
 * CHANGES FROM ORIGINAL:
 * - Removed typo correction rules (handled by applyTypoCorrections function)
 * - Removed detailed extraction patterns (handled by entity-extractor service)
 * - Simplified to focus on intent classification and validation
 * - Reduced from ~130 lines to ~50 lines (62% reduction)
 */
const LAYER1_SYSTEM_PROMPT = `You are Layer 1 AI - INTENT CLASSIFIER & DATA VALIDATOR.

PRIMARY TASKS:
1. Classify user intent (12 types)
2. Validate pre-extracted data
3. Calculate confidence score

INTENT TYPES:
- CREATE_COMPLAINT: report issues (broken road, dead lights, trash, etc)
- UPDATE_COMPLAINT: update complaint details (alamat/deskripsi/rt_rw)
- SERVICE_INFO: ask about service requirements/procedures
- CREATE_SERVICE_REQUEST: request a service/form link
- UPDATE_SERVICE_REQUEST: request edit link for a service request
- CHECK_STATUS: check complaint/service request status
- CANCEL_COMPLAINT: cancel complaint
- CANCEL_SERVICE_REQUEST: cancel service request
- HISTORY: view history
- KNOWLEDGE_QUERY: ask info (hours, requirements, address)
- QUESTION: greeting, thanks, general questions
- UNKNOWN: unclear

CONFIDENCE SCORING:
- 0.9-1.0: Very confident (complete data, clear intent)
- 0.7-0.89: Confident (clear intent, partial data)
- 0.5-0.69: Moderate (clear intent, minimal data)
- 0.3-0.49: Low confidence (unclear intent)
- 0.0-0.29: Very low (needs clarification)

INPUT:
User Message: {user_message}
History: {conversation_history}
Pre-extracted Data: {pre_extracted_data}

OUTPUT (JSON):
{
  "intent": "CREATE_SERVICE_REQUEST",
  "normalized_message": "normalized user message",
  "extracted_data": {
    "nama_lengkap": "from pre-extraction or history",
    "nik": "from pre-extraction or history",
    "alamat": "COMPLETE address from pre-extraction or history",
    "no_hp": "from pre-extraction or history",
    "service_slug": "surat-domisili",
    "kategori": "jalan_rusak/lampu_mati/etc"
  },
  "confidence": 0.95,
  "needs_clarification": ["field1", "field2"],
  "processing_notes": "Brief note"
}

CRITICAL: Fill extracted_data with ALL available data from pre-extraction and history. Don't leave fields empty if data exists!

Analyze and return JSON:`;

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

  // Build prompt with pre-extracted data
  const preExtractedStr = input.pre_extracted_data 
    ? JSON.stringify(input.pre_extracted_data, null, 2)
    : 'No pre-extracted data';
  
  const prompt = LAYER1_SYSTEM_PROMPT
    .replace('{user_message}', input.message)
    .replace('{conversation_history}', input.conversation_history || 'No history')
    .replace('{pre_extracted_data}', preExtractedStr);

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
      
      // Record success in model stats
      modelStatsService.recordSuccess(model, durationMs);
      
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
      const durationMs = Date.now() - startTime;
      
      // Record failure in model stats
      modelStatsService.recordFailure(model, error.message, durationMs);
      
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
 * Re-exported from text-normalizer.service.ts for backward compatibility
 */
export { applyTypoCorrections } from './text-normalizer.service';


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
    
    // Service variants
    'service_id': 'service_id',
    'service_slug': 'service_slug',
    'service_code': 'service_slug',
    'kode_layanan': 'service_slug',
    'jenis_surat': 'service_slug',
    'nama_layanan': 'service_slug',
    
    // Keperluan variants
    'keperluan': 'keperluan',
    'tujuan': 'keperluan',
    
    // ID variants
    'complaint_id': 'complaint_id',
    'id_laporan': 'complaint_id',
    'nomor_laporan': 'complaint_id',
    'request_number': 'request_number',
    'id_layanan': 'request_number',
    'nomor_layanan': 'request_number',
    
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
