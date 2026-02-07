import logger from '../utils/logger';

export interface HallucinationSignals {
  mentionsOfficeHours: boolean;
  mentionsCost: boolean;
  mentionsFakeLinks: boolean;
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

// Detect fake/placeholder links often hallucinated by LLMs
const FAKE_LINK_PATTERNS: RegExp[] = [
  /\[link\s+[^\]]+\]/i, // [link formulir pengaduan], [link cek status], etc.
  /\[.*?formulir.*?\]/i, // [formulir pengaduan]
  /\[.*?cek\s+status.*?\]/i, // [cek status pengaduan]
  /\(link\s+[^)]+\)/i, // (link formulir)
  /https?:\/\/\[.*?\]/i, // http://[website]
  /www\.\[.*?\]/i, // www.[website]
  /<link.*?>/i, // <link formulir>
  /formulir.*?secara\s+online/i, // "formulir pengaduan secara online" - common hallucination
];

export function detectHallucinationSignals(text: string | undefined): HallucinationSignals {
  const safeText = (text || '').trim();
  if (!safeText) {
    return { mentionsOfficeHours: false, mentionsCost: false, mentionsFakeLinks: false };
  }

  const mentionsOfficeHours = OFFICE_HOURS_PATTERNS.some((p) => p.test(safeText));
  const mentionsCost = COST_PATTERNS.some((p) => p.test(safeText));
  const mentionsFakeLinks = FAKE_LINK_PATTERNS.some((p) => p.test(safeText));

  return { mentionsOfficeHours, mentionsCost, mentionsFakeLinks };
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
  const replySignals = detectHallucinationSignals(args.replyText);
  const guidanceSignals = detectHallucinationSignals(args.guidanceText);

  // Fake links are ALWAYS hallucinations - no retry needed, just filter them out
  const mentionsFakeLinks = replySignals.mentionsFakeLinks || guidanceSignals.mentionsFakeLinks;
  if (mentionsFakeLinks) {
    return {
      shouldRetry: true,
      reason: 'Menyebut link palsu/placeholder',
    };
  }

  // For office hours and cost, only flag as hallucination if no knowledge context
  if (args.hasKnowledge) return { shouldRetry: false };

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
  return `${prompt}\n\nKOREKSI WAJIB (ANTI-HALU):\n- Jangan menyebut jam operasional/hari kerja/pukul tertentu jika TIDAK ada di KNOWLEDGE.\n- Jangan menyebut biaya (gratis/berbayar/angka Rp) jika TIDAK ada di KNOWLEDGE.\n- JANGAN PERNAH menyebut link placeholder seperti [link formulir], [link cek status], [website], dll.\n- Jika info tidak tersedia, jawab: "Untuk jam/biaya, saya belum dapat info pastinya. Bisa saya bantu cekkan atau Bapak/Ibu bisa konfirmasi ke kantor ya."\n`;
}

/**
 * Remove fake/placeholder links from LLM response
 * These are common hallucinations like "[link formulir pengaduan]", "[link cek status]", etc.
 */
export function sanitizeFakeLinks(text: string | undefined): string {
  if (!text) return '';
  
  let sanitized = text;
  
  // Remove [link ...] patterns
  sanitized = sanitized.replace(/\[link\s+[^\]]+\]/gi, '');
  
  // Remove sentences containing fake link patterns
  // Split by sentences and filter out hallucinated ones
  const sentencePatterns = [
    /[^.]*formulir\s+(pengaduan|pendaftaran|layanan)\s+secara\s+online[^.]*\./gi,
    /[^.]*\[.*?(formulir|cek\s*status|link|website).*?\][^.]*\./gi,
    /[^.]*melalui\s+\[.*?\][^.]*\./gi,
    /[^.]*di\s+\[.*?\][^.]*\./gi,
  ];
  
  for (const pattern of sentencePatterns) {
    sanitized = sanitized.replace(pattern, '');
  }
  
  // Clean up extra whitespace and newlines
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n').trim();
  
  return sanitized;
}

export function logAntiHallucinationEvent(meta: {
  userId: string;
  channel: string;
  reason?: string;
  model?: string;
}) {
  logger.warn('🧯 Anti-hallucination gate triggered', meta);
}
