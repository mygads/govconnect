/**
 * API Key Manager Service — BYOK (Bring Your Own Key) for Gemini
 *
 * Architecture:
 * - Fetches BYOK API keys from Dashboard API (internal network)
 * - Caches keys in-memory, refreshes every 60s
 * - Tracks per-minute / per-day usage against Google's rate limits
 * - Auto-switches keys at 80% capacity
 * - Falls back to .env GEMINI_API_KEY as ultimate fallback
 * - Supports Free / Tier 1 / Tier 2 with different rate limits
 *
 * Rate limits are per-project (per API key), NOT per-model.
 * But each model within a project has its own limits.
 *
 * Model fallback order (cheapest→more capable):
 *   gemini-2.0-flash-lite → gemini-2.5-flash-lite → gemini-2.0-flash → gemini-2.5-flash → gemini-3-flash-preview
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';
import logger from '../utils/logger';

// ==================== Types ====================

export interface GeminiApiKey {
  id: string;
  name: string;
  api_key: string;
  gmail_account: string;
  tier: 'free' | 'tier1' | 'tier2';
  is_active: boolean;
  is_valid: boolean;
  priority: number;
  consecutive_failures: number;
  last_used_at: string | null;
}

export interface ModelRateLimit {
  rpm: number;     // Requests per minute
  tpm: number;     // Tokens per minute (input)
  rpd: number;     // Requests per day
}

interface UsageCounter {
  request_count: number;
  input_tokens: number;
  total_tokens: number;
}

interface KeyUsageCache {
  // key: `${keyId}:${model}:minute:${minuteKey}` or `${keyId}:${model}:day:${dayKey}`
  [cacheKey: string]: UsageCounter;
}

export interface KeySelectionResult {
  apiKey: string;
  keyId: string | null;    // null = .env fallback
  keyName: string;
  genAI: GoogleGenerativeAI;
  isByok: boolean;
  tier: 'free' | 'tier1' | 'tier2' | 'env';
}

// ==================== Constants ====================

/** Capacity threshold — switch to next key at 80% */
const CAPACITY_THRESHOLD = 0.80;

/** How often to refresh keys from Dashboard API (ms) */
const KEY_REFRESH_INTERVAL_MS = 60_000;

/** How often to flush usage counters to Dashboard API (ms) */
const USAGE_FLUSH_INTERVAL_MS = 30_000;

/** Max consecutive failures before marking key invalid */
const MAX_CONSECUTIVE_FAILURES = 10;

/** Retry per model before switching to next model */
export const MAX_RETRIES_PER_MODEL = 2;

/**
 * Model fallback order — cheapest/fastest first.
 * Uses only models available across all tiers (including free).
 * 2.0-flash-lite and 2.0-flash are NOT available on free tier.
 */
export const MODEL_FALLBACK_ORDER = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
];

/**
 * Extended model fallback for paid tiers (tier1/tier2) — includes 2.0 models.
 */
export const MODEL_FALLBACK_ORDER_PAID = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
];

// ==================== Rate Limits by Tier ====================
// Source: Google AI Studio rate limit dashboard (verified February 2026)
// Limits are PER PROJECT (per API key), per model.
// "Unlimited" RPD represented as 999_999.

/** Free tier rate limits — only 4 models available */
const FREE_TIER_LIMITS: Record<string, ModelRateLimit> = {
  'gemini-2.5-flash-lite':  { rpm: 10,  tpm: 250_000, rpd: 20 },
  'gemini-2.5-flash':       { rpm: 5,   tpm: 250_000, rpd: 20 },
  'gemini-3-flash-preview': { rpm: 5,   tpm: 250_000, rpd: 20 },
  'gemini-embedding-001':   { rpm: 100, tpm: 30_000,  rpd: 1_000 },
};

/** Free tier: only these models are available (NO 2.0-flash, NO 2.0-flash-lite) */
const FREE_TIER_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-embedding-001',
];

/** Tier 1 rate limits (paid billing account linked) — from AI Studio dashboard */
const TIER1_LIMITS: Record<string, ModelRateLimit> = {
  'gemini-2.0-flash-lite':  { rpm: 4_000, tpm: 4_000_000,  rpd: 999_999 },
  'gemini-2.0-flash':       { rpm: 2_000, tpm: 4_000_000,  rpd: 999_999 },
  'gemini-2.5-flash-lite':  { rpm: 4_000, tpm: 4_000_000,  rpd: 999_999 },
  'gemini-2.5-flash':       { rpm: 1_000, tpm: 1_000_000,  rpd: 10_000 },
  'gemini-2.5-pro':         { rpm: 150,   tpm: 2_000_000,  rpd: 1_000 },
  'gemini-3-flash-preview': { rpm: 1_000, tpm: 1_000_000,  rpd: 10_000 },
  'gemini-3-pro-preview':   { rpm: 25,    tpm: 1_000_000,  rpd: 250 },
  'gemini-embedding-001':   { rpm: 3_000, tpm: 1_000_000,  rpd: 999_999 },
};

/** Tier 1: all models available */
const TIER1_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-embedding-001',
];

/** Tier 2 rate limits (>$250 cumulative spend, 30+ days since first payment) */
// Note: Tier 2 limits are estimated at ~2x Tier 1. Update with actual AI Studio
// values when a Tier 2 account is available.
const TIER2_LIMITS: Record<string, ModelRateLimit> = {
  'gemini-2.0-flash-lite':  { rpm: 8_000,  tpm: 8_000_000,  rpd: 999_999 },
  'gemini-2.0-flash':       { rpm: 4_000,  tpm: 8_000_000,  rpd: 999_999 },
  'gemini-2.5-flash-lite':  { rpm: 8_000,  tpm: 8_000_000,  rpd: 999_999 },
  'gemini-2.5-flash':       { rpm: 2_000,  tpm: 4_000_000,  rpd: 999_999 },
  'gemini-2.5-pro':         { rpm: 1_000,  tpm: 4_000_000,  rpd: 10_000 },
  'gemini-3-flash-preview': { rpm: 2_000,  tpm: 4_000_000,  rpd: 999_999 },
  'gemini-3-pro-preview':   { rpm: 150,    tpm: 2_000_000,  rpd: 1_000 },
  'gemini-embedding-001':   { rpm: 5_000,  tpm: 4_000_000,  rpd: 999_999 },
};

const TIER2_MODELS = TIER1_MODELS; // Same model list

// ==================== Helper Functions ====================

function getTierLimits(tier: string): Record<string, ModelRateLimit> {
  switch (tier) {
    case 'free': return FREE_TIER_LIMITS;
    case 'tier1': return TIER1_LIMITS;
    case 'tier2': return TIER2_LIMITS;
    default: return FREE_TIER_LIMITS;
  }
}

function getTierModels(tier: string): string[] {
  switch (tier) {
    case 'free': return FREE_TIER_MODELS;
    case 'tier1': return TIER1_MODELS;
    case 'tier2': return TIER2_MODELS;
    default: return FREE_TIER_MODELS;
  }
}

function getModelLimit(tier: string, model: string): ModelRateLimit | null {
  const limits = getTierLimits(tier);
  // Exact match
  if (limits[model]) return limits[model];
  // Prefix match for date-suffixed models
  const keys = Object.keys(limits).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model.startsWith(key)) return limits[key];
  }
  return null;
}

function getCurrentMinuteKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
}

function getCurrentDayKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

// ==================== API Key Manager Singleton ====================

class ApiKeyManager {
  private byokKeys: GeminiApiKey[] = [];
  private usageCache: KeyUsageCache = {};
  private genAIInstances: Map<string, GoogleGenerativeAI> = new Map();
  private envGenAI: GoogleGenerativeAI;
  private lastRefreshAt = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor() {
    this.envGenAI = new GoogleGenerativeAI(config.geminiApiKey);
  }

  // ---------- Initialization ----------

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await this.refreshKeys();

    // Periodic key refresh
    this.refreshTimer = setInterval(() => {
      this.refreshKeys().catch(err =>
        logger.error('BYOK key refresh failed', { error: err.message })
      );
    }, KEY_REFRESH_INTERVAL_MS);

    // Periodic usage flush
    this.flushTimer = setInterval(() => {
      this.flushUsage().catch(err =>
        logger.error('BYOK usage flush failed', { error: err.message })
      );
    }, USAGE_FLUSH_INTERVAL_MS);

