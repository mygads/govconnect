/**
 * A6 — Small self-host LLM tier.
 *
 * An OpenAI-compatible chat endpoint (e.g. Ollama) used for SMALL tasks
 * (micro-NLU classifiers) before falling back to the main gateway tier.
 *
 * Env:
 *   MODEL_TIER_SMALL=true|false   (default: false — OFF)
 *   SMALL_LLM_BASE_URL            (e.g. http://localhost:11434/v1)
 *   SMALL_LLM_MODEL               (model already pulled on the host, e.g. qwen2.5:7b)
 *   SMALL_LLM_API_KEY             (optional; Ollama needs none)
 *   SMALL_LLM_TIMEOUT_MS          (default 15000)
 *
 * Contract:
 * - OFF by default. When disabled or misconfigured → returns null and the
 *   caller uses the main tier. No behavior change for existing deployments.
 * - NEVER throws for endpoint failures: any network error, non-2xx, or
 *   malformed payload → warn + null → caller falls back to the main tier.
 * - NEVER downloads models. The operator pulls the model themselves
 *   (e.g. `ollama pull qwen2.5:7b`); we only call the HTTP endpoint.
 * - fetchFn is injectable so routing/fallback is unit-testable with a mock.
 */

import logger from '../utils/logger';

export interface SmallTierConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export function getSmallTierConfig(env: NodeJS.ProcessEnv = process.env): SmallTierConfig {
  const timeoutRaw = Number(env.SMALL_LLM_TIMEOUT_MS ?? 15000);
  return {
    enabled: String(env.MODEL_TIER_SMALL ?? '').trim().toLowerCase() === 'true',
    baseUrl: String(env.SMALL_LLM_BASE_URL ?? '').trim().replace(/\/+$/, ''),
    model: String(env.SMALL_LLM_MODEL ?? '').trim(),
    apiKey: String(env.SMALL_LLM_API_KEY ?? ''),
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 15000,
  };
}

export function isSmallTierEnabled(cfg: SmallTierConfig = getSmallTierConfig()): boolean {
  return cfg.enabled && cfg.baseUrl.length > 0 && cfg.model.length > 0;
}

export interface SmallTierMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SmallTierResult {
  text: string;
  model: string;
}

interface FetchLike {
  (url: string, init?: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export async function callSmallTier(
  messages: SmallTierMessage[],
  opts?: {
    config?: SmallTierConfig;
    fetchFn?: FetchLike;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<SmallTierResult | null> {
  const cfg = opts?.config ?? getSmallTierConfig();
  if (!isSmallTierEnabled(cfg)) return null; // default-off: silent no-op
  const fetchFn = (opts?.fetchFn ?? fetch) as FetchLike;
  const url = `${cfg.baseUrl}/chat/completions`;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: opts?.temperature ?? 0.1,
        max_tokens: opts?.maxTokens ?? 300,
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!res.ok) {
      logger.warn('[small-tier] endpoint returned non-2xx, falling back to main tier', {
        status: res.status,
      });
      return null;
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      model?: string;
    };
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim() === '') {
      logger.warn('[small-tier] empty/malformed completion, falling back to main tier');
      return null;
    }
    return { text: text.trim(), model: body?.model ?? cfg.model };
  } catch (err) {
    logger.warn('[small-tier] endpoint failed, falling back to main tier', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    return null;
  }
}
