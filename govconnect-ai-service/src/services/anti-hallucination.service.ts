import logger from '../utils/logger';

export interface HallucinationSignals {
  mentionsOfficeHours: boolean;
  mentionsCost: boolean;
}

const OFFICE_HOURS_PATTERNS: RegExp[] = [
  /\bjam\s*(buka|tutup|operasional|layanan)\b/i,
  /\bpukul\s*\d{1,2}([.:]\d{2})?\b/i,
  /\b\d{1,2}([.:]\d{2})\s*-\s*\d{1,2}([.:]\d{2})\b/i,
  /\b(senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/i,
];

const COST_PATTERNS: RegExp[] = [
  /\bbiaya\b/i,
  /\bgratis\b/i,
  /\b(bayar|pembayaran|tarif|retribusi)\b/i,
  /\b(rp\s*\d|rupiah\s*\d)\b/i,
];

export function detectHallucinationSignals(text: string | undefined): HallucinationSignals {
  const safeText = (text || '').trim();
  if (!safeText) {
    return { mentionsOfficeHours: false, mentionsCost: false };
  }

  const mentionsOfficeHours = OFFICE_HOURS_PATTERNS.some((p) => p.test(safeText));
  const mentionsCost = COST_PATTERNS.some((p) => p.test(safeText));

  return { mentionsOfficeHours, mentionsCost };
}

export function hasKnowledgeInPrompt(systemPrompt: string | undefined): boolean {
  const prompt = systemPrompt || '';
  // Markers from context-builder
  if (prompt.includes('KNOWLEDGE BASE YANG TERSEDIA:')) return true;
  if (prompt.includes('[CONFIDENCE:')) return true;
  return false;
}

export function hasKnowledgeInContext(context: string | undefined): boolean {
  const ctx = context || '';
  if (ctx.includes('KNOWLEDGE BASE YANG TERSEDIA:')) return true;
  if (ctx.includes('KNOWLEDGE:')) return true;
  return false;
}

export function needsAntiHallucinationRetry(args: {
  replyText?: string;
  guidanceText?: string;
  hasKnowledge: boolean;
}): { shouldRetry: boolean; reason?: string } {
  if (args.hasKnowledge) return { shouldRetry: false };

  const replySignals = detectHallucinationSignals(args.replyText);
  const guidanceSignals = detectHallucinationSignals(args.guidanceText);

  const mentionsOfficeHours = replySignals.mentionsOfficeHours || guidanceSignals.mentionsOfficeHours;
  const mentionsCost = replySignals.mentionsCost || guidanceSignals.mentionsCost;

  if (!mentionsOfficeHours && !mentionsCost) return { shouldRetry: false };

  const reasonParts: string[] = [];
  if (mentionsOfficeHours) reasonParts.push('jam operasional');
  if (mentionsCost) reasonParts.push('biaya');

  return {
    shouldRetry: true,
    reason: `Menyebut ${reasonParts.join(' dan ')} tanpa knowledge`,
  };
}

export function appendAntiHallucinationInstruction(prompt: string): string {
  return `${prompt}\n\nKOREKSI WAJIB (ANTI-HALU):\n- Jangan menyebut jam operasional/hari kerja/pukul tertentu jika TIDAK ada di KNOWLEDGE.\n- Jangan menyebut biaya (gratis/berbayar/angka Rp) jika TIDAK ada di KNOWLEDGE.\n- Jika info tidak tersedia, jawab: \"Untuk jam/biaya, saya belum dapat info pastinya. Bisa saya bantu cekkan atau Kakak bisa konfirmasi ke kantor ya.\"\n`;
}

export function logAntiHallucinationEvent(meta: {
  userId: string;
  channel: string;
  reason?: string;
  model?: string;
}) {
  logger.warn('🧯 Anti-hallucination gate triggered', meta);
}
