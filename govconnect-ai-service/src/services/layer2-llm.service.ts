/**
 * Layer 2 LLM Service - Response Generation Layer
 * 
 * Purpose: Generate natural, helpful responses based on clean intent and data from Layer 1
 * Uses larger, more capable models for better conversation quality
 * 
 * Responsibilities:
 * - Natural response generation
 * - Conversation flow management
 * - Data validation & confirmation
 * - Proactive guidance
 * - Error handling
 */

import logger from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';
import { Layer1Output } from './layer1-llm.service';
import { modelStatsService } from './model-stats.service';

// Layer 2 uses larger, more capable models for better responses
const LAYER2_MODEL_PRIORITY = [
  'gemini-2.5-flash',         // Best balance of quality and cost
  'gemini-2.0-flash',         // Backup good model
  'gemini-2.5-flash-lite',    // Fallback if needed
];

export interface Layer2Input {
  layer1_output: Layer1Output;
  wa_user_id: string;
  conversation_context?: string;
  user_name?: string;
}

export interface Layer2Output {
  reply_text: string;
  guidance_text?: string;
  next_action?: string;
  missing_data: string[];
  follow_up_questions: string[];
  needs_knowledge: boolean;
  confidence: number;
}

/**
 * Layer 2 System Prompt - OPTIMIZED VERSION
 * Focused on Natural Response Generation
 * 
 * CHANGES FROM ORIGINAL:
 * - Removed redundant intent classification details (Layer 1 handles this)
 * - Removed data extraction patterns (Layer 1 handles this)
 * - Focused purely on response generation and personality
 * - Reduced from ~100 lines to ~60 lines (40% reduction)
 */
const LAYER2_SYSTEM_PROMPT = `You are **Gana** - a friendly government service officer at Kelurahan.

IDENTITY:
- Name: "Gana"
- You are HUMAN - a kelurahan officer serving via WhatsApp
- NEVER say you're AI/bot/virtual assistant!
- Friendly, warm, professional but not stiff
- Use everyday polite Indonesian language

CRITICAL RULES:
1. DON'T fabricate data (addresses, phone numbers, info not in knowledge)
2. Documents CANNOT be sent via chat - MUST be brought directly to office
3. Use \\n for line breaks
4. Output ONLY valid JSON
5. Always explain documents must be brought in person, NOT sent via chat

YOUR TASK:
Generate natural, helpful responses based on Layer 1 analysis.

LAYER 1 INPUT:
- Intent: {intent}
- Normalized Message: {normalized_message}
- Extracted Data: {extracted_data}
- Confidence: {confidence}
- Needs Clarification: {needs_clarification}

RESPONSE STRATEGY BY CONFIDENCE:
- High (0.8+): Process directly or confirm
- Medium (0.5-0.79): Confirm data with user
- Low (<0.5): Ask for clarification

TONE GUIDELINES:
- Use user's name if available: "Kak {name}"
- Use emojis moderately for friendly tone
- Be proactive - offer concrete options
- After answering - offer additional help

PROACTIVE GUIDANCE:
- After service request: Remind to check status & bring documents to office
- After complaint: Explain handling timeline
- Outside hours: Mention office hours
- Payment: Always mention "FREE" for services
- Documents: ALWAYS explain must be brought in person

OUTPUT (JSON):
{
  "reply_text": "Main response for user",
  "guidance_text": "Additional info (optional, empty string if not needed)",
  "next_action": "CREATE_SERVICE_REQUEST/CREATE_COMPLAINT/UPDATE_COMPLAINT/etc",
  "missing_data": ["fields still needed"],
  "follow_up_questions": ["follow-up questions if needed"],
  "needs_knowledge": false,
  "confidence": 0.9
}

CONTEXT:
User: {user_name}
Conversation: {conversation_context}

Generate natural and helpful response:`;

/**
 * Call Layer 2 LLM for response generation
 */
export async function callLayer2LLM(input: Layer2Input): Promise<Layer2Output | null> {
  const startTime = Date.now();
  
  logger.info('💬 Layer 2 LLM call started', {
    wa_user_id: input.wa_user_id,
    intent: input.layer1_output.intent,
    confidence: input.layer1_output.confidence,
    models: LAYER2_MODEL_PRIORITY,
  });

  // Build prompt with Layer 1 results
  const prompt = LAYER2_SYSTEM_PROMPT
    .replace('{intent}', input.layer1_output.intent)
    .replace('{normalized_message}', input.layer1_output.normalized_message)
    .replace('{extracted_data}', JSON.stringify(input.layer1_output.extracted_data, null, 2))
    .replace('{confidence}', input.layer1_output.confidence.toString())
    .replace('{needs_clarification}', JSON.stringify(input.layer1_output.needs_clarification))
    .replace('{user_name}', input.user_name || 'Kak')
    .replace('{conversation_context}', input.conversation_context || 'Percakapan baru');

  // Try models in priority order (best quality first)
  for (let i = 0; i < LAYER2_MODEL_PRIORITY.length; i++) {
    const model = LAYER2_MODEL_PRIORITY[i];
    
    try {
      logger.info('🔄 Layer 2 attempting model', {
        wa_user_id: input.wa_user_id,
        model,
        attempt: i + 1,
      });

      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      const geminiModel = genAI.getGenerativeModel({ 
        model,
        generationConfig: {
          temperature: 0.7, // Higher temperature for more natural responses
          maxOutputTokens: 2000, // Larger output for Layer 2
        }
      });

      const result = await geminiModel.generateContent(prompt);
      const responseText = result.response.text();
      
      // Parse JSON response
      let parsedResponse: Layer2Output;
      try {
        // Clean response (remove markdown code blocks if present)
        const cleanedResponse = responseText
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        
        parsedResponse = JSON.parse(cleanedResponse);
      } catch (parseError) {
        logger.warn('Layer 2 JSON parse failed, trying repair', {
          wa_user_id: input.wa_user_id,
          model,
          error: parseError,
        });
        
        // Try to repair JSON
        const repairedJson = repairLayer2JSON(responseText);
        if (repairedJson) {
          parsedResponse = repairedJson;
        } else {
          throw new Error('JSON parsing failed completely');
        }
      }

      // Validate response structure
      if (!parsedResponse.reply_text) {
        throw new Error('Invalid response structure - missing reply_text');
      }

      const durationMs = Date.now() - startTime;
      
      // Record success in model stats
      modelStatsService.recordSuccess(model, durationMs);
      
      logger.info('✅ Layer 2 LLM success', {
        wa_user_id: input.wa_user_id,
        model,
        replyLength: parsedResponse.reply_text.length,
        hasGuidance: !!parsedResponse.guidance_text,
        confidence: parsedResponse.confidence,
        durationMs,
      });

      return parsedResponse;
      
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      
      // Record failure in model stats
      modelStatsService.recordFailure(model, error.message, durationMs);
      
      logger.warn('❌ Layer 2 model failed', {
        wa_user_id: input.wa_user_id,
        model,
        attempt: i + 1,
        error: error.message,
      });
      
      // If this is the last model, return null
      if (i === LAYER2_MODEL_PRIORITY.length - 1) {
        logger.error('🚨 All Layer 2 models failed', {
          wa_user_id: input.wa_user_id,
          totalAttempts: LAYER2_MODEL_PRIORITY.length,
        });
        return null;
      }
      
      // Continue to next model
      continue;
    }
  }

  return null;
}

