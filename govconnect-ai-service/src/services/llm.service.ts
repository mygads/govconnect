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
import { apiKeyManager, MODEL_FALLBACK_ORDER_PAID, MAX_RETRIES_PER_MODEL } from './api-key-manager.service';

// Timeout for main LLM calls (30 seconds)
const MAIN_LLM_TIMEOUT_MS = 30_000;

// Retry configuration
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5000;
const JSON_RETRY_EXTRA_DELAY_MS = 500;

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
      // Try to fix common JSON issues
      let fixedText = responseText;
      
      // Fix unterminated strings by finding and closing them
      if (jsonError.message.includes('Unterminated string')) {
        logger.warn('🔧 Attempting to fix unterminated string in JSON', {
          model: modelName,
          originalLength: responseText.length,
          error: jsonError.message,
        });
        
        // Find the last quote and add closing quote if needed
        const lastQuoteIndex = fixedText.lastIndexOf('"');
        const lastBraceIndex = fixedText.lastIndexOf('}');
        
        if (lastQuoteIndex > lastBraceIndex) {
          // There's an unterminated string, try to close it
          fixedText = fixedText + '"';
          
          // Also ensure proper JSON structure
          if (!fixedText.endsWith('}')) {
            fixedText = fixedText + '}';
          }
        }
        
        // Try parsing the fixed text
        try {
          parsedResponse = JSON.parse(fixedText);
          logger.info('✅ Successfully fixed unterminated string', {
            model: modelName,
            fixedLength: fixedText.length,
          });
        } catch (secondError: any) {
          // If still fails, try more aggressive fixes
          logger.warn('🔧 Attempting more aggressive JSON fixes', {
            model: modelName,
            secondError: secondError.message,
          });
          
          // Try to extract just the JSON part if there's extra text
          const jsonMatch = fixedText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              parsedResponse = JSON.parse(jsonMatch[0]);
              logger.info('✅ Successfully extracted and parsed JSON', {
                model: modelName,
              });
            } catch (thirdError: any) {
              // Last resort: create a fallback response
              logger.error('❌ All JSON fixes failed, creating fallback response', {
                model: modelName,
                originalError: jsonError.message,
                secondError: secondError.message,
                thirdError: thirdError.message,
              });
              
              parsedResponse = {
                intent: 'UNKNOWN',
                fields: {},
                reply_text: 'Maaf, terjadi kesalahan teknis. Silakan ulangi pertanyaan Anda.',
                guidance_text: '',
                needs_knowledge: false,
              };
            }
          } else {
            // No JSON found, create fallback
            parsedResponse = {
              intent: 'UNKNOWN',
              fields: {},
              reply_text: 'Maaf, terjadi kesalahan teknis. Silakan ulangi pertanyaan Anda.',
              guidance_text: '',
              needs_knowledge: false,
            };
          }
        }
      } else {
        // Other JSON errors, create fallback response
        logger.error('❌ JSON parsing failed, creating fallback response', {
          model: modelName,
          error: jsonError.message,
          responsePreview: responseText.substring(0, 200),
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
