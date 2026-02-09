/**
 * Micro LLM Resolver Service
 *
 * Uses a lightweight Gemini model to semantically match a user's kategori
 * string to the closest ComplaintType in the database.
 *
 * BYOK-aware: Uses API key rotation via AI service endpoint.
 * Falls back to .env GEMINI_API_KEY if BYOK not available.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';
import logger from '../utils/logger';

/** Max retries per model before switching */
const MAX_RETRIES_PER_MODEL = 2;

/** Model fallback order for paid tiers (includes 2.0 models) */
const MODEL_FALLBACK_ORDER = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
];

/** Model fallback order for free tier (no 2.0 models) */
const MODEL_FALLBACK_ORDER_FREE = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
];

interface ByokKey {
  id: string;
  api_key: string;
  name: string;
  tier: string;
  is_active: boolean;
  is_valid: boolean;
}

/** Cache of BYOK keys fetched from Dashboard API */
let byokKeysCache: ByokKey[] = [];
let byokLastFetch = 0;
const BYOK_CACHE_TTL_MS = 60_000;
let genAIInstances: Map<string, GoogleGenerativeAI> = new Map();

/**
 * Fetch BYOK keys from Dashboard API (cached for 60s).
 */
async function getByokKeys(): Promise<ByokKey[]> {
  if (Date.now() - byokLastFetch < BYOK_CACHE_TTL_MS && byokKeysCache.length > 0) {
    return byokKeysCache;
  }
  try {
    const dashboardUrl = process.env.DASHBOARD_SERVICE_URL || 'http://dashboard:3000';
    const resp = await fetch(`${dashboardUrl}/api/internal/gemini-keys`, {
      headers: { 'x-internal-api-key': config.internalApiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return byokKeysCache;
    const data = await resp.json() as { keys?: ByokKey[] };
    byokKeysCache = (data.keys || []).filter((k: ByokKey) => k.is_active && k.is_valid);
    byokLastFetch = Date.now();

    // Create GenAI instances
    for (const k of byokKeysCache) {
      if (!genAIInstances.has(k.id)) {
        genAIInstances.set(k.id, new GoogleGenerativeAI(k.api_key));
      }
    }
    return byokKeysCache;
  } catch {
    return byokKeysCache;
  }
}

// Env fallback
const envGenAI = config.geminiApiKey ? new GoogleGenerativeAI(config.geminiApiKey) : null;

export interface MicroLLMMatch {
  /** The matched type ID, or null if no match */
  matched_id: string | null;
  /** Confidence 0.0–1.0 */
  confidence: number;
  /** Short reason for the match */
  reason: string;
}

interface ComplaintTypeOption {
  id: string;
  name: string;
  category_name: string;
  is_urgent: boolean;
}

const RESOLVER_PROMPT = `Kamu adalah classifier kategori pengaduan masyarakat.

TUGAS:
Diberikan sebuah KATA KUNCI pengaduan dari user dan DAFTAR TIPE PENGADUAN yang tersedia di database.
Tentukan tipe pengaduan mana yang paling cocok dengan kata kunci user.

ATURAN:
- Pahami MAKNA dan KONTEKS kata user, bukan hanya kecocokan kata.
- User bisa pakai bahasa informal, singkatan, typo, bahasa daerah, atau slang.
- Jika tidak ada yang cocok sama sekali, kembalikan matched_id: null.
- Jangan memaksakan match jika memang tidak relevan.

OUTPUT (JSON saja, tanpa markdown):
{
  "matched_id": "id_tipe_yang_cocok atau null",
  "confidence": 0.0-1.0,
  "reason": "penjelasan singkat"
}

DAFTAR TIPE PENGADUAN:
{complaint_types}

KATA KUNCI PENGADUAN USER:
{kategori}`;

/**
 * Call the micro LLM to semantically resolve a kategori string to a complaint type.
 * Uses BYOK key rotation + model fallback. Returns null on total failure.
 */
export async function resolveWithMicroLLM(
  kategori: string,
  availableTypes: ComplaintTypeOption[]
): Promise<MicroLLMMatch | null> {
  if (!config.geminiApiKey && byokKeysCache.length === 0) {
    logger.warn('Micro LLM resolver skipped: no API keys configured');
    return null;
  }

  if (!availableTypes.length) return null;

  // Build the types list for the prompt
  const typesText = availableTypes
    .map(t => `- ID: "${t.id}" | Nama: "${t.name}" | Kategori: "${t.category_name}" | Urgent: ${t.is_urgent ? 'Ya' : 'Tidak'}`)
    .join('\n');

  const prompt = RESOLVER_PROMPT
    .replace('{complaint_types}', typesText)
    .replace('{kategori}', kategori);

  const byokKeys = await getByokKeys();

  // 1. Try BYOK keys first
  for (const bkey of byokKeys) {
    const genAI = genAIInstances.get(bkey.id);
    if (!genAI) continue;

    // Pick model list based on key tier (free has no 2.0 models)
    const models = config.microNluModels.length > 0
      ? config.microNluModels
      : (bkey.tier === 'free' ? MODEL_FALLBACK_ORDER_FREE : MODEL_FALLBACK_ORDER);

    for (const modelName of models) {
      for (let retry = 0; retry < MAX_RETRIES_PER_MODEL; retry++) {
        try {
          const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
          });

          const result = await model.generateContent(prompt);
          const responseText = result.response.text();
          const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const parsed = JSON.parse(cleaned) as MicroLLMMatch;

          if (typeof parsed.confidence !== 'number') throw new Error('Invalid confidence');

          if (parsed.matched_id) {
            const exists = availableTypes.some(t => t.id === parsed.matched_id);
            if (!exists) { parsed.matched_id = null; parsed.confidence = 0; }
          }

          logger.info('Micro LLM resolved complaint type', {
            kategori, matched_id: parsed.matched_id, confidence: parsed.confidence,
            model: modelName, keyName: bkey.name,
          });
          return parsed;
        } catch (error: any) {
          logger.warn('Micro LLM resolver failed', {
            model: modelName, keyName: bkey.name, retry: retry + 1, error: error.message,
          });
          if (error.message?.includes('API_KEY_INVALID') || error.message?.includes('401') ||
              error.message?.includes('404') || error.message?.includes('not found')) break;
        }
      }
    }
  }

  // 2. Fallback to .env key (use paid model order since .env is typically a paid key)
  if (envGenAI) {
    const envModels = config.microNluModels.length > 0 ? config.microNluModels : MODEL_FALLBACK_ORDER;

    for (const modelName of envModels) {
      for (let retry = 0; retry < MAX_RETRIES_PER_MODEL; retry++) {
        try {
          const model = envGenAI.getGenerativeModel({
            model: modelName,
            generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
          });

          const result = await model.generateContent(prompt);
          const responseText = result.response.text();
          const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const parsed = JSON.parse(cleaned) as MicroLLMMatch;

          if (typeof parsed.confidence !== 'number') throw new Error('Invalid confidence');

          if (parsed.matched_id) {
            const exists = availableTypes.some(t => t.id === parsed.matched_id);
            if (!exists) { parsed.matched_id = null; parsed.confidence = 0; }
          }

          logger.info('Micro LLM resolved complaint type (env fallback)', {
            kategori, matched_id: parsed.matched_id, confidence: parsed.confidence, model: modelName,
          });
          return parsed;
        } catch (error: any) {
          logger.warn('Micro LLM resolver failed (env fallback)', {
            model: modelName, retry: retry + 1, error: error.message,
          });
          if (error.message?.includes('404') || error.message?.includes('not found')) break;
        }
      }
    }
  }

  logger.error('All micro LLM models failed for complaint type resolution', { kategori });
  return null;
}
