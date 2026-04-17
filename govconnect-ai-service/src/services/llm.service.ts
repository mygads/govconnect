/**
 * LLM Service - gateway only.
 *
 * All chat completion traffic now goes through the configured AI gateway lane.
 * There is no direct Gemini/OpenAI provider path in the application anymore.
 */

import logger from '../utils/logger';
import { config } from '../config/env';
import { LLMResponse, LLMResponseSchema, LLMMetrics } from '../types/llm-response.types';
import { buildPromptMessages, callAIGatewayPrompt, getDefaultGatewayModels } from './ai-gateway.service';

/**
 * Repair truncated JSON by closing all open structures.
 * Handles truncated strings, arrays, and objects.
 */
function repairTruncatedJson(text: string): string {
  let result = text.trim();

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

  if (inString) {
    result += '"';
  }

  result = result.replace(/,\s*$/, '');

  while (stack.length > 0) {
    result += stack.pop();
  }

  return result;
}

function sanitizeNullString(value: any): any {
  if (value === 'null' || value === 'NULL' || value === 'Null') return '';
  if (value === null || value === undefined) return undefined;
  return value;
}

function parseLLMResponseText(responseText: string, modelName: string): LLMResponse {
  let parsedResponse;

  try {
    parsedResponse = JSON.parse(responseText);
  } catch (jsonError: any) {
    logger.warn('Attempting JSON recovery for gateway response', {
      model: modelName,
      originalLength: responseText.length,
      error: jsonError.message,
    });

    let fixedText = responseText;
    let recovered = false;

    try {
      fixedText = repairTruncatedJson(responseText);
      parsedResponse = JSON.parse(fixedText);
      recovered = true;
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedResponse = JSON.parse(jsonMatch[0]);
          recovered = true;
        } catch {
          try {
            fixedText = repairTruncatedJson(jsonMatch[0]);
            parsedResponse = JSON.parse(fixedText);
            recovered = true;
          } catch {
            const intentMatch = responseText.match(/"intent"\s*:\s*"([^"]+)"/);
            const replyMatch = responseText.match(/"reply_text"\s*:\s*"((?:[^"\\]|\\.)*)"/);

            if (intentMatch) {
              parsedResponse = {
                intent: intentMatch[1],
                fields: {},
                reply_text: replyMatch
                  ? replyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
                  : 'Maaf, terjadi kesalahan teknis. Silakan ulangi pertanyaan Anda.',
                guidance_text: '',
                needs_knowledge: false,
              };
              recovered = true;
            }
          }
        }
      }
    }

    if (!recovered) {
      logger.error('All JSON recovery strategies failed, using fallback response', {
        model: modelName,
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

  if (parsedResponse.guidance_text) {
    parsedResponse.guidance_text = sanitizeNullString(parsedResponse.guidance_text);
  }
  if (parsedResponse.fields) {
    if (parsedResponse.fields.rt_rw) parsedResponse.fields.rt_rw = sanitizeNullString(parsedResponse.fields.rt_rw);
    if (parsedResponse.fields.alamat) parsedResponse.fields.alamat = sanitizeNullString(parsedResponse.fields.alamat);
    if (parsedResponse.fields.deskripsi) parsedResponse.fields.deskripsi = sanitizeNullString(parsedResponse.fields.deskripsi);
    if (parsedResponse.fields.knowledge_category) parsedResponse.fields.knowledge_category = sanitizeNullString(parsedResponse.fields.knowledge_category);
    if (parsedResponse.fields.request_number) parsedResponse.fields.request_number = sanitizeNullString(parsedResponse.fields.request_number);
    if (parsedResponse.fields.missing_info && Array.isArray(parsedResponse.fields.missing_info)) {
      parsedResponse.fields.missing_info = parsedResponse.fields.missing_info
        .filter((item: any) => item !== 'null' && item !== 'NULL' && item !== null && item !== undefined);
    }
  }

  return LLMResponseSchema.parse(parsedResponse);
}

export async function callLLM(systemPrompt: string): Promise<{ response: LLMResponse; metrics: LLMMetrics } | null> {
  const envModels = getDefaultGatewayModels('full');

  const gatewayResult = await callAIGatewayPrompt({
    lane: 'llm',
    modelPriority: envModels,
    messages: buildPromptMessages(systemPrompt),
    temperature: config.llmTemperature,
    maxTokens: config.llmMaxTokens,
    timeoutMs: config.llmGateway.timeoutMs,
    jsonMode: true,
  });

  if (!gatewayResult) {
    logger.error('Full NLU gateway call exhausted for all configured models');
    return null;
  }

  logger.info('AI gateway raw response (full)', {
    provider: gatewayResult.provider,
    model: gatewayResult.model,
    responseLength: gatewayResult.text.length,
    durationMs: gatewayResult.metrics.durationMs,
    responsePreview: gatewayResult.text.substring(0, 500),
  });

  try {
    return {
      response: parseLLMResponseText(gatewayResult.text, gatewayResult.model),
      metrics: gatewayResult.metrics,
    };
  } catch (error: any) {
    logger.error('Gateway response validation failed', {
      provider: gatewayResult.provider,
      model: gatewayResult.model,
      error: error.message,
    });
    return null;
  }
}

export function handleLLMError(error: any): null {
  logger.error('LLM error handler - message will be retried later', {
    errorType: error.constructor?.name,
    message: error.message,
  });

  return null;
}