    logger.info('🔑 API Key Manager initialized', {
      byokKeyCount: this.byokKeys.length,
      envFallback: !!config.geminiApiKey,
    });
  }

  // ---------- Key Refresh from Dashboard API ----------

  private async refreshKeys(): Promise<void> {
    try {
      const dashboardUrl = config.dashboardServiceUrl || 'http://dashboard:3000';
      const resp = await fetch(`${dashboardUrl}/api/internal/gemini-keys`, {
        headers: {
          'x-internal-api-key': config.internalApiKey,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) {
        // Dashboard might not have the endpoint yet — that's OK
        if (resp.status === 404) {
          logger.debug('BYOK endpoint not available yet (404)');
          return;
        }
        throw new Error(`Dashboard API returned ${resp.status}`);
      }

      const data = await resp.json() as { keys?: GeminiApiKey[] };
      this.byokKeys = (data.keys || [])
        .filter((k: GeminiApiKey) => k.is_active && k.is_valid)
        .sort((a: GeminiApiKey, b: GeminiApiKey) => a.priority - b.priority);

      // Create/update GenAI instances
      for (const key of this.byokKeys) {
        if (!this.genAIInstances.has(key.id)) {
          this.genAIInstances.set(key.id, new GoogleGenerativeAI(key.api_key));
        }
      }

      // Remove stale instances
      const activeIds = new Set(this.byokKeys.map(k => k.id));
      for (const [id] of this.genAIInstances) {
        if (!activeIds.has(id)) {
          this.genAIInstances.delete(id);
        }
      }

      this.lastRefreshAt = Date.now();

      logger.debug('🔑 BYOK keys refreshed', {
        count: this.byokKeys.length,
        tiers: this.byokKeys.map(k => `${k.name}(${k.tier})`),
      });
    } catch (error: any) {
      logger.warn('🔑 Failed to refresh BYOK keys, using existing cache', {
        error: error.message,
        cachedCount: this.byokKeys.length,
      });
    }
  }

  // ---------- Usage Tracking ----------

  private getUsageKey(keyId: string, model: string, periodType: string, periodKey: string): string {
    return `${keyId}:${model}:${periodType}:${periodKey}`;
  }

  private getUsage(keyId: string, model: string, periodType: string, periodKey: string): UsageCounter {
    const key = this.getUsageKey(keyId, model, periodType, periodKey);
    if (!this.usageCache[key]) {
      this.usageCache[key] = { request_count: 0, input_tokens: 0, total_tokens: 0 };
    }
    return this.usageCache[key];
  }

  /**
   * Record a completed request for a BYOK key.
   * Called after each successful or failed Gemini API call.
   */
  recordUsage(keyId: string, model: string, inputTokens: number, totalTokens: number): void {
    const minuteKey = getCurrentMinuteKey();
    const dayKey = getCurrentDayKey();

    const minuteUsage = this.getUsage(keyId, model, 'minute', minuteKey);
    minuteUsage.request_count += 1;
    minuteUsage.input_tokens += inputTokens;
    minuteUsage.total_tokens += totalTokens;

    const dayUsage = this.getUsage(keyId, model, 'day', dayKey);
    dayUsage.request_count += 1;
    dayUsage.input_tokens += inputTokens;
    dayUsage.total_tokens += totalTokens;
  }

  /**
   * Check if a key+model combination has reached 80% of any rate limit.
   */
  isAtCapacity(keyId: string, model: string, tier: string): boolean {
    const limit = getModelLimit(tier, model);
    if (!limit) return true; // Model not available for this tier

    const minuteKey = getCurrentMinuteKey();
    const dayKey = getCurrentDayKey();

    const minuteUsage = this.getUsage(keyId, model, 'minute', minuteKey);
    const dayUsage = this.getUsage(keyId, model, 'day', dayKey);

    // Check RPM
    if (minuteUsage.request_count >= limit.rpm * CAPACITY_THRESHOLD) return true;
    // Check TPM (input tokens)
    if (minuteUsage.input_tokens >= limit.tpm * CAPACITY_THRESHOLD) return true;
    // Check RPD
    if (dayUsage.request_count >= limit.rpd * CAPACITY_THRESHOLD) return true;

    return false;
  }

  /**
   * Get remaining capacity info for a key+model.
   */
  getCapacityInfo(keyId: string, model: string, tier: string): {
    rpm_used: number; rpm_limit: number;
    tpm_used: number; tpm_limit: number;
    rpd_used: number; rpd_limit: number;
    at_capacity: boolean;
  } | null {
    const limit = getModelLimit(tier, model);
    if (!limit) return null;

    const minuteKey = getCurrentMinuteKey();
    const dayKey = getCurrentDayKey();
    const minuteUsage = this.getUsage(keyId, model, 'minute', minuteKey);
    const dayUsage = this.getUsage(keyId, model, 'day', dayKey);

    return {
      rpm_used: minuteUsage.request_count,
      rpm_limit: limit.rpm,
      tpm_used: minuteUsage.input_tokens,
      tpm_limit: limit.tpm,
      rpd_used: dayUsage.request_count,
      rpd_limit: limit.rpd,
      at_capacity: this.isAtCapacity(keyId, model, tier),
    };
  }

  /**
   * Record success — reset consecutive failures counter.
   */
  recordSuccess(keyId: string): void {
    const key = this.byokKeys.find(k => k.id === keyId);
    if (key) {
      key.consecutive_failures = 0;
    }
  }

  /**
   * Record failure — increment consecutive failures.
   * If threshold reached, mark key as invalid.
   */
  recordFailure(keyId: string, error: string): void {
    const key = this.byokKeys.find(k => k.id === keyId);
    if (!key) return;

    key.consecutive_failures += 1;

    if (key.consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
      key.is_valid = false;
      logger.error('🔑 BYOK key marked invalid due to consecutive failures', {
        keyId,
        keyName: key.name,
        failures: key.consecutive_failures,
        lastError: error,
      });

      // Report to dashboard async
      this.reportKeyStatus(keyId, false, error).catch(() => {});
    }
  }

  // ---------- Key Selection Logic ----------

  /**
   * Select the best API key + model for a request.
   * Priority:
   *   1. BYOK keys (ordered by priority) that have capacity
   *   2. .env GEMINI_API_KEY as fallback
   *
   * For each key, we check if the requested model has capacity.
   * If not, we skip to the next key.
   *
   * @param requestedModel - The model to use (exact name)
   * @returns KeySelectionResult or null if no key available for this model
   */
  selectKey(requestedModel: string): KeySelectionResult | null {
    // 1. Try BYOK keys first
    for (const key of this.byokKeys) {
      if (!key.is_active || !key.is_valid) continue;

      const tierModels = getTierModels(key.tier);
      
      // Check if model is available for this tier
      // Use prefix matching for date-suffixed models
      const modelAvailable = tierModels.some(m => requestedModel.startsWith(m) || m === requestedModel);
      if (!modelAvailable) continue;

      // Check capacity
      if (this.isAtCapacity(key.id, requestedModel, key.tier)) {
        logger.debug('🔑 Key at capacity, trying next', {
          keyName: key.name,
          model: requestedModel,
          tier: key.tier,
        });
        continue;
      }

      const genAI = this.genAIInstances.get(key.id);
      if (!genAI) continue;

      return {
        apiKey: key.api_key,
        keyId: key.id,
        keyName: key.name,
        genAI,
        isByok: true,
        tier: key.tier,
      };
    }

    // 2. Fallback to .env GEMINI_API_KEY
    if (config.geminiApiKey) {
      return {
        apiKey: config.geminiApiKey,
        keyId: null,
        keyName: '.env (fallback)',
        genAI: this.envGenAI,
        isByok: false,
        tier: 'env',
      };
    }

    return null;
  }

  /**
   * Select the best key + model with automatic model fallback.
   * Tries MODEL_FALLBACK_ORDER for each key until one works.
   *
   * @param preferredModels - Optional preferred model order (from .env)
   * @param allowedModels - Optional filter (e.g. MICRO_NLU_MODELS)
   * @returns Array of { key, model } combinations to try in order
   */
  getCallPlan(preferredModels?: string[], allowedModels?: string[]): Array<{
    key: KeySelectionResult;
    model: string;
  }> {
    const plan: Array<{ key: KeySelectionResult; model: string }> = [];

    // 1. BYOK keys — try each model for each key
    for (const byokKey of this.byokKeys) {
      if (!byokKey.is_active || !byokKey.is_valid) continue;

      const tierModels = getTierModels(byokKey.tier);
      const genAI = this.genAIInstances.get(byokKey.id);
      if (!genAI) continue;

      // Pick model list: caller's preferred > paid order for tier1/2 > free order
      const models = preferredModels && preferredModels.length > 0
        ? preferredModels
        : (byokKey.tier === 'free' ? MODEL_FALLBACK_ORDER : MODEL_FALLBACK_ORDER_PAID);

      for (const model of models) {
        if (allowedModels && !allowedModels.some(m => model.startsWith(m) || m === model)) continue;
        
        const modelAvailable = tierModels.some(m => model.startsWith(m) || m === model);
        if (!modelAvailable) continue;

        if (this.isAtCapacity(byokKey.id, model, byokKey.tier)) continue;

        plan.push({
          key: {
            apiKey: byokKey.api_key,
            keyId: byokKey.id,
            keyName: byokKey.name,
            genAI,
            isByok: true,
            tier: byokKey.tier,
          },
          model,
        });
      }
    }

    // 2. Fallback: .env key with all models (use paid order since .env is typically paid)
    if (config.geminiApiKey) {
      const envKey: KeySelectionResult = {
        apiKey: config.geminiApiKey,
        keyId: null,
        keyName: '.env (fallback)',
        genAI: this.envGenAI,
        isByok: false,
        tier: 'env',
      };

      const envModels = preferredModels && preferredModels.length > 0
        ? preferredModels
        : MODEL_FALLBACK_ORDER_PAID;

      for (const model of envModels) {
        if (allowedModels && !allowedModels.some(m => model.startsWith(m) || m === model)) continue;
        plan.push({ key: envKey, model });
      }
    }

    return plan;
  }

  // ---------- Dashboard Communication ----------

  private async reportKeyStatus(keyId: string, isValid: boolean, reason: string): Promise<void> {
    try {
      const dashboardUrl = config.dashboardServiceUrl || 'http://dashboard:3000';
      await fetch(`${dashboardUrl}/api/internal/gemini-keys/${keyId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-key': config.internalApiKey,
        },
        body: JSON.stringify({ is_valid: isValid, reason }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error: any) {
      logger.warn('Failed to report key status to dashboard', { keyId, error: error.message });
    }
  }

  private async flushUsage(): Promise<void> {
    const entries = Object.entries(this.usageCache);
    if (entries.length === 0) return;

    // Collect records to send
    const records: Array<{
      key_id: string;
      model: string;
      period_type: string;
      period_key: string;
      request_count: number;
      input_tokens: number;
      total_tokens: number;
    }> = [];

    const now = new Date();
    const currentMinuteKey = getCurrentMinuteKey();
    const currentDayKey = getCurrentDayKey();

    for (const [cacheKey, usage] of entries) {
      if (usage.request_count === 0) continue;

      const parts = cacheKey.split(':');
      // Format: keyId:model:periodType:periodKey
      const keyId = parts[0];
      const model = parts.slice(1, -2).join(':');
      const periodType = parts[parts.length - 2];
      const periodKey = parts[parts.length - 1];

      records.push({
        key_id: keyId,
        model,
        period_type: periodType,
        period_key: periodKey,
        ...usage,
      });
    }

    if (records.length === 0) return;

    try {
      const dashboardUrl = config.dashboardServiceUrl || 'http://dashboard:3000';
      await fetch(`${dashboardUrl}/api/internal/gemini-keys/usage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-key': config.internalApiKey,
        },
        body: JSON.stringify({ records }),
        signal: AbortSignal.timeout(5000),
      });

      // Clean up old cache entries (keep current minute and day only)
      for (const cacheKey of Object.keys(this.usageCache)) {
        const isCurrentMinute = cacheKey.includes(`:minute:${currentMinuteKey}`);
        const isCurrentDay = cacheKey.includes(`:day:${currentDayKey}`);
        if (!isCurrentMinute && !isCurrentDay) {
          delete this.usageCache[cacheKey];
        }
      }
    } catch (error: any) {
      logger.warn('Failed to flush BYOK usage to dashboard', { error: error.message });
    }
  }

  // ---------- Public Getters for Status Page ----------

  getByokKeys(): GeminiApiKey[] {
    return this.byokKeys;
  }

  getAllCapacityInfo(): Array<{
    keyId: string;
    keyName: string;
    tier: string;
    models: Array<{
      model: string;
      rpm_used: number; rpm_limit: number;
      tpm_used: number; tpm_limit: number;
      rpd_used: number; rpd_limit: number;
      at_capacity: boolean;
    }>;
  }> {
    const result = [];

    for (const key of this.byokKeys) {
      const tierModels = getTierModels(key.tier);
      const models = tierModels.map(model => {
        const info = this.getCapacityInfo(key.id, model, key.tier);
        return info ? { model, ...info } : null;
      }).filter(Boolean) as any[];

      result.push({
        keyId: key.id,
        keyName: key.name,
        tier: key.tier,
        models,
      });
    }

    return result;
  }

  // ---------- Cleanup ----------

  destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushUsage().catch(() => {});
  }
}

// ==================== Singleton Export ====================

export const apiKeyManager = new ApiKeyManager();

// Export tier info for the dashboard
export { FREE_TIER_LIMITS, TIER1_LIMITS, TIER2_LIMITS, FREE_TIER_MODELS, TIER1_MODELS, TIER2_MODELS, getTierLimits, getTierModels };
