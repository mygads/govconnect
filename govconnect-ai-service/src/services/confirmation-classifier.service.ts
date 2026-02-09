import logger from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';
import { extractAndRecord } from './token-usage.service';
import { apiKeyManager, MAX_RETRIES_PER_MODEL, isRateLimitError } from './api-key-manager.service';

export type ConfirmationDecision = 'CONFIRM' | 'REJECT' | 'UNCERTAIN';

export interface ConfirmationResult {
  decision: ConfirmationDecision;
  confidence: number;
  reason?: string;
}

const DEFAULT_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

function parseModelListEnv(envValue: string | undefined, fallback: string[]): string[] {
  const raw = (envValue || '').trim();
  if (!raw) return fallback;

  const models = raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const unique: string[] = [];
  for (const model of models) {
    if (!unique.includes(model)) unique.push(model);
  }

  return unique.length > 0 ? unique : fallback;
}

const CONFIRMATION_MODEL_PRIORITY = parseModelListEnv(process.env.MICRO_NLU_MODELS, DEFAULT_MODELS);

// Timeout for micro LLM calls (10 seconds)
const MICRO_LLM_TIMEOUT_MS = 10_000;

const CONFIRMATION_SYSTEM_PROMPT = `Anda adalah classifier konfirmasi untuk layanan publik.

TUGAS:
- Tentukan apakah pesan user MENGONFIRMASI pengiriman link formulir (CONFIRM), MENOLAK (REJECT), atau BELUM JELAS (UNCERTAIN).
- Anggap pertanyaan minta link/form (misal: "mana linknya", "kirim link", "formnya mana") sebagai CONFIRM.
- Anggap penundaan/penolakan ("tidak", "nanti", "belum", "batal") sebagai REJECT.
- Jika netral atau ambigu, beri UNCERTAIN.

OUTPUT (JSON saja):
{
  "decision": "CONFIRM|REJECT|UNCERTAIN",
  "confidence": 0.0-1.0,
  "reason": "short"
}

CONTOH:
Input: "iya" -> {"decision":"CONFIRM","confidence":0.95,"reason":"explicit yes"}
Input: "mana linknya?" -> {"decision":"CONFIRM","confidence":0.92,"reason":"asks link"}
Input: "nanti dulu" -> {"decision":"REJECT","confidence":0.9,"reason":"postpone"}
Input: "gimana ya" -> {"decision":"UNCERTAIN","confidence":0.4,"reason":"ambiguous"}

PESAN USER:
{user_message}
`;

export async function classifyConfirmation(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<ConfirmationResult | null> {
  const prompt = CONFIRMATION_SYSTEM_PROMPT.replace('{user_message}', message || '');

  // Build call plan using BYOK keys + fallback
  const callPlan = apiKeyManager.getCallPlan(CONFIRMATION_MODEL_PRIORITY, CONFIRMATION_MODEL_PRIORITY);

  for (const { key, model: modelName } of callPlan) {
    for (let retry = 0; retry < MAX_RETRIES_PER_MODEL; retry++) {
      try {
        const geminiModel = key.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 200,
          },
        });

        const startMs = Date.now();
        const result = await Promise.race([
          geminiModel.generateContent(prompt),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Micro LLM timeout after ${MICRO_LLM_TIMEOUT_MS}ms`)), MICRO_LLM_TIMEOUT_MS)
          ),
        ]);
        const durationMs = Date.now() - startMs;
        const responseText = result.response.text();

        // Record BYOK usage
        if (key.isByok && key.keyId) {
          const usage = result.response.usageMetadata;
          apiKeyManager.recordSuccess(key.keyId);
          apiKeyManager.recordUsage(key.keyId, modelName, usage?.promptTokenCount ?? 0, usage?.totalTokenCount ?? 0);
        }

        extractAndRecord(result, modelName, 'micro_nlu', 'confirmation_classify', {
          ...context,
          success: true,
          duration_ms: durationMs,
          key_source: key.isByok ? 'byok' : 'env',
          key_id: key.keyId,
          key_tier: key.tier,
        });

        const cleaned = responseText
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();

        const parsed = JSON.parse(cleaned) as ConfirmationResult;

        if (!parsed?.decision || typeof parsed.confidence !== 'number') {
          throw new Error('Invalid confirmation response');
        }

        return {
          decision: parsed.decision,
          confidence: Math.max(0, Math.min(1, parsed.confidence)),
          reason: parsed.reason,
        };
      } catch (error: any) {
        logger.warn('Confirmation classifier failed', {
          keyName: key.keyName,
          model: modelName,
          retry: retry + 1,
          error: error.message,
        });
        if (key.isByok && key.keyId) {
          apiKeyManager.recordFailure(key.keyId, error.message);
        }
        // 429 / rate limit → mark model at capacity, skip to next model
        if (isRateLimitError(error.message || '')) {
          if (key.isByok && key.keyId) {
            apiKeyManager.recordRateLimit(key.keyId, modelName, key.tier);
          }
          break;
        }
        // API key / model not found → skip immediately
        if (error.message?.includes('API_KEY_INVALID') || error.message?.includes('401') ||
            error.message?.includes('404') || error.message?.includes('not found')) break;
      }
    }
  }

  return null;
}