/**
 * Repair malformed JSON from Layer 2 LLM
 */
function repairLayer2JSON(responseText: string): Layer2Output | null {
  try {
    // Log the original response for debugging
    logger.debug('Attempting to repair Layer 2 JSON', {
      originalResponse: responseText.substring(0, 200) + '...',
    });

    // Common repairs
    let repaired = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/,\s*}/g, '}')  // Remove trailing commas
      .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
      .replace(/"\s*:\s*"/g, '": "')  // Fix spacing around colons
      .replace(/"\s*,\s*"/g, '", "')  // Fix spacing around commas
      .replace(/\n/g, ' ')  // Remove newlines
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .trim();

    // Try to find JSON object (more robust pattern)
    const jsonMatch = repaired.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
    if (jsonMatch) {
      repaired = jsonMatch[0];
    }

    // Additional repairs for common issues
    repaired = repaired
      .replace(/([{,]\s*)"([^"]+)"\s*:\s*([^",}\]]+)([,}])/g, '$1"$2": "$3"$4')  // Quote unquoted values
      .replace(/([{,]\s*)"([^"]+)"\s*:\s*(true|false|null|\d+)([,}])/g, '$1"$2": $3$4')  // Don't quote booleans/numbers/null
      .replace(/,(\s*[}\]])/g, '$1');  // Remove trailing commas before closing

    const parsed = JSON.parse(repaired);
    
    // Ensure required fields exist
    if (!parsed.reply_text) parsed.reply_text = 'Ada yang bisa saya bantu?';
    if (!parsed.guidance_text) parsed.guidance_text = '';
    if (!parsed.next_action) parsed.next_action = '';
    if (!Array.isArray(parsed.missing_data)) parsed.missing_data = [];
    if (!Array.isArray(parsed.follow_up_questions)) parsed.follow_up_questions = [];
    if (typeof parsed.needs_knowledge !== 'boolean') parsed.needs_knowledge = false;
    if (typeof parsed.confidence !== 'number') parsed.confidence = 0.7;

    return parsed as Layer2Output;
  } catch (error) {
    logger.error('Layer 2 JSON repair failed completely', { error });
    return null;
  }
}

/**
 * Generate fallback response when Layer 2 fails
 */
export function generateFallbackResponse(layer1Output: Layer1Output): Layer2Output {
  const intent = layer1Output.intent;
  const confidence = layer1Output.confidence;
  
  let reply_text = 'Ada yang bisa saya bantu?';
  let guidance_text = '';
  let next_action = intent;
  
  // Generate basic response based on intent
  switch (intent) {
    case 'CREATE_SERVICE_REQUEST':
      reply_text = 'Baik, saya bantu untuk permohonan layanan ya. Bisa sebutkan layanan apa yang dibutuhkan?';
      guidance_text = 'Saya bisa kirimkan link formulir layanan setelah Kakak sebutkan layanannya.';
      break;
      
    case 'CREATE_COMPLAINT':
      reply_text = 'Baik, saya bantu untuk laporan masalah. Bisa jelaskan masalah apa dan di mana lokasinya?';
      break;
      
    case 'KNOWLEDGE_QUERY':
      reply_text = 'Saya cari informasi yang Kakak butuhkan ya.';
      next_action = 'KNOWLEDGE_QUERY';
      break;
      
    case 'QUESTION':
      reply_text = 'Halo! Saya Gana dari Kelurahan. Ada yang bisa saya bantu hari ini?';
      guidance_text = 'Saya bisa bantu untuk laporan masalah, ajukan layanan, atau info kelurahan.';
      break;
      
    default:
      reply_text = 'Maaf, saya kurang memahami maksud Kakak. Bisa dijelaskan lagi?';
  }
  
  return {
    reply_text,
    guidance_text,
    next_action,
    missing_data: layer1Output.needs_clarification,
    follow_up_questions: [],
    needs_knowledge: intent === 'KNOWLEDGE_QUERY',
    confidence: Math.max(0.5, confidence), // Minimum confidence for fallback
  };
}