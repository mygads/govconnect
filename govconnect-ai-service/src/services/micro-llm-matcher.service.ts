/**
 * Micro LLM Matcher Service
 *
 * Lightweight Gemini calls for semantic matching tasks:
 * - Complaint type resolution (kategori → ComplaintType)
 * - Service slug resolution (query → Service)
 *
 * Uses the cheapest/fastest models (flash-lite) with low token limits.
 * No hardcoded synonyms — AI handles all vocabulary understanding.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';
import logger from '../utils/logger';
import { extractAndRecord } from './token-usage.service';
import type { LayerType, CallType } from './token-usage.service';

// ---------- Model Priority ----------

const DEFAULT_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

function parseMicroModels(): string[] {
  const raw = (process.env.MICRO_NLU_MODELS || '').trim();
  if (!raw) return DEFAULT_MODELS;
  const models = raw.split(',').map(m => m.trim()).filter(Boolean);
  return models.length > 0 ? models : DEFAULT_MODELS;
}

const MICRO_MODELS = parseMicroModels();

// ---------- Generic micro LLM call ----------

async function callMicroLLM(
  prompt: string,
  call_type: CallType,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<string | null> {
  if (!config.geminiApiKey) {
    logger.warn('Micro LLM skipped: GEMINI_API_KEY not configured');
    return null;
  }

  for (const modelName of MICRO_MODELS) {
    try {
      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 300,
        },
      });

      const startMs = Date.now();
      const result = await model.generateContent(prompt);
      const durationMs = Date.now() - startMs;

      // Record token usage from actual Gemini usageMetadata
      extractAndRecord(result, modelName, 'micro_nlu' as LayerType, call_type, {
        ...context,
        success: true,
        duration_ms: durationMs,
      });

      return result.response.text();
    } catch (error: any) {
      logger.warn('Micro LLM model failed, trying next', {
        model: modelName,
        error: error.message,
      });
    }
  }

  logger.error('All micro LLM models failed');
  return null;
}

function parseJSON(raw: string): any | null {
  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ==================== COMPLAINT TYPE MATCHER ====================

const COMPLAINT_TYPE_PROMPT = `Kamu adalah classifier kategori pengaduan masyarakat Indonesia.

TUGAS:
Diberikan KATA KUNCI pengaduan dari user dan DAFTAR TIPE PENGADUAN yang tersedia.
Tentukan tipe mana yang paling cocok dengan kata kunci user.

ATURAN:
- Pahami MAKNA dan KONTEKS, bukan kecocokan kata literal.
- User bisa pakai bahasa informal, singkatan, typo, bahasa daerah, slang.
- Jika tidak ada yang cocok sama sekali, kembalikan matched_id: null.

OUTPUT (JSON saja, tanpa markdown):
{
  "matched_id": "id_tipe_yang_cocok atau null",
  "confidence": 0.0-1.0,
  "reason": "penjelasan singkat"
}

DAFTAR TIPE PENGADUAN:
{types_list}

KATA KUNCI USER:
{kategori}`;

export interface ComplaintTypeMatch {
  matched_id: string | null;
  confidence: number;
  reason: string;
}

export async function matchComplaintType(
  kategori: string,
  types: Array<{ id: string; name: string; categoryName: string }>,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<ComplaintTypeMatch | null> {
  if (!kategori || !types.length) return null;

  const typesList = types
    .map(t => `- ID: "${t.id}" | Tipe: "${t.name}" | Kategori: "${t.categoryName}"`)
    .join('\n');

  const prompt = COMPLAINT_TYPE_PROMPT
    .replace('{types_list}', typesList)
    .replace('{kategori}', kategori);

  const raw = await callMicroLLM(prompt, 'complaint_type_match', context);
  if (!raw) return null;

  const parsed = parseJSON(raw) as ComplaintTypeMatch | null;
  if (!parsed || typeof parsed.confidence !== 'number') return null;

  // Validate matched_id exists
  if (parsed.matched_id && !types.some(t => t.id === parsed.matched_id)) {
    logger.warn('Micro LLM returned unknown complaint type ID', {
      matched_id: parsed.matched_id,
      kategori,
    });
    return { matched_id: null, confidence: 0, reason: 'invalid_id' };
  }

  logger.info('Micro LLM matched complaint type', {
    kategori,
    matched_id: parsed.matched_id,
    confidence: parsed.confidence,
    reason: parsed.reason,
  });

  return parsed;
}

// ==================== SERVICE SLUG MATCHER ====================

const SERVICE_MATCH_PROMPT = `Kamu adalah classifier layanan pemerintah Indonesia.

TUGAS:
Diberikan QUERY permintaan layanan dari warga dan DAFTAR LAYANAN yang tersedia.
Tentukan layanan mana yang paling cocok dengan permintaan user.

ATURAN:
- Pahami MAKNA dan KONTEKS, bukan kecocokan kata literal.
- User bisa pakai singkatan (KTP, KK, SKU), bahasa informal, slang.
- Jika tidak ada yang cocok sama sekali, kembalikan matched_slug: null.

OUTPUT (JSON saja, tanpa markdown):
{
  "matched_slug": "slug_layanan atau null",
  "confidence": 0.0-1.0,
  "reason": "penjelasan singkat"
}

DAFTAR LAYANAN:
{services_list}

QUERY USER:
{query}`;

export interface ServiceMatch {
  matched_slug: string | null;
  confidence: number;
  reason: string;
}

export async function matchServiceSlug(
  query: string,
  services: Array<{ slug: string; name: string; description?: string }>,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<ServiceMatch | null> {
  if (!query || !services.length) return null;

  const servicesList = services
    .map(s => `- Slug: "${s.slug}" | Nama: "${s.name}"${s.description ? ` | Deskripsi: "${s.description}"` : ''}`)
    .join('\n');

  const prompt = SERVICE_MATCH_PROMPT
    .replace('{services_list}', servicesList)
    .replace('{query}', query);

  const raw = await callMicroLLM(prompt, 'service_slug_match', context);
  if (!raw) return null;

  const parsed = parseJSON(raw) as ServiceMatch | null;
  if (!parsed || typeof parsed.confidence !== 'number') return null;

  // Validate matched_slug exists
  if (parsed.matched_slug && !services.some(s => s.slug === parsed.matched_slug)) {
    logger.warn('Micro LLM returned unknown service slug', {
      matched_slug: parsed.matched_slug,
      query,
    });
    return { matched_slug: null, confidence: 0, reason: 'invalid_slug' };
  }

  logger.info('Micro LLM matched service', {
    query,
    matched_slug: parsed.matched_slug,
    confidence: parsed.confidence,
    reason: parsed.reason,
  });

  return parsed;
}
