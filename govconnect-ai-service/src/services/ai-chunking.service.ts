/**
 * AI-Driven Smart Chunking Service
 *
 * Uses LLM to intelligently split documents into semantic chunks.
 * Instead of splitting by character count or paragraph boundaries,
 * the AI reads the entire document and decides:
 *   1. Where to split (by topic/context, not by size)
 *   2. What title each chunk should have
 *   3. What category each chunk belongs to
 *
 * Approach (paragraph-numbering for token efficiency):
 *   1. Split document text into numbered paragraphs
 *   2. Send numbered paragraphs to LLM
 *   3. LLM returns paragraph groupings + title + category per chunk
 *   4. Reconstruct actual text from paragraph numbers
 *   5. Generate embeddings with title-prepended input
 *
 * For large documents (>150 paragraphs), processes in overlapping batches.
 * Falls back to semantic chunking if AI fails.
 */

import logger from '../utils/logger';
import { apiKeyManager, isRateLimitError } from './api-key-manager.service';
import { config } from '../config/env';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ==================== TYPES ====================

export interface SmartChunk {
  /** AI-assigned descriptive title for this chunk */
  title: string;
  /** AI-assigned category from predefined list */
  category: string;
  /** Actual text content of the chunk */
  content: string;
  /** 1-based paragraph range for debugging */
  paragraphRange: [number, number];
}

interface ChunkDefinition {
  paragraphs: number[];
  title: string;
  category: string;
}

// ==================== CONSTANTS ====================

const VALID_CATEGORIES = [
  'regulasi', 'sop', 'layanan', 'kependudukan', 'perizinan',
  'infrastruktur', 'kesehatan', 'pendidikan', 'sosial', 'keuangan',
  'pertanian', 'lingkungan', 'umum', 'faq', 'custom',
] as const;

/** Max paragraphs per LLM call to stay within context window */
const MAX_PARAGRAPHS_PER_BATCH = 150;

/** Overlap paragraphs between batches for context continuity */
const BATCH_OVERLAP = 10;

/** Min paragraph length to keep (skip empty/trivial lines) */
const MIN_PARAGRAPH_LENGTH = 10;

// ==================== PROMPT ====================

function buildChunkingPrompt(
  numberedParagraphs: string,
  documentTitle: string,
  totalParagraphs: number,
): string {
  return `Kamu adalah document analyzer untuk sistem layanan pemerintah desa/kelurahan (GovConnect).

TUGAS: Baca seluruh dokumen berikut dan pecah menjadi beberapa chunks yang OPTIMAL untuk pencarian RAG (Retrieval-Augmented Generation).

ATURAN CHUNKING:
1. Setiap chunk harus berisi SATU topik/konteks yang UTUH dan bisa dipahami sendiri
2. JANGAN memotong di tengah penjelasan yang masih berlanjut
3. Paragraf yang membahas topik yang SAMA HARUS dalam chunk yang SAMA
4. Jika satu topik sangat panjang (>20 paragraf), boleh dipecah ASALKAN setiap pecahan tetap bisa dipahami
5. Paragraf pendek yang berkaitan (seperti sub-point, langkah prosedur) harus DIGABUNG dalam 1 chunk
6. MINIMAL 2 paragraf per chunk (jangan 1 paragraf = 1 chunk kecuali topiknya benar-benar berbeda)

ATURAN TITLE:
- Beri JUDUL deskriptif yang menjelaskan ISI chunk secara spesifik
- Contoh BAGUS: "Prosedur Pembuatan KTP Baru", "Jam Operasional Kantor Desa", "Syarat Pindah Domisili"
- Contoh BURUK: "Bagian 1", "Informasi", "Data"

KATEGORI YANG TERSEDIA:
${VALID_CATEGORIES.map(c => `- ${c}`).join('\n')}

Pilih "custom" jika tidak cocok dengan kategori lainnya.

JUDUL DOKUMEN: "${documentTitle}"
TOTAL PARAGRAF: ${totalParagraphs}

ISI DOKUMEN (paragraf bernomor):
${numberedParagraphs}

JAWAB HANYA dalam format JSON array (tanpa markdown code block, tanpa penjelasan tambahan):
[
  {"paragraphs": [1, 2, 3], "title": "Judul Deskriptif Chunk", "category": "kategori"},
  {"paragraphs": [4, 5, 6, 7], "title": "Judul Deskriptif Lain", "category": "kategori"}
]

PENTING:
- Setiap nomor paragraf (1 sampai ${totalParagraphs}) HARUS muncul tepat di SATU chunk
- Paragraf harus berurutan dalam setiap chunk (contoh: [3,4,5] bukan [3,5,7])
- Tidak boleh ada paragraf yang terlewat atau duplikat`;
}

// ==================== KNOWLEDGE TEXT PROMPT ====================

function buildKnowledgeChunkingPrompt(
  numberedParagraphs: string,
  knowledgeTitle: string,
  totalParagraphs: number,
): string {
  return `Kamu adalah knowledge base analyzer untuk sistem layanan pemerintah desa/kelurahan (GovConnect).

TUGAS: Baca teks berikut dan pecah menjadi beberapa chunks knowledge base yang optimal untuk pencarian RAG.

Teks ini adalah entri knowledge base dengan judul "${knowledgeTitle}".

ATURAN CHUNKING:
1. Setiap chunk harus berisi SATU topik/informasi yang UTUH
2. JANGAN memotong di tengah penjelasan
3. Informasi yang saling berkaitan harus dalam 1 chunk
4. Jika semua teks membahas 1 topik saja, cukup buat 1 chunk
5. Beri judul yang SPESIFIK dan DESKRIPTIF untuk setiap chunk

KATEGORI YANG TERSEDIA:
${VALID_CATEGORIES.map(c => `- ${c}`).join('\n')}

TOTAL PARAGRAF: ${totalParagraphs}

ISI TEKS (paragraf bernomor):
${numberedParagraphs}

JAWAB HANYA dalam format JSON array:
[
  {"paragraphs": [1, 2, 3], "title": "Judul Deskriptif", "category": "kategori"}
]

Setiap nomor paragraf (1-${totalParagraphs}) HARUS muncul tepat di SATU chunk.
Paragraf harus berurutan dalam setiap chunk.`;
}

// ==================== CORE FUNCTIONS ====================

/**
 * Split text into paragraphs (non-empty, meaningful)
 */
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/) // Split by double newline (paragraph boundary)
    .map(p => p.trim())
    .filter(p => p.length >= MIN_PARAGRAPH_LENGTH);
}

/**
 * Format paragraphs as numbered list for LLM
 */
function formatNumberedParagraphs(paragraphs: string[]): string {
  return paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');
}

/**
 * Call LLM for intelligent chunking
 */
