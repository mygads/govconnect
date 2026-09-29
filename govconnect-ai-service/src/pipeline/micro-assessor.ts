/**
 * Micro-LLM wiring for the v2 pipeline.
 *
 * - installMicroAssessor(): registers the cheap-tier classifier as the
 *   stage-assessor's LLM hook. The assessor only judges FUZZY transitions;
 *   deterministic routing is untouched. Any failure → deterministic fallback.
 * - resolveServiceSlug(): micro-LLM service matching for the service_request
 *   slot (reuses the existing micro-llm-matcher, no new prompt to maintain).
 *
 * Both are best-effort: null/false on any failure, never throws.
 */

import { setAssessorLLM, type AssessorInput } from './stage-assessor';
import type { Stage } from './stage-types';
import logger from '../utils/logger';

const ASSESSOR_PROMPT = `Kamu adalah penilai tahap percakapan layanan publik desa Indonesia.
TUGAS: pilih SATU tahap lanjutan yang paling cocok untuk pesan warga berikut.

TAHAP KANDIDAT (pilih tepat satu dari daftar ini):
{candidates}

PESAN WARGA: "{message}"
TAHAP SAAT INI: {fromStage}

ATURAN:
- COLLECT: warga sedang melapor/mengadu atau mengurus surat/layanan (butuh data lanjutan).
- INFORMATION: warga bertanya info (jadwal, syarat, biaya, profil desa).
- STATUS_CHECK: warga menanyakan status laporan/permohonan yang sudah ada.
- HANDOFF: warga minta manusia/admin, frustrasi, atau topik sensitif.
- Jika ragu, pilih tahap yang paling aman (INFORMATION untuk pertanyaan, COLLECT untuk keluhan).

OUTPUT (JSON saja): {"stage": "<salah satu kandidat>", "confidence": 0.0-1.0, "reason": "<singkat>"}`;

function parseAssessorJSON(raw: string): { stage: string; confidence: number; reason: string } | null {
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const j = JSON.parse(cleaned);
    if (typeof j.stage !== 'string') return null;
    const confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0));
    return { stage: j.stage, confidence, reason: String(j.reason ?? '') };
  } catch {
    return null;
  }
}

/**
 * Register the micro-LLM assessor. Safe to call once at startup; the hook
 * degrades to the deterministic keyword fallback on any gateway failure.
 */
export function installMicroAssessor(): void {
  setAssessorLLM(async (input: AssessorInput, candidates: Stage[]) => {
    try {
      const {
        buildPromptMessages, callAIGatewayPrompt, isAIGatewayEnabledAsync,
      } = await import('../services/ai-gateway.service');
      if (!(await isAIGatewayEnabledAsync('llm', null))) return null;
      const prompt = ASSESSOR_PROMPT
        .replace('{candidates}', candidates.join(', '))
        .replace('{message}', input.message.slice(0, 500))
        .replace('{fromStage}', input.fromStage);
      const res = await callAIGatewayPrompt({
        lane: 'llm',
        modelPriority: [],
        messages: buildPromptMessages(prompt),
        temperature: 0.1,
        maxTokens: 150,
        timeoutMs: 15_000,
        jsonMode: true,
        layerType: 'micro_nlu',
        callType: 'stage_assess',
        context: undefined,
      });
      if (!res?.text) return null;
      const parsed = parseAssessorJSON(res.text);
      if (!parsed || !candidates.includes(parsed.stage as Stage)) return null;
      return { stage: parsed.stage as Stage, confidence: parsed.confidence, reason: parsed.reason };
    } catch (err) {
      logger.debug('[micro-assessor] gateway failed, deterministic fallback', {
        error: String((err as Error)?.message ?? err).slice(0, 120),
      });
      return null;
    }
  });
  logger.info('[micro-assessor] installed (cheap-tier stage classifier)');
}

/** Resolve a villager's phrasing to an official service_slug via micro-LLM. */
export async function resolveServiceSlug(
  query: string, tenantId?: string, userId?: string,
): Promise<string | null> {
  try {
    const [{ matchServiceSlug }, { getServiceCatalog }] = await Promise.all([
      import('../services/micro-llm-matcher.service'),
      import('../services/case-client.service'),
    ]);
    const catalog = (await getServiceCatalog(tenantId)).filter((s) => s.is_active);
    if (catalog.length === 0) return null;
    const m = await matchServiceSlug(
      query,
      catalog.map((s) => ({ slug: s.slug, name: s.name, description: s.description ?? undefined })),
      { village_id: tenantId, wa_user_id: userId },
    );
    if (m?.matched_slug && m.confidence >= 0.5) return m.matched_slug;
    return null;
  } catch (err) {
    logger.debug('[micro-assessor] resolveServiceSlug failed', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    return null;
  }
}
