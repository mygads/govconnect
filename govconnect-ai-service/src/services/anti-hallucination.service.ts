import logger from '../utils/logger';

export interface HallucinationSignals {
  mentionsOfficeHours: boolean;
  mentionsCost: boolean;
  mentionsFakeLinks: boolean;
  mentionsPhoneNumber: boolean;
  mentionsAddress: boolean;
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

// Detect phone numbers that may be hallucinated (not from knowledge)
const PHONE_PATTERNS: RegExp[] = [
  /\b0\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/, // 021-1234-5678, 0411 123 4567
  /\b\+?62\s?\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/, // +62 812 3456 7890
  /\b08\d{8,11}\b/, // 081234567890
  /\b\(0\d{2,3}\)\s?\d{6,8}\b/, // (021) 12345678
];

// Detect specific addresses that may be hallucinated
const ADDRESS_PATTERNS: RegExp[] = [
  /\bjl\.?\s+[A-Z][a-zA-Z\s]+(?:no\.?\s*\d+)/i, // Jl. Sudirman No. 123
  /\bjalan\s+[A-Z][a-zA-Z\s]+(?:no\.?\s*\d+)/i, // Jalan Merdeka No. 45
  /\bkode\s*pos\s*:?\s*\d{5}\b/i, // Kode pos: 12345
];

export function detectHallucinationSignals(text: string | undefined): HallucinationSignals {
  const safeText = (text || '').trim();
  if (!safeText) {
    return { mentionsOfficeHours: false, mentionsCost: false, mentionsFakeLinks: false, mentionsPhoneNumber: false, mentionsAddress: false };
  }

  const mentionsOfficeHours = OFFICE_HOURS_PATTERNS.some((p) => p.test(safeText));
  const mentionsCost = COST_PATTERNS.some((p) => p.test(safeText));
  const mentionsFakeLinks = FAKE_LINK_PATTERNS.some((p) => p.test(safeText));
  const mentionsPhoneNumber = PHONE_PATTERNS.some((p) => p.test(safeText));
  const mentionsAddress = ADDRESS_PATTERNS.some((p) => p.test(safeText));

  return { mentionsOfficeHours, mentionsCost, mentionsFakeLinks, mentionsPhoneNumber, mentionsAddress };
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
  /** Raw knowledge text from RAG — used to cross-reference phone/address signals */
  knowledgeText?: string;
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

  const mentionsOfficeHours = replySignals.mentionsOfficeHours || guidanceSignals.mentionsOfficeHours;
  const mentionsCost = replySignals.mentionsCost || guidanceSignals.mentionsCost;
  const mentionsPhoneNumber = replySignals.mentionsPhoneNumber || guidanceSignals.mentionsPhoneNumber;
  const mentionsAddress = replySignals.mentionsAddress || guidanceSignals.mentionsAddress;

  if (!mentionsOfficeHours && !mentionsCost && !mentionsPhoneNumber && !mentionsAddress) return { shouldRetry: false };

  // When knowledge context exists, cross-reference detected signals
  if (args.hasKnowledge) {
    const kb = args.knowledgeText || '';
    if (!kb) return { shouldRetry: false }; // Can't cross-ref without text

    const responseText = [args.replyText, args.guidanceText].filter(Boolean).join(' ');
    const unverifiedParts: string[] = [];

    // Cross-ref phone: extract phone numbers from response and check if they appear in knowledge
    if (mentionsPhoneNumber) {
      const phonesInResponse = responseText.match(/(?:0\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}|\+?62\s?\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{3,4}|08\d{8,11}|\(0\d{2,3}\)\s?\d{6,8})/g) || [];
      const unverifiedPhones = phonesInResponse.filter(phone => {
        const digits = phone.replace(/[^\d]/g, '');
        return !kb.includes(digits) && !kb.includes(phone);
      });
      if (unverifiedPhones.length > 0) unverifiedParts.push('nomor telepon');
    }

    // Cross-ref address: only flag if no address info exists in knowledge at all
    if (mentionsAddress) {
      const hasAddressInKb = /\b(jl|jln|jalan)\.?\s+\w+/i.test(kb) || /kode\s*pos/i.test(kb);
      if (!hasAddressInKb) unverifiedParts.push('alamat spesifik');
    }

    if (unverifiedParts.length === 0) return { shouldRetry: false };
    return { shouldRetry: true, reason: `Menyebut ${unverifiedParts.join(' dan ')} tidak ditemukan di knowledge` };
  }

  // No knowledge at all — flag everything
  const reasonParts: string[] = [];
  if (mentionsOfficeHours) reasonParts.push('jam operasional');
  if (mentionsCost) reasonParts.push('biaya');
  if (mentionsPhoneNumber) reasonParts.push('nomor telepon');
  if (mentionsAddress) reasonParts.push('alamat spesifik');

  return {
    shouldRetry: true,
    reason: `Menyebut ${reasonParts.join(' dan ')} tanpa knowledge`,
  };
}

export function appendAntiHallucinationInstruction(prompt: string): string {
  return `${prompt}\n\nKOREKSI WAJIB (ANTI-HALU):\n- Jangan menyebut jam operasional/hari kerja/pukul tertentu jika TIDAK ada di KNOWLEDGE.\n- Jangan menyebut biaya (gratis/berbayar/angka Rp) jika TIDAK ada di KNOWLEDGE.\n- JANGAN PERNAH menyebut link placeholder seperti [link formulir], [link cek status], [website], dll.\n- Jangan menyebut nomor telepon/kontak spesifik jika TIDAK ada di KNOWLEDGE atau database kontak penting.\n- Jangan menyebut alamat kantor/instansi spesifik (Jl. ..., No. ...) jika TIDAK ada di KNOWLEDGE.\n- Jika info tidak tersedia, jawab: "Untuk jam/biaya/kontak, saya belum dapat info pastinya. Bisa saya bantu cekkan atau Bapak/Ibu bisa konfirmasi ke kantor ya."\n`;
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
