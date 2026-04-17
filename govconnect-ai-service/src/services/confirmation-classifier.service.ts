import logger from '../utils/logger';
import { buildPromptMessages, callAIGatewayPrompt, getDefaultGatewayModels, isAIGatewayEnabled } from './ai-gateway.service';

export type ConfirmationDecision = 'CONFIRM' | 'REJECT' | 'UNCERTAIN';

export interface ConfirmationResult {
  decision: ConfirmationDecision;
  confidence: number;
  reason?: string;
}

const CONFIRMATION_MODEL_PRIORITY = getDefaultGatewayModels('micro');

// Timeout for micro LLM calls (10 seconds)
const MICRO_LLM_TIMEOUT_MS = 10_000;

const CONFIRMATION_SYSTEM_PROMPT = `Anda adalah classifier konfirmasi untuk layanan publik.

KONTEKS:
Sistem baru saja menampilkan informasi layanan dan bertanya apakah user ingin DIKIRIMI LINK FORMULIR ONLINE untuk mengajukan layanan tersebut.

TUGAS:
- HANYA klasifikasikan sebagai CONFIRM jika user SECARA EKSPLISIT mau dikirimi link formulir SEKARANG.
- Klasifikasikan sebagai REJECT jika user menolak, menunda, atau sudah puas dengan info saja.
- Klasifikasikan sebagai UNCERTAIN jika ambigu.

ATURAN PENTING:
- "oke makasih", "terima kasih", "baik terima kasih", "makasih" → REJECT (ucapan terima kasih = sudah puas, tidak minta link)
- "oke nanti saya isi", "nanti saya isi" → REJECT (penundaan)
- "oke baik", "siap" tanpa permintaan eksplisit → UNCERTAIN (ambigu)
- "iya mau", "iya kirim", "boleh", "mau dong" → CONFIRM (eksplisit minta)
- "mana linknya?", "kirim link", "formnya mana" → CONFIRM (minta link)
- "tidak", "nanti dulu", "belum", "batal", "gak jadi" → REJECT

OUTPUT (JSON saja):
{
  "decision": "CONFIRM|REJECT|UNCERTAIN",
  "confidence": 0.0-1.0,
  "reason": "short"
}

CONTOH:
Input: "iya mau" -> {"decision":"CONFIRM","confidence":0.95,"reason":"explicit yes"}
Input: "mana linknya?" -> {"decision":"CONFIRM","confidence":0.92,"reason":"asks link"}
Input: "oke makasih" -> {"decision":"REJECT","confidence":0.9,"reason":"thanking, satisfied"}
Input: "nanti saya isi" -> {"decision":"REJECT","confidence":0.9,"reason":"postpone"}
Input: "baik terima kasih" -> {"decision":"REJECT","confidence":0.9,"reason":"thanking, closing"}
Input: "nanti dulu" -> {"decision":"REJECT","confidence":0.9,"reason":"postpone"}
Input: "gimana ya" -> {"decision":"UNCERTAIN","confidence":0.4,"reason":"ambiguous"}
Input: "oke" -> {"decision":"UNCERTAIN","confidence":0.5,"reason":"ambiguous ack"}

PESAN USER:
{user_message}
`;

export async function classifyConfirmation(
  message: string,
  context?: { village_id?: string; wa_user_id?: string; session_id?: string; channel?: string }
): Promise<ConfirmationResult | null> {
  const prompt = CONFIRMATION_SYSTEM_PROMPT.replace('{user_message}', message || '');

  if (!isAIGatewayEnabled('llm')) {
    logger.error('Confirmation classifier skipped: LLM gateway lane is not configured');
    return null;
  }

  const gatewayResult = await callAIGatewayPrompt({
    lane: 'llm',
    modelPriority: CONFIRMATION_MODEL_PRIORITY,
    messages: buildPromptMessages(prompt),
    temperature: 0.1,
    maxTokens: 200,
    timeoutMs: MICRO_LLM_TIMEOUT_MS,
    jsonMode: true,
    layerType: 'micro_nlu',
    callType: 'confirmation_classify',
    context,
  });

  if (!gatewayResult) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      gatewayResult.text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()
    ) as ConfirmationResult;

    if (!parsed?.decision || typeof parsed.confidence !== 'number') {
      throw new Error('Invalid confirmation response');
    }

    return {
      decision: parsed.decision,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      reason: parsed.reason,
    };
  } catch (error: any) {
    logger.warn('Confirmation classifier parse failed', {
      provider: gatewayResult.provider,
      model: gatewayResult.model,
      error: error.message,
    });
    return null;
  }
}
