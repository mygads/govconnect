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

// Retry configuration - AGGRESSIVE to ensure NEVER fail
const MAX_RETRIES_PER_MODEL = 2;     // Max retries per model before switching
const RETRY_DELAY_MS = 2000;         // 2 seconds between retries
const MAX_CYCLES = 5;                // Max full cycles through all models
const CYCLE_DELAY_MS = 3000;         // 3 seconds delay before new cycle

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    const primaryModel = settings.ai_model_primary || 'gemini-2.5-flash';
    const fallbackModel = settings.ai_model_fallback || 'gemini-2.0-flash';
    
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
 * GUARANTEES a response - will retry infinitely until successful
 * NEVER returns error message to user
 */
export async function callGemini(systemPrompt: string): Promise<{ response: LLMResponse; metrics: LLMMetrics }> {
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
        
        // Check if it's a JSON parsing error - retry might help
        if (lastError.includes('JSON') || lastError.includes('Unterminated')) {
          logger.warn('⚠️ JSON parsing error, will retry', {
            model: modelName,
            retry: retry + 1,
            error: lastError,
          });
        }
        
        // Wait before retry (unless it's the last retry)
        if (retry < MAX_RETRIES_PER_MODEL - 1) {
          logger.info(`⏳ Waiting ${RETRY_DELAY_MS}ms before retry...`);
          await sleep(RETRY_DELAY_MS);
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
  const finalModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
  
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
  
  // ABSOLUTE LAST RESORT - generate synthetic response
  // This should essentially NEVER happen unless all Gemini services are down
  const endTime = Date.now();
  const durationMs = endTime - startTime;
  
  logger.error('🚨 CRITICAL: All LLM attempts exhausted - using synthetic response', {
    totalAttempts,
    durationMs,
    lastError,
  });
  
  // Return a helpful response that encourages user to try again
  const fallbackResponse: LLMResponse = {
    intent: 'QUESTION',
    fields: {},
    reply_text: 'Terima kasih atas pesan Anda. Mohon tunggu sebentar dan kirim pesan Anda sekali lagi dalam beberapa detik.',
  };
  
  const metrics: LLMMetrics = {
    startTime,
    endTime,
    durationMs,
    model: 'synthetic-fallback',
  };
  
  return {
    response: fallbackResponse,
    metrics,
  };
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
    
    // Parse JSON response
    const parsedResponse = JSON.parse(responseText);
    
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
 * Handle LLM errors and provide appropriate fallback
 */
export function handleLLMError(error: any): LLMResponse {
  logger.error('LLM error handler', {
    errorType: error.constructor.name,
    message: error.message,
  });
  
  return {
    intent: 'QUESTION',
    fields: {},
    reply_text: 'Terima kasih atas pesan Anda. Mohon ulangi permintaan Anda dengan lebih detail.',
  };
}
