import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';
import { config } from '../config/env';
import { LLMResponse, LLMResponseSchema, LLMMetrics } from '../types/llm-response.types';
import { JSON_SCHEMA_FOR_GEMINI } from '../prompts/system-prompt';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

/**
 * Call Gemini with structured JSON output
 */
export async function callGemini(systemPrompt: string): Promise<{ response: LLMResponse; metrics: LLMMetrics }> {
  const startTime = Date.now();
  
  logger.info('Calling Gemini API', {
    model: config.llmModel,
    temperature: config.llmTemperature,
  });
  
  try {
    const model = genAI.getGenerativeModel({
      model: config.llmModel,
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
    
    logger.debug('Gemini raw response', {
      responseLength: responseText.length,
      durationMs,
    });
    
    // Parse JSON response
    const parsedResponse = JSON.parse(responseText);
    
    // Validate with Zod schema
    const validatedResponse = LLMResponseSchema.parse(parsedResponse);
    
    const metrics: LLMMetrics = {
      startTime,
      endTime,
      durationMs,
      model: config.llmModel,
    };
    
    logger.info('✅ Gemini response parsed successfully', {
      intent: validatedResponse.intent,
      hasFields: Object.keys(validatedResponse.fields).length > 0,
      durationMs,
    });
    
    return {
      response: validatedResponse,
      metrics,
    };
  } catch (error: any) {
    const endTime = Date.now();
    const durationMs = endTime - startTime;
    
    logger.error('❌ Gemini API call failed', {
      error: error.message,
      durationMs,
    });
    
    // Return fallback response
    const fallbackResponse: LLMResponse = {
      intent: 'UNKNOWN',
      fields: {},
      reply_text: 'Maaf, saya sedang mengalami gangguan. Mohon coba lagi dalam beberapa saat atau hubungi staf kelurahan langsung.',
    };
    
    const metrics: LLMMetrics = {
      startTime,
      endTime,
      durationMs,
      model: config.llmModel,
    };
    
    return {
      response: fallbackResponse,
      metrics,
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
    intent: 'UNKNOWN',
    fields: {},
    reply_text: 'Maaf, terjadi kesalahan saat memproses pesan Anda. Silakan coba lagi atau hubungi layanan pelanggan.',
  };
}
