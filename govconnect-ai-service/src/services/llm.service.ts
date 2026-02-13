/**
 * LLM Service - Handles Gemini API calls with ROBUST retry mechanism
 * 
 * Features:
 * - BYOK API key rotation (auto-switch at 80% capacity)
 * - Model fallback chain: 2.0-flash-lite → 2.5-flash-lite → 2.0-flash → 2.5-flash → 3-flash
 * - 2 retries per model, then switch model (applies to all: BYOK free, tier1, and .env)
 * - BYOK keys first, .env GEMINI_API_KEY as ultimate fallback
 * - Dynamic model priority based on success rates (tracked in model-stats.service)
 * - Model usage statistics tracking
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';
import { config } from '../config/env';
import { LLMResponse, LLMResponseSchema, LLMMetrics } from '../types/llm-response.types';
import { JSON_SCHEMA_FOR_GEMINI } from '../prompts/system-prompt';
import { modelStatsService } from './model-stats.service';
import { apiKeyManager, MODEL_FALLBACK_ORDER_PAID, MAX_RETRIES_PER_MODEL, isRateLimitError } from './api-key-manager.service';

// Timeout for main LLM calls (30 seconds)
const MAIN_LLM_TIMEOUT_MS = 30_000;

// Retry configuration
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5000;
const JSON_RETRY_EXTRA_DELAY_MS = 500;

/**
 * Repair truncated JSON by closing all open structures.
 * Handles truncated strings, arrays, and objects.
 */
function repairTruncatedJson(text: string): string {
  let result = text.trim();
  
  // Track open structures
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    
    if (escaped) {
      escaped = false;
      continue;
    }
    
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === ch) {
          stack.pop();
        }
      }
    }
  }
  
  // Close unterminated string
  if (inString) {
    result += '"';
  }
  
  // Handle trailing comma before closing (common in truncated JSON)
  result = result.replace(/,\s*$/, '');
  
  // Close all open structures in reverse order
  while (stack.length > 0) {
    result += stack.pop();
  }
  
  return result;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 * Formula: min(maxDelay, baseDelay * 2^attempt + random jitter)
 */
function calculateBackoffDelay(attempt: number, baseDelay: number = BASE_RETRY_DELAY_MS, maxDelay: number = MAX_RETRY_DELAY_MS): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 500; // Random jitter 0-500ms
  return Math.min(maxDelay, exponentialDelay + jitter);
}

/**
 * Parse FULL_NLU_MODELS from environment variable
 */
function parseModelListEnv(envValue: string | undefined, fallback: string[]): string[] {
  const raw = (envValue || '').trim();
  if (!raw) return fallback;

  const models = raw.split(',').map((m) => m.trim()).filter(Boolean);
  const unique: string[] = [];
  for (const model of models) {
    if (!unique.includes(model)) unique.push(model);
  }
  return unique.length > 0 ? unique : fallback;
}

/**
 * Call Gemini with structured JSON output.
 * Uses BYOK key rotation + model fallback chain.
 *
 * Flow:
 * 1. Build call plan: [BYOK keys × models] + [.env key × models]
 * 2. For each (key, model): try up to 2 times
 * 3. If model fails → next model. If key exhausted → next key.
 * 4. Returns null if ALL fail — message stays in pending queue for Layer 2 retry.
 */