async function callLLMForChunking(
  prompt: string,
  timeout: number = 60_000,
): Promise<ChunkDefinition[]> {
  // Use flash model for smart chunking (needs to be smart enough)
  const preferredModels = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  const fallbackModels = ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite'];
  const callPlan = apiKeyManager.getCallPlan(preferredModels, fallbackModels);

  // Fallback to .env key
  if (callPlan.length === 0 && config.geminiApiKey) {
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    callPlan.push({
      key: { genAI, apiKey: config.geminiApiKey, keyName: 'env', keyId: null, isByok: false, tier: 'env' },
      model: 'gemini-2.0-flash',
    });
  }

  if (callPlan.length === 0) {
    throw new Error('No API keys available for AI chunking');
  }

  for (const { key, model: modelName } of callPlan) {
    try {
      const geminiModel = key.genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent structured output
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
        },
      });

      const result = await Promise.race([
        geminiModel.generateContent(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AI chunking timeout')), timeout),
        ),
      ]);

      const responseText = result.response.text().trim();

      // Record BYOK usage
      if (key.isByok && key.keyId) {
        const usage = result.response.usageMetadata;
        apiKeyManager.recordSuccess(key.keyId);
        apiKeyManager.recordUsage(
          key.keyId, modelName,
          usage?.promptTokenCount ?? 0,
          usage?.totalTokenCount ?? 0,
        );
      }

      // Parse JSON response
      const parsed = JSON.parse(responseText);

      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('LLM returned empty or non-array response');
      }

      // Validate and normalize chunk definitions
      const validated: ChunkDefinition[] = parsed.map((def: any, idx: number) => {
        if (!def.paragraphs || !Array.isArray(def.paragraphs) || def.paragraphs.length === 0) {
          throw new Error(`Chunk ${idx} has no paragraphs`);
        }
        if (!def.title || typeof def.title !== 'string') {
          throw new Error(`Chunk ${idx} has no title`);
        }

        // Normalize category
        const rawCategory = (def.category || 'custom').toLowerCase().trim();
        const category = VALID_CATEGORIES.includes(rawCategory as any) ? rawCategory : 'custom';

        return {
          paragraphs: def.paragraphs.map((n: any) => Number(n)),
          title: def.title.trim(),
          category,
        };
      });

      logger.info('[SmartChunk] LLM chunking succeeded', {
        model: modelName,
        chunksReturned: validated.length,
      });

      return validated;

    } catch (err: any) {
      if (isRateLimitError(err.message) && key.isByok && key.keyId) {
        apiKeyManager.recordRateLimit(key.keyId, modelName, key.tier);
      }
      logger.warn('[SmartChunk] LLM attempt failed', {
        model: modelName,
        error: err.message,
      });
      continue;
    }
  }

  throw new Error('All LLM attempts failed for AI chunking');
}

/**
 * Reconstruct actual text chunks from paragraph numbers
 */
function reconstructChunks(
  paragraphs: string[],
  chunkDefs: ChunkDefinition[],
): SmartChunk[] {
  return chunkDefs.map(def => {
    // Sort paragraph numbers and extract content
    const sorted = [...def.paragraphs].sort((a, b) => a - b);
    const content = sorted
      .map(n => paragraphs[n - 1]) // 1-based to 0-based
      .filter(Boolean)
      .join('\n\n');

    return {
      title: def.title,
      category: def.category,
      content,
      paragraphRange: [sorted[0], sorted[sorted.length - 1]] as [number, number],
    };
  }).filter(chunk => chunk.content.length > 0);
}

/**
 * Validate that all paragraphs are covered and none are duplicated
 */
function validateCoverage(
  chunkDefs: ChunkDefinition[],
  totalParagraphs: number,
): ChunkDefinition[] {
  const seen = new Set<number>();
  const validated: ChunkDefinition[] = [];

  for (const def of chunkDefs) {
    // Remove duplicate paragraph references
    const uniqueParas = def.paragraphs.filter(n => {
      if (n < 1 || n > totalParagraphs || seen.has(n)) return false;
      seen.add(n);
      return true;
    });

    if (uniqueParas.length > 0) {
      validated.push({ ...def, paragraphs: uniqueParas });
    }
  }

  // Check for uncovered paragraphs and create a catch-all chunk if needed
  const uncovered: number[] = [];
  for (let i = 1; i <= totalParagraphs; i++) {
    if (!seen.has(i)) uncovered.push(i);
  }

  if (uncovered.length > 0) {
    logger.warn('[SmartChunk] Some paragraphs were not assigned to any chunk', {
      uncovered: uncovered.length,
      total: totalParagraphs,
    });

    // Group consecutive uncovered paragraphs into chunks
    let group: number[] = [uncovered[0]];
    for (let i = 1; i < uncovered.length; i++) {
      if (uncovered[i] === uncovered[i - 1] + 1) {
        group.push(uncovered[i]);
      } else {
        validated.push({
          paragraphs: group,
          title: 'Informasi Tambahan',
          category: 'umum',
        });
        group = [uncovered[i]];
      }
    }
    validated.push({
      paragraphs: group,
      title: 'Informasi Tambahan',
      category: 'umum',
    });
  }

  return validated;
}

// ==================== PUBLIC API ====================

