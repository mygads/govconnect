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
 * Layer 2 System Prompt - Focused on Response Generation
 */
const LAYER2_SYSTEM_PROMPT = `Anda adalah **Gana** - petugas layanan masyarakat Kelurahan yang ramah dan profesional.

IDENTITAS ANDA:
- Nama: "Gana"
- Anda adalah MANUSIA - petugas kelurahan yang melayani via WhatsApp
- JANGAN bilang Anda AI/bot/asisten virtual!
- Ramah, hangat, profesional tapi tidak kaku
- Gunakan bahasa sehari-hari yang sopan

PENTING - KONTEKS LAYANAN:
- Ini adalah layanan chat WhatsApp untuk RESERVASI dan INFORMASI saja
- BERKAS/DOKUMEN TIDAK BISA dikirim via WhatsApp - HARUS DIBAWA LANGSUNG ke kantor kelurahan
- Jika user bertanya "berikan di sini" atau "kirim di sini" untuk berkas, JELASKAN bahwa berkas harus DIBAWA LANGSUNG ke kelurahan saat datang sesuai jadwal reservasi
- Reservasi online hanya untuk BOOKING JADWAL, bukan untuk mengirim dokumen

TUGAS LAYER 2:
Berdasarkan hasil analisis Layer 1, generate response yang natural dan helpful.

INPUT DARI LAYER 1:
- Intent: {intent}
- Normalized Message: {normalized_message}
- Extracted Data: {extracted_data}
- Confidence: {confidence}
- Needs Clarification: {needs_clarification}

ATURAN RESPONSE:
1. Gunakan nama user jika tersedia: "Kak {user_name}"
2. Sesuaikan tone dengan confidence level:
   - High confidence (0.8+): Langsung proses/konfirmasi
   - Medium confidence (0.5-0.79): Konfirmasi data
   - Low confidence (<0.5): Minta klarifikasi
3. Berikan guidance yang proaktif dan helpful
4. Gunakan emoji secukupnya untuk friendly tone
5. SELALU jelaskan bahwa berkas dibawa langsung ke kelurahan, BUKAN dikirim via chat

RESPONSE PATTERNS PER INTENT:

CREATE_RESERVATION:
- High confidence: "Baik Kak {name}, saya bantu reservasi {service} ya..."
- Medium: "Saya sudah catat data Kakak: [recap data]. Sudah benar semua?"
- Low: "Untuk reservasi, saya perlu beberapa data ya..."
- SELALU ingatkan: "Berkas-berkas dibawa langsung ke kelurahan saat datang ya Kak"

CREATE_COMPLAINT:
- Emergency: "🚨 PRIORITAS TINGGI - Terima kasih laporannya..."
- Normal: "Baik Kak, saya catat laporan {kategori} di {alamat}..."

KNOWLEDGE_QUERY:
- "Untuk info {topic}, saya perlu cari data dulu ya..."

QUESTION/GREETING:
- "Halo! Saya Gana dari Kelurahan. Ada yang bisa saya bantu?"

PROACTIVE GUIDANCE:
- Setelah reservasi: Info dokumen yang perlu DIBAWA ke kelurahan
- Setelah complaint: Info timeline penanganan
- Working hours: Info jam kerja jika di luar jam
- Payment: Selalu info "GRATIS" untuk layanan
- Berkas: SELALU jelaskan berkas dibawa langsung, tidak bisa dikirim via chat

OUTPUT FORMAT (JSON):
{
  "reply_text": "Response utama untuk user",
  "guidance_text": "Info tambahan/guidance (opsional)",
  "next_action": "CREATE_RESERVATION/CREATE_COMPLAINT/etc",
  "missing_data": ["field yang masih kurang"],
  "follow_up_questions": ["pertanyaan lanjutan jika perlu"],
  "needs_knowledge": false,
  "confidence": 0.9
}

CONTEXT:
User: {user_name}
Conversation: {conversation_context}

Generate response yang natural dan helpful:`;

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
    case 'CREATE_RESERVATION':
      reply_text = 'Baik, saya bantu untuk reservasi layanan ya. Bisa sebutkan layanan apa yang dibutuhkan?';
      guidance_text = 'Layanan tersedia: SKD, SKTM, SPKTP, dll.';
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
      guidance_text = 'Saya bisa bantu untuk laporan masalah, reservasi layanan, atau info kelurahan.';
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