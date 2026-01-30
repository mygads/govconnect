import logger from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env';

export type ConfirmationDecision = 'CONFIRM' | 'REJECT' | 'UNCERTAIN';

export interface ConfirmationResult {
  decision: ConfirmationDecision;
  confidence: number;
  reason?: string;
}

const DEFAULT_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

function parseModelListEnv(envValue: string | undefined, fallback: string[]): string[] {
  const raw = (envValue || '').trim();
  if (!raw) return fallback;

  const models = raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const unique: string[] = [];
  for (const model of models) {
    if (!unique.includes(model)) unique.push(model);
  }

  return unique.length > 0 ? unique : fallback;
}

const CONFIRMATION_MODEL_PRIORITY = parseModelListEnv(process.env.LAYER1_MODELS, DEFAULT_MODELS);
const CONFIRMATION_SYSTEM_PROMPT = `Anda adalah classifier konfirmasi untuk layanan publik.

TUGAS:
- Tentukan apakah pesan user MENGONFIRMASI pengiriman link formulir (CONFIRM), MENOLAK (REJECT), atau BELUM JELAS (UNCERTAIN).
- Anggap pertanyaan minta link/form (misal: "mana linknya", "kirim link", "formnya mana") sebagai CONFIRM.
- Anggap penundaan/penolakan ("tidak", "nanti", "belum", "batal") sebagai REJECT.
- Jika netral atau ambigu, beri UNCERTAIN.

OUTPUT (JSON saja):
{
  "decision": "CONFIRM|REJECT|UNCERTAIN",
  "confidence": 0.0-1.0,
  "reason": "short"
}

CONTOH:
Input: "iya" -> {"decision":"CONFIRM","confidence":0.95,"reason":"explicit yes"}
Input: "mana linknya?" -> {"decision":"CONFIRM","confidence":0.92,"reason":"asks link"}
Input: "nanti dulu" -> {"decision":"REJECT","confidence":0.9,"reason":"postpone"}
Input: "gimana ya" -> {"decision":"UNCERTAIN","confidence":0.4,"reason":"ambiguous"}

PESAN USER:
{user_message}
`;

export async function classifyConfirmation(message: string): Promise<ConfirmationResult | null> {
  const prompt = CONFIRMATION_SYSTEM_PROMPT.replace('{user_message}', message || '');

  for (let i = 0; i < CONFIRMATION_MODEL_PRIORITY.length; i++) {
    const model = CONFIRMATION_MODEL_PRIORITY[i];

    try {
      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      const geminiModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
        },
      });

      const result = await geminiModel.generateContent(prompt);
      const responseText = result.response.text();

      const cleaned = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned) as ConfirmationResult;

      if (!parsed?.decision || typeof parsed.confidence !== 'number') {
        throw new Error('Invalid confirmation response');
      }

      return {
        decision: parsed.decision,
        confidence: Math.max(0, Math.min(1, parsed.confidence)),
        reason: parsed.reason,
      };
    } catch (error: any) {
      logger.warn('Confirmation classifier failed, trying next model', {
        model,
        error: error.message,
      });
    }
  }

  return null;
}