/**
 * Smart-chunk a document using AI
 *
 * The AI reads the entire document and decides:
 * - How to split it into chunks (by topic/context)
 * - What title each chunk should have
 * - What category each chunk belongs to
 *
 * For large documents (>150 paragraphs), processes in overlapping batches.
 *
 * @param fullText - Full extracted text of the document
 * @param documentTitle - Title of the document (filename or admin-provided)
 * @returns Array of SmartChunk with AI-assigned title, category, and content
 */
export async function smartChunkDocument(
  fullText: string,
  documentTitle: string,
): Promise<SmartChunk[]> {
  const startTime = Date.now();

  // Step 1: Split into paragraphs
  const paragraphs = splitIntoParagraphs(fullText);

  if (paragraphs.length === 0) {
    logger.warn('[SmartChunk] No paragraphs found in document', { documentTitle });
    return [];
  }

  // Very short document (1-2 paragraphs): single chunk, still ask AI for title+category
  if (paragraphs.length <= 2) {
    return await smartChunkShortDocument(paragraphs, documentTitle);
  }

  logger.info('[SmartChunk] Starting AI-driven chunking', {
    documentTitle,
    paragraphs: paragraphs.length,
    totalChars: fullText.length,
  });

  let chunkDefs: ChunkDefinition[];

  if (paragraphs.length <= MAX_PARAGRAPHS_PER_BATCH) {
    // Small/medium document: single LLM call
    const numbered = formatNumberedParagraphs(paragraphs);
    const prompt = buildChunkingPrompt(numbered, documentTitle, paragraphs.length);
    chunkDefs = await callLLMForChunking(prompt);
  } else {
    // Large document: process in overlapping batches
    chunkDefs = await batchChunkDocument(paragraphs, documentTitle);
  }

  // Validate coverage
  const validated = validateCoverage(chunkDefs, paragraphs.length);

  // Reconstruct actual text
  const chunks = reconstructChunks(paragraphs, validated);

  const durationMs = Date.now() - startTime;
  logger.info('[SmartChunk] AI chunking completed', {
    documentTitle,
    totalParagraphs: paragraphs.length,
    chunksCreated: chunks.length,
    durationMs,
  });

  return chunks;
}

/**
 * Smart-chunk a knowledge base text entry using AI
 *
 * Similar to smartChunkDocument but uses a knowledge-specific prompt.
 * Only chunks if content is long enough to warrant splitting.
 *
 * @param content - Knowledge entry content
 * @param title - Knowledge entry title
 * @returns Array of SmartChunk (may be single chunk if content is short)
 */
export async function smartChunkKnowledge(
  content: string,
  title: string,
): Promise<SmartChunk[]> {
  const paragraphs = splitIntoParagraphs(content);

  if (paragraphs.length === 0) {
    return [];
  }

  // Short text: single chunk, ask AI for title+category only
  if (paragraphs.length <= 3) {
    return await smartChunkShortDocument(paragraphs, title);
  }

  logger.info('[SmartChunk] Chunking knowledge entry', {
    title,
    paragraphs: paragraphs.length,
  });

  const numbered = formatNumberedParagraphs(paragraphs);
  const prompt = buildKnowledgeChunkingPrompt(numbered, title, paragraphs.length);

  try {
    const chunkDefs = await callLLMForChunking(prompt, 30_000);
    const validated = validateCoverage(chunkDefs, paragraphs.length);
    return reconstructChunks(paragraphs, validated);
  } catch (err: any) {
    logger.warn('[SmartChunk] Knowledge chunking failed, using single chunk', {
      title,
      error: err.message,
    });
    // Fallback: return entire content as single chunk
    return [{
      title,
      category: 'custom',
      content: paragraphs.join('\n\n'),
      paragraphRange: [1, paragraphs.length],
    }];
  }
}

/**
 * Handle very short documents (1-2 paragraphs)
 * Still calls AI for title and category assignment
 */
async function smartChunkShortDocument(
  paragraphs: string[],
  documentTitle: string,
): Promise<SmartChunk[]> {
  const content = paragraphs.join('\n\n');

  // Quick AI call just for title + category
  try {
    const prompt = `Kamu adalah classifier untuk sistem GovConnect.

Berikan JUDUL deskriptif dan KATEGORI untuk teks berikut.

Judul dokumen: "${documentTitle}"

Teks:
${content.substring(0, 3000)}

KATEGORI: ${VALID_CATEGORIES.join(', ')}

Jawab HANYA JSON (tanpa markdown):
{"title": "Judul Deskriptif", "category": "kategori"}`;

    const microModels = ['gemini-2.0-flash-lite', 'gemini-2.5-flash-lite'];
    const callPlan = apiKeyManager.getCallPlan(microModels, microModels);

    if (callPlan.length === 0 && config.geminiApiKey) {
      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      callPlan.push({
        key: { genAI, apiKey: config.geminiApiKey, keyName: 'env', keyId: null, isByok: false, tier: 'env' },
        model: 'gemini-2.0-flash-lite',
      });
    }

    for (const { key, model: modelName } of callPlan) {
      try {
        const geminiModel = key.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json' },
        });

        const result = await Promise.race([
          geminiModel.generateContent(prompt),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 10_000),
          ),
        ]);

        if (key.isByok && key.keyId) {
          const usage = result.response.usageMetadata;
          apiKeyManager.recordSuccess(key.keyId);
          apiKeyManager.recordUsage(key.keyId, modelName, usage?.promptTokenCount ?? 0, usage?.totalTokenCount ?? 0);
        }

        const parsed = JSON.parse(result.response.text().trim());
        const rawCat = (parsed.category || 'custom').toLowerCase().trim();
        const category = VALID_CATEGORIES.includes(rawCat as any) ? rawCat : 'custom';

        return [{
          title: parsed.title || documentTitle,
          category,
          content,
          paragraphRange: [1, paragraphs.length] as [number, number],
        }];
      } catch {
        continue;
      }
    }
  } catch {
    // Fallback
  }

  return [{
    title: documentTitle,
    category: 'custom',
    content,
    paragraphRange: [1, paragraphs.length] as [number, number],
  }];
}

/**
 * Process large documents in overlapping batches
 */
async function batchChunkDocument(
  paragraphs: string[],
  documentTitle: string,
): Promise<ChunkDefinition[]> {
  const allChunkDefs: ChunkDefinition[] = [];
  const totalBatches = Math.ceil(paragraphs.length / (MAX_PARAGRAPHS_PER_BATCH - BATCH_OVERLAP));

  logger.info('[SmartChunk] Processing large document in batches', {
    documentTitle,
    totalParagraphs: paragraphs.length,
    totalBatches,
  });

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const start = batchIdx * (MAX_PARAGRAPHS_PER_BATCH - BATCH_OVERLAP);
    const end = Math.min(start + MAX_PARAGRAPHS_PER_BATCH, paragraphs.length);
    const batchParagraphs = paragraphs.slice(start, end);

    if (batchParagraphs.length === 0) break;

    logger.info('[SmartChunk] Processing batch', {
      batch: batchIdx + 1,
      totalBatches,
      paragraphRange: `${start + 1}-${end}`,
    });

    const numbered = formatNumberedParagraphs(batchParagraphs);
    const prompt = buildChunkingPrompt(numbered, documentTitle, batchParagraphs.length);

    try {
      const batchDefs = await callLLMForChunking(prompt);

      // Adjust paragraph numbers to global scope (batch-local → document-global)
      const adjusted = batchDefs.map(def => ({
        ...def,
        paragraphs: def.paragraphs.map(n => n + start),
      }));

      allChunkDefs.push(...adjusted);
    } catch (err: any) {
      logger.error('[SmartChunk] Batch failed, creating fallback chunk', {
        batch: batchIdx + 1,
        error: err.message,
      });

      // Fallback: treat entire batch as one chunk
      allChunkDefs.push({
        paragraphs: Array.from({ length: end - start }, (_, i) => start + i + 1),
        title: `${documentTitle} - Bagian ${batchIdx + 1}`,
        category: 'umum',
      });
    }
  }

  return allChunkDefs;
}