export async function callGemini(systemPrompt: string): Promise<{ response: LLMResponse; metrics: LLMMetrics } | null> {
  const startTime = Date.now();
  let totalAttempts = 0;
  let lastError: string = '';

  // Get env-configured model list
  const envModels = parseModelListEnv(process.env.FULL_NLU_MODELS, MODEL_FALLBACK_ORDER_PAID);

  // Build call plan: BYOK keys first, .env fallback last
  const callPlan = apiKeyManager.getCallPlan(envModels);

  if (callPlan.length === 0) {
    logger.error('🚨 No API keys or models available for LLM call');
    return null;
  }

  logger.info('🎯 Starting LLM call with BYOK key rotation', {
    planLength: callPlan.length,
    keys: [...new Set(callPlan.map(p => p.key.keyName))],
    models: [...new Set(callPlan.map(p => p.model))],
  });

  // Try each (key, model) combination with retries
  for (const { key, model: modelName } of callPlan) {
    for (let retry = 0; retry < MAX_RETRIES_PER_MODEL; retry++) {
      totalAttempts++;

      logger.info('🔄 Attempting LLM call', {
        keyName: key.keyName,
        isByok: key.isByok,
        model: modelName,
        retry: retry + 1,
        totalAttempts,
      });

      const callStartTime = Date.now();
      const result = await callGeminiWithModel(systemPrompt, modelName, startTime, key.genAI);
      const callDuration = Date.now() - callStartTime;

      if (result.success && result.data) {
        // Record success
        modelStatsService.recordSuccess(modelName, callDuration);
        if (key.isByok && key.keyId) {
          apiKeyManager.recordSuccess(key.keyId);
          const m = result.data.metrics;
          apiKeyManager.recordUsage(key.keyId, modelName, m.inputTokens, m.totalTokens);
        }

        logger.info('✅ LLM call successful', {
          keyName: key.keyName,
          model: modelName,
          totalAttempts,
          durationMs: callDuration,
        });

        // Inject key source info into metrics for token usage tracking
        result.data.metrics.keySource = key.isByok ? 'byok' : 'env';
        result.data.metrics.keyId = key.keyId;
        result.data.metrics.keyTier = key.tier;

        return result.data;
      }

      lastError = result.error || 'Unknown error';
      modelStatsService.recordFailure(modelName, lastError, callDuration);
      if (key.isByok && key.keyId) {
        apiKeyManager.recordFailure(key.keyId, lastError);
      }

      // 429 / rate limit → mark model at capacity, skip to next model (no retry)
      if (isRateLimitError(lastError)) {
        if (key.isByok && key.keyId) {
          apiKeyManager.recordRateLimit(key.keyId, modelName, key.tier);
        }
        logger.warn('⚠️ Rate limit hit, skipping model', { keyName: key.keyName, model: modelName });
        break;
      }

      // 404 / not found → skip retries, move to next model
      if (lastError.includes('404') || lastError.includes('not found') || lastError.includes('not supported')) {
        logger.warn('⚠️ Model not available, skipping', { model: modelName, error: lastError });
        break;
      }

      // API key invalid → skip retries, move to next key
      if (lastError.includes('API_KEY_INVALID') || lastError.includes('PERMISSION_DENIED') || lastError.includes('401')) {
        logger.warn('⚠️ API key error, skipping key', { keyName: key.keyName, error: lastError });
        break;
      }

      // Exponential backoff before retry
      if (retry < MAX_RETRIES_PER_MODEL - 1) {
        const isJsonError = lastError.includes('JSON') || lastError.includes('Unterminated') || lastError.includes('parsing');
        const backoffDelay = calculateBackoffDelay(retry);
        const actualDelay = isJsonError ? backoffDelay + JSON_RETRY_EXTRA_DELAY_MS : backoffDelay;
        await sleep(actualDelay);
      }
    }
  }

  // ALL combinations exhausted
  const durationMs = Date.now() - startTime;
  logger.error('🚨 CRITICAL: All LLM attempts exhausted — message will be retried later', {
    totalAttempts,
    durationMs,
    lastError,
  });

  return null;
}

/**
 * Internal function to call Gemini with a specific model
 */
