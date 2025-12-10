/**
 * LLM Service - Handles Gemini API calls with ROBUST retry mechanism
 * 
 * Features:
 * - Primary/Fallback model from Dashboard Settings
 * - Dynamic model priority based on success rates (tracked in model-stats.service)
 * - Infinite retry (NEVER returns error to user)
 * - Model usage statistics tracking
 * - Automatic model switching on failure
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';
import { config } from '../config/env';
import { LLMResponse, LLMResponseSchema, LLMMetrics } from '../types/llm-response.types';
import { JSON_SCHEMA_FOR_GEMINI } from '../prompts/system-prompt';
import { modelStatsService } from './model-stats.service';
import { getSettings } from './settings.service';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

// Available models pool - December 2025
// Models are sorted by: 1) Dashboard settings (primary first), 2) Success rate
// https://ai.google.dev/pricing
const AVAILABLE_MODELS = [
  'gemini-2.5-flash',         // Hybrid reasoning, 1M context, $0.30/$2.50 per 1M tokens
  'gemini-2.5-flash-lite',    // Smallest, cost-efficient, $0.10/$0.40 per 1M tokens
  'gemini-2.0-flash',         // Balanced multimodal, 1M context, $0.10/$0.40 per 1M tokens
  'gemini-2.0-flash-lite',    // Legacy cost-efficient, $0.075/$0.30 per 1M tokens
];

// Model pricing reference per 1M tokens (USD) - December 2025:
// ┌─────────────────────────┬──────────┬───────────┬─────────────────────────────────────┐
// │ Model                   │ Input    │ Output    │ Description                         │
// ├─────────────────────────┼──────────┼───────────┼─────────────────────────────────────┤
// │ gemini-2.5-flash        │ $0.30    │ $2.50     │ Hybrid reasoning, thinking budget   │
// │ gemini-2.5-flash-lite   │ $0.10    │ $0.40     │ Smallest, high throughput           │
// │ gemini-2.0-flash        │ $0.10    │ $0.40     │ Balanced multimodal                 │
// │ gemini-2.0-flash-lite   │ $0.075   │ $0.30     │ Legacy cost-efficient               │
// └─────────────────────────┴──────────┴───────────┴─────────────────────────────────────┘
//
// All models support: Structured output ✓, Function calling ✓
// 2.5 models also support: Thinking/Reasoning ✓

// Retry configuration - Optimized for efficiency
// Layer 1: 4 models × 2 retries × 1 cycle = 8 attempts MAX
// If all fail, message goes to Layer 2 retry queue (cron every 10 min)
const MAX_RETRIES_PER_MODEL = 2;     // Max retries per model before switching
const BASE_RETRY_DELAY_MS = 1000;    // Base delay for exponential backoff (1 second)
const MAX_RETRY_DELAY_MS = 5000;     // Max delay cap (5 seconds)
const MAX_CYCLES = 1;                // Only 1 cycle through all models
const CYCLE_DELAY_MS = 2000;         // 2 seconds delay (not used with 1 cycle)
const JSON_RETRY_EXTRA_DELAY_MS = 500; // Extra delay for JSON parsing errors

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
 * Get dynamically sorted model priority based on:
 * 1. Dashboard settings (primary model first, then fallback)
 * 2. Success rates from model stats
 */
async function getModelPriority(): Promise<string[]> {
  try {
    // Get settings from dashboard
    const settings = await getSettings();
    // Default ke gemini-2.0-flash yang lebih stabil untuk JSON output
    const primaryModel = settings.ai_model_primary || 'gemini-2.0-flash';
    const fallbackModel = settings.ai_model_fallback || 'gemini-2.0-flash-lite';
    
    // Build priority list: primary first, then fallback, then others
    const priorityModels: string[] = [];
    
    // Add primary if it's in available models
    if (AVAILABLE_MODELS.includes(primaryModel)) {
      priorityModels.push(primaryModel);
    }
    
    // Add fallback if different from primary and in available models
    if (fallbackModel !== primaryModel && AVAILABLE_MODELS.includes(fallbackModel)) {
      priorityModels.push(fallbackModel);
    }
    
    // Add remaining models sorted by success rate
    const remainingModels = AVAILABLE_MODELS.filter(m => !priorityModels.includes(m));
    const sortedRemaining = modelStatsService.getModelPriority(remainingModels);
    
    const finalPriority = [...priorityModels, ...sortedRemaining];
    
    logger.debug('📊 Model priority calculated', {
      primary: primaryModel,
      fallback: fallbackModel,
      priority: finalPriority,
    });
    
    return finalPriority;
  } catch (error) {
    logger.warn('⚠️ Failed to get settings, using default priority', { error });
    return modelStatsService.getModelPriority(AVAILABLE_MODELS);
  }
}

/**
 * Call Gemini with structured JSON output
 * Returns null if all models fail - message will stay in pending queue for retry
 * NEVER returns error message to user
 */
