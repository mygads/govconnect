/**
 * Micro LLM Resolver Service
 *
 * Uses a lightweight Gemini model to semantically match a user's kategori
 * string to the closest ComplaintType in the database.
 *
 * Why LLM instead of keyword/synonym matching:
 * - Users have unlimited vocabulary; hardcoded synonyms can never cover all cases
 * - LLM understands context, typos, slang, regional words naturally
 * - Scales with new complaint types without code changes
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';
import logger from '../utils/logger';

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
 * Tries each model in priority order. Returns null on total failure.
 */
export async function resolveWithMicroLLM(
  kategori: string,
  availableTypes: ComplaintTypeOption[]
): Promise<MicroLLMMatch | null> {
  if (!config.geminiApiKey) {
    logger.warn('Micro LLM resolver skipped: GEMINI_API_KEY not configured');
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

  for (const modelName of config.microNluModels) {
    try {
      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
        },
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      // Clean potential markdown wrapper
      const cleaned = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned) as MicroLLMMatch;

      // Validate the response
      if (typeof parsed.confidence !== 'number') {
        throw new Error('Invalid confidence value');
      }

      // Validate that matched_id actually exists in our list
      if (parsed.matched_id) {
        const exists = availableTypes.some(t => t.id === parsed.matched_id);
        if (!exists) {
          logger.warn('Micro LLM returned unknown type ID, discarding', {
            matched_id: parsed.matched_id,
            kategori,
            model: modelName,
          });
          parsed.matched_id = null;
          parsed.confidence = 0;
        }
      }

      logger.info('Micro LLM resolved complaint type', {
        kategori,
        matched_id: parsed.matched_id,
        confidence: parsed.confidence,
        reason: parsed.reason,
        model: modelName,
      });

      return parsed;
    } catch (error: any) {
      logger.warn('Micro LLM resolver failed, trying next model', {
        model: modelName,
        error: error.message,
        kategori,
      });
    }
  }

  logger.error('All micro LLM models failed for complaint type resolution', { kategori });
  return null;
}
