/**
 * Question Variant Generation Service
 * 
 * Generates diverse question phrasings for each KB entry to improve recall.
 * Stores variants as additional vectors for semantic search.
 * 
 * Example: KB entry "Jam operasional kantor desa: Senin-Jumat 08:00-15:00"
 * Generates variants like:
 * - "Kapan kantor desa buka?"
 * - "Jam kerja kantor kelurahan?"
 * - "Hari apa saja pelayanan?"
 */

import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { config } from '../config/env';
import { generateEmbedding } from './embedding.service';
import { callAIGatewayPrompt } from './ai-gateway.service';
import { EmbeddingConfig } from '../types/embedding.types';

type VariantScope = 'village' | 'global';

function resolveVariantScope(villageId?: string | null, scope?: VariantScope): { villageId: string | null; scope: VariantScope; isGlobal: boolean } {
  if (scope === 'global') return { villageId: null, scope: 'global', isGlobal: true };
  if (!villageId) throw new Error('villageId is required for village-scoped question variants');
  return { villageId, scope: 'village', isGlobal: false };
}

const VARIANT_PROMPT = `Kamu adalah generator pertanyaan untuk sistem knowledge base pemerintah desa.

Diberikan judul dan isi knowledge base, buatkan 3-5 variasi pertanyaan yang mungkin diajukan warga terkait informasi ini.

ATURAN:
1. Gunakan bahasa Indonesia sehari-hari (informal)
2. Variasikan gaya: singkat, panjang, formal, informal
3. Sertakan sinonim dan istilah alternatif yang biasa dipakai warga
4. Output HANYA JSON array of strings, tanpa markdown

CONTOH INPUT:
Judul: Jam Operasional Kantor Desa
Isi: Kantor desa buka Senin-Jumat pukul 08:00-15:00

CONTOH OUTPUT:
["Kapan kantor desa buka?","Jam kerja kantor kelurahan berapa?","Hari apa saja pelayanan kantor desa?","Kantor desa buka jam berapa sampai jam berapa?","Jadwal pelayanan kantor desa"]`;

/**
 * Generate question variants for a knowledge base entry using LLM
 */
export async function generateQuestionVariants(
  title: string,
  content: string,
  context?: EmbeddingConfig['context'],
): Promise<string[]> {
  try {
    const userMessage = `Judul: ${title}\nIsi: ${content.slice(0, 500)}`;
    const response = await callAIGatewayPrompt({
      lane: 'llm',
      modelPriority: [config.aiGateway.model],
      messages: [
        { role: 'system', content: VARIANT_PROMPT },
        { role: 'user', content: userMessage },
      ],
      jsonMode: true,
      temperature: 0.7,
      maxTokens: 500,
      layerType: 'agent',
      callType: 'agent_orchestrator',
      context: context ? {
        village_id: context.village_id ?? null,
        wa_user_id: context.wa_user_id ?? null,
        session_id: context.session_id ?? null,
        channel: context.channel ?? null,
        message_id: context.message_id ?? null,
        trace_id: context.trace_id ?? null,
        billing_group_id: context.billing_group_id ?? null,
      } : undefined,
    });

    if (!response?.text) {
      logger.warn('LLM call returned empty response for question variants');
      return [];
    }

    const parsed = JSON.parse(response.text);
    const variants: string[] = Array.isArray(parsed)
      ? parsed
      : (parsed.variants || parsed.questions || []);

    return variants.filter((v: unknown) => typeof v === 'string' && v.length > 5).slice(0, 5);
  } catch (error: any) {
    logger.error('Failed to generate question variants', { error: error.message });
    return [];
  }
}

/**
 * Generate and store question variants + embeddings for a knowledge entry
 */
export async function generateAndStoreVariants(
  sourceId: string,
  title: string,
  content: string,
  villageId?: string | null,
  sourceType: string = 'knowledge',
  scope: VariantScope = 'village',
  context?: EmbeddingConfig['context'],
): Promise<number> {
  const variants = await generateQuestionVariants(title, content, context);
  const variantScope = resolveVariantScope(villageId, scope);

  if (variants.length === 0) {
    logger.info('No question variants generated', { sourceId });
    return 0;
  }

  let stored = 0;

  for (const variantText of variants) {
    try {
      const embeddingResult = await generateEmbedding(variantText, {
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 768,
        context,
      });

      if (!embeddingResult?.values) continue;

      const embeddingStr = `[${embeddingResult.values.join(',')}]`;

      await prisma.$executeRaw`
        INSERT INTO ai.question_variants (
          id, source_id, source_type, village_id, scope, is_global, variant_text,
          embedding, embedding_model, created_at
        ) VALUES (
          ${`qv_${sourceId}_${stored}`}, ${sourceId}, ${sourceType},
          ${variantScope.villageId}, ${variantScope.scope}, ${variantScope.isGlobal}, ${variantText},
          ${embeddingStr}::ai.vector, ${config.embeddingGateway.model}, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          village_id = EXCLUDED.village_id,
          scope = EXCLUDED.scope,
          is_global = EXCLUDED.is_global,
          variant_text = EXCLUDED.variant_text,
          embedding = EXCLUDED.embedding,
          embedding_model = EXCLUDED.embedding_model
      `;

      stored++;
    } catch (error: any) {
      logger.warn('Failed to store question variant', {
        sourceId,
        variant: variantText.slice(0, 50),
        error: error.message,
      });
    }
  }

  logger.info('Question variants stored', { sourceId, total: stored });
  return stored;
}

/**
 * Delete all question variants for a knowledge entry
 */
export async function deleteVariants(sourceId: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      DELETE FROM ai.question_variants WHERE source_id = ${sourceId}
    `;
  } catch (error: any) {
    logger.warn('Failed to delete question variants', { sourceId, error: error.message });
  }
}