export async function callGemini(systemPrompt: string): Promise<{ response: LLMResponse; metrics: LLMMetrics } | null> {
  const startTime = Date.now();
  let totalAttempts = 0;
  let lastError: string = '';
  
  // Get dynamically sorted model priority based on settings and success rates
  let modelPriority = await getModelPriority();
  
  logger.info('🎯 Starting LLM call with dynamic model priority', {
    priority: modelPriority,
  });
  
  // Multiple cycles through all models
  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    if (cycle > 0) {
      logger.warn(`🔄 Starting model cycle ${cycle + 1}/${MAX_CYCLES}`, {
        waitTime: CYCLE_DELAY_MS,
      });
      await sleep(CYCLE_DELAY_MS);
      
      // Re-fetch priority (might have changed based on recent failures)
      modelPriority = await getModelPriority();
      logger.info('📊 Updated model priority for new cycle', {
        priority: modelPriority,
      });
    }
    
    // Try each model with retries
    for (const modelName of modelPriority) {
      for (let retry = 0; retry < MAX_RETRIES_PER_MODEL; retry++) {
        totalAttempts++;
        
        logger.info('🔄 Attempting LLM call', {
          model: modelName,
          retry: retry + 1,
          cycle: cycle + 1,
          totalAttempts,
        });
        
        const callStartTime = Date.now();
        const result = await callGeminiWithModel(systemPrompt, modelName, startTime);
        const callDuration = Date.now() - callStartTime;
        
        if (result.success && result.data) {
          // Record success in stats
          modelStatsService.recordSuccess(modelName, callDuration);
          
          logger.info('✅ LLM call successful', {
            model: modelName,
            totalAttempts,
            durationMs: callDuration,
          });
          
          return result.data;
        }
        
        lastError = result.error || 'Unknown error';
        
        // Record failure in stats
        modelStatsService.recordFailure(modelName, lastError, callDuration);
        
        // Check if it's a model not found error - skip retries for this model
        if (lastError.includes('404') || lastError.includes('not found') || lastError.includes('not supported')) {
          logger.warn('⚠️ Model not available, skipping to next model', {
            model: modelName,
            error: lastError,
          });
          break; // Skip retries, move to next model
        }
        
        // Calculate backoff delay based on retry attempt
        const isJsonError = lastError.includes('JSON') || lastError.includes('Unterminated') || lastError.includes('parsing');
        const backoffDelay = calculateBackoffDelay(retry);
        const actualDelay = isJsonError ? backoffDelay + JSON_RETRY_EXTRA_DELAY_MS : backoffDelay;
        
        if (isJsonError) {
          logger.warn('⚠️ JSON parsing error, will retry with backoff', {
            model: modelName,
            retry: retry + 1,
            error: lastError,
            backoffDelay: actualDelay,
          });
        }
        
        // Wait before retry with exponential backoff (unless it's the last retry)
        if (retry < MAX_RETRIES_PER_MODEL - 1) {
          logger.info(`⏳ Waiting ${actualDelay}ms before retry (exponential backoff)...`, {
            attempt: retry + 1,
            delay: actualDelay,
          });
          await sleep(actualDelay);
        }
      }
    }
  }
  
  // All cycles exhausted - do one final attempt with the most stable model
  logger.error('❌ All model cycles exhausted, doing final fallback', {
    totalAttempts,
    lastError,
  });
  
  // Final attempt sequence with longer delays - prioritize most reliable models
  const finalModels = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash-lite'];
  
  for (const model of finalModels) {
    await sleep(5000); // Wait 5 seconds
    
    logger.info('🆘 Final fallback attempt', { model });
    
    const callStartTime = Date.now();
    const finalResult = await callGeminiWithModel(systemPrompt, model, startTime);
    const callDuration = Date.now() - callStartTime;
    
    if (finalResult.success && finalResult.data) {
      modelStatsService.recordSuccess(model, callDuration);
      return finalResult.data;
    }
    
    modelStatsService.recordFailure(model, finalResult.error || 'Final fallback failed', callDuration);
  }
  
  // ABSOLUTE LAST RESORT - all models failed
  // Return null to indicate failure - message will stay in pending queue for retry later
  const endTime = Date.now();
  const durationMs = endTime - startTime;
  
  logger.error('🚨 CRITICAL: All LLM attempts exhausted - message will be retried later', {
    totalAttempts,
    durationMs,
    lastError,
  });
  
  // Return null to signal failure - no response will be sent
  // Message stays in pending queue and will be retried by cron job
  return null;
}

/**
 * Internal function to call Gemini with a specific model
 */
async function callGeminiWithModel(
  systemPrompt: string, 
  modelName: string, 
  startTime: number
): Promise<{ success: boolean; data?: { response: LLMResponse; metrics: LLMMetrics }; error?: string }> {
  logger.info('Calling Gemini API', {
    model: modelName,
    temperature: config.llmTemperature,
  });
  
  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: config.llmTemperature,
        maxOutputTokens: config.llmMaxTokens,
        responseMimeType: 'application/json',
        responseSchema: JSON_SCHEMA_FOR_GEMINI as any,
      },
    });
    
    const result = await model.generateContent(systemPrompt);
    const responseText = result.response.text();
    
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
      if (parsedResponse.fields.reservation_id) {
        parsedResponse.fields.reservation_id = sanitizeNullString(parsedResponse.fields.reservation_id);
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
    };
    
    logger.info('✅ Gemini response parsed successfully', {
      model: modelName,
      intent: validatedResponse.intent,
      hasFields: Object.keys(validatedResponse.fields).length > 0,
      durationMs,
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