async function callGeminiWithModel(
  systemPrompt: string, 
  modelName: string, 
  startTime: number,
  genAIInstance?: GoogleGenerativeAI
): Promise<{ success: boolean; data?: { response: LLMResponse; metrics: LLMMetrics }; error?: string }> {
  const activeGenAI = genAIInstance || new GoogleGenerativeAI(config.geminiApiKey);

  logger.info('Calling Gemini API', {
    model: modelName,
    temperature: config.llmTemperature,
  });
  
  try {
    const model = activeGenAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: config.llmTemperature,
        maxOutputTokens: config.llmMaxTokens,
        responseMimeType: 'application/json',
        responseSchema: JSON_SCHEMA_FOR_GEMINI as any,
      },
    });
    
    const result = await Promise.race([
      model.generateContent(systemPrompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`LLM timeout after ${MAIN_LLM_TIMEOUT_MS}ms`)), MAIN_LLM_TIMEOUT_MS)
      ),
    ]);
    const responseText = result.response.text();
    
    // Extract actual token usage from Gemini API response
    const usageMetadata = result.response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = usageMetadata?.candidatesTokenCount ?? 0;
    const totalTokens = usageMetadata?.totalTokenCount ?? (inputTokens + outputTokens);
    
    const endTime = Date.now();
    const durationMs = endTime - startTime;
    
    // Log full response for debugging newline issues
    logger.info('Gemini raw response (full)', {
      model: modelName,
      responseLength: responseText.length,
      durationMs,
      responsePreview: responseText.substring(0, 500), // First 500 chars
    });
    
    // Parse JSON response with robust error handling
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (jsonError: any) {
      // Try to fix common JSON issues (typically truncated output from maxOutputTokens)
      logger.warn('🔧 Attempting JSON recovery', {
        model: modelName,
        originalLength: responseText.length,
        error: jsonError.message,
      });

      let fixedText = responseText;
      let recovered = false;

      // Strategy 1: Try to repair truncated JSON by closing open structures
      try {
        fixedText = repairTruncatedJson(responseText);
        parsedResponse = JSON.parse(fixedText);
        recovered = true;
        logger.info('✅ JSON repaired via structure closing', { model: modelName });
      } catch (_e1) {
        // Strategy 2: Extract the largest valid JSON object
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsedResponse = JSON.parse(jsonMatch[0]);
            recovered = true;
            logger.info('✅ JSON extracted from response', { model: modelName });
          } catch (_e2) {
            // Try repairing the extracted JSON
            try {
              fixedText = repairTruncatedJson(jsonMatch[0]);
              parsedResponse = JSON.parse(fixedText);
              recovered = true;
              logger.info('✅ Extracted JSON repaired', { model: modelName });
            } catch (_e3) {
              // Strategy 3: Try to extract key fields with regex
              const intentMatch = responseText.match(/"intent"\s*:\s*"([^"]+)"/);
              const replyMatch = responseText.match(/"reply_text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
              if (intentMatch) {
                parsedResponse = {
                  intent: intentMatch[1],
                  fields: {},
                  reply_text: replyMatch ? replyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : 'Maaf, terjadi kesalahan teknis. Silakan ulangi pertanyaan Anda.',
                  guidance_text: '',
                  needs_knowledge: false,
                };
                recovered = true;
                logger.info('✅ Key fields extracted via regex', { model: modelName, intent: intentMatch[1] });
              }
            }
          }
        }
      }

      if (!recovered) {
        logger.error('❌ All JSON fixes failed, creating fallback response', {
          model: modelName,
          error: jsonError.message,
          responsePreview: responseText.substring(0, 300),
        });
        parsedResponse = {
          intent: 'UNKNOWN',
          fields: {},
          reply_text: 'Maaf, terjadi kesalahan teknis. Silakan ulangi pertanyaan Anda.',
          guidance_text: '',
          needs_knowledge: false,
        };
      }
    }
    
    // Sanitize "null" strings - Gemini sometimes returns "null" instead of empty string
    const sanitizeNullString = (value: any): any => {
      if (value === 'null' || value === 'NULL' || value === 'Null') return '';
      if (value === null || value === undefined) return undefined;
      return value;
    };
    
    // Clean up common fields that might have "null" string
    if (parsedResponse.guidance_text) {
      parsedResponse.guidance_text = sanitizeNullString(parsedResponse.guidance_text);
    }
    if (parsedResponse.fields) {
      if (parsedResponse.fields.rt_rw) {
        parsedResponse.fields.rt_rw = sanitizeNullString(parsedResponse.fields.rt_rw);
      }
      if (parsedResponse.fields.alamat) {
        parsedResponse.fields.alamat = sanitizeNullString(parsedResponse.fields.alamat);
      }
      if (parsedResponse.fields.deskripsi) {
        parsedResponse.fields.deskripsi = sanitizeNullString(parsedResponse.fields.deskripsi);
      }
      if (parsedResponse.fields.knowledge_category) {
        parsedResponse.fields.knowledge_category = sanitizeNullString(parsedResponse.fields.knowledge_category);
      }
      if (parsedResponse.fields.request_number) {
        parsedResponse.fields.request_number = sanitizeNullString(parsedResponse.fields.request_number);
      }
      // Clean up missing_info array - remove "null" strings
      if (parsedResponse.fields.missing_info && Array.isArray(parsedResponse.fields.missing_info)) {
        parsedResponse.fields.missing_info = parsedResponse.fields.missing_info
          .filter((item: any) => item !== 'null' && item !== 'NULL' && item !== null && item !== undefined);
      }
    }
    
    // Log parsed guidance_text specifically for newline debugging
    if (parsedResponse.guidance_text) {
      logger.info('Parsed guidance_text', {
        model: modelName,
        guidanceText: parsedResponse.guidance_text,
        hasNewlines: parsedResponse.guidance_text.includes('\n'),
        hasEscapedNewlines: parsedResponse.guidance_text.includes('\\n'),
      });
    }
    
    // Validate with Zod schema
    const validatedResponse = LLMResponseSchema.parse(parsedResponse);
    
    const metrics: LLMMetrics = {
      startTime,
      endTime,
      durationMs,
      model: modelName,
      inputTokens,
      outputTokens,
      totalTokens,
    };
    
    logger.info('✅ Gemini response parsed successfully', {
      model: modelName,
      intent: validatedResponse.intent,
      hasFields: Object.keys(validatedResponse.fields).length > 0,
      durationMs,
      inputTokens,
      outputTokens,
      totalTokens,
    });
    
    return {
      success: true,
      data: {
        response: validatedResponse,
        metrics,
      },
    };
  } catch (error: any) {
    const endTime = Date.now();
    const durationMs = endTime - startTime;
    
    logger.error('❌ Gemini API call failed', {
      model: modelName,
      error: error.message,
      durationMs,
    });
    
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Handle LLM errors - log and return null to indicate failure
 * Message will stay in pending queue for retry
 */
export function handleLLMError(error: any): null {
  logger.error('LLM error handler - message will be retried later', {
    errorType: error.constructor.name,
    message: error.message,
  });
  
  // Return null to signal failure - no response will be sent
  return null;
}
