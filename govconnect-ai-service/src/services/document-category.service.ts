/**
 * Document Category Inference Service
 *
 * Uses a lightweight LLM call to infer the most appropriate category
 * for an uploaded document based on its content sample + title.
 *
 * Best-practice pipeline:
 *   1. Admin uploads document (PDF, DOCX, etc.)
 *   2. Text is extracted and a sample (~3000 chars) is sent here
 *   3. Micro-LLM analyzes and returns one of the predefined categories
 *   4. Category is stored with every chunk → improves filtered search recall
 *
 * This replaces the blind 'general' fallback that caused most document
 * chunks to be invisible to category-filtered RAG queries.
 */

import logger from '../utils/logger';
import { apiKeyManager, isRateLimitError } from './api-key-manager.service';
import { config } from '../config/env';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Predefined categories that align with the knowledge base categories
 * used in GovConnect. These match the categories in:
 *   - knowledge_vectors.category
 *   - NLU classifier output (nluCategories)
 *   - hybrid-search category filter
 */
const VALID_CATEGORIES = [
  'regulasi',       // Peraturan, undang-undang, perda, perbup
  'sop',            // Prosedur operasional standar
  'layanan',        // Info layanan publik, persyaratan, alur
  'kependudukan',   // KTP, KK, akta, pindah domisili
  'perizinan',      // Izin usaha, IMB, SIUP
  'infrastruktur',  // Jalan, jembatan, drainase, fasilitas umum
  'kesehatan',      // Puskesmas, posyandu, kesehatan masyarakat
  'pendidikan',     // Sekolah, beasiswa, pendidikan
  'sosial',         // Bantuan sosial, PKH, BPNT
  'keuangan',       // APBD, dana desa, anggaran
  'pertanian',      // Pertanian, peternakan, perikanan
  'lingkungan',     // Lingkungan, kebersihan, sampah
  'umum',           // Informasi umum desa/kelurahan
  'faq',            // Pertanyaan yang sering ditanyakan
  'custom',         // Kategori kustom (tidak cocok dengan lainnya)
  'general',        // Fallback
] as const;

type DocumentCategory = (typeof VALID_CATEGORIES)[number];

const INFERENCE_PROMPT = `Kamu adalah classifier dokumen untuk sistem layanan pemerintah desa/kelurahan (GovConnect).

Analisis teks dokumen berikut dan tentukan SATU kategori yang paling sesuai dari daftar ini:
${VALID_CATEGORIES.map(c => `- ${c}`).join('\n')}

Aturan:
- Pilih kategori yang PALING dominan dari isi dokumen
- Jika dokumen membahas prosedur/SOP, pilih "sop"
- Jika dokumen membahas peraturan/regulasi, pilih "regulasi"
- Jika dokumen membahas layanan publik (KTP, KK, surat), pilih "layanan" atau "kependudukan"
- Jika tidak jelas, pilih "umum"
- HANYA jawab dengan satu kata kategori, tanpa penjelasan

Judul dokumen: {title}

Cuplikan isi dokumen:
{content}

Kategori:`;

/**
 * Infer the best category for a document using micro-LLM
 *
 * @param contentSample - First ~3000 chars of extracted document text
 * @param title - Document title (filename or admin-provided title)
 * @returns Category string, or null if inference fails
 */
export async function inferDocumentCategories(
  contentSample: string,
  title: string,
): Promise<DocumentCategory | null> {
  const startTime = Date.now();

  try {
    const prompt = INFERENCE_PROMPT
      .replace('{title}', title)
      .replace('{content}', contentSample.substring(0, 3000));

    // Use cheapest model for this simple classification task
    const microModels = ['gemini-2.0-flash-lite', 'gemini-2.5-flash-lite'];
    const callPlan = apiKeyManager.getCallPlan(microModels, microModels);

    // Fallback to .env key if no BYOK keys available
    if (callPlan.length === 0 && config.geminiApiKey) {
      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      callPlan.push({
        key: { genAI, apiKey: config.geminiApiKey, keyName: 'env', keyId: null, isByok: false, tier: 'env' },
        model: 'gemini-2.0-flash-lite',
      });
    }

    if (callPlan.length === 0) {
      logger.warn('[DocCategory] No API keys available for category inference');
      return null;
    }

    for (const { key, model: modelName } of callPlan) {
      try {
        const geminiModel = key.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 20,
          },
        });

        const result = await Promise.race([
          geminiModel.generateContent(prompt),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Category inference timeout')), 10_000),
          ),
        ]);

        const responseText = result.response.text().trim().toLowerCase();

        // Record BYOK usage if applicable
        if (key.isByok && key.keyId) {
          const usage = result.response.usageMetadata;
          apiKeyManager.recordSuccess(key.keyId);
          apiKeyManager.recordUsage(key.keyId, modelName, usage?.promptTokenCount ?? 0, usage?.totalTokenCount ?? 0);
        }

        // Validate the response is one of our valid categories
        const category = VALID_CATEGORIES.find(c => responseText.includes(c));
        if (category) {
          logger.info('[DocCategory] Category inferred', {
            title,
            category,
            model: modelName,
            durationMs: Date.now() - startTime,
          });
          return category;
        }

        logger.warn('[DocCategory] LLM returned unknown category', { response: responseText });
        return 'umum'; // Safe fallback
      } catch (err: any) {
        if (isRateLimitError(err.message) && key.isByok && key.keyId) {
          apiKeyManager.recordRateLimit(key.keyId, modelName, key.tier);
        }
        logger.warn('[DocCategory] Inference attempt failed', {
          model: modelName,
          error: err.message,
        });
        continue;
      }
    }

    // All attempts failed
    logger.warn('[DocCategory] All inference attempts failed, defaulting to umum');
    return 'umum';
  } catch (error: any) {
    logger.error('[DocCategory] Category inference error', { error: error.message });
    return null;
  }
}
