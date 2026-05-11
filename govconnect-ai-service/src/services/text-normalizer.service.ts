/**
 * Text Normalizer Service
 * 
 * SINGLE SOURCE OF TRUTH untuk normalisasi teks user input.
 * Digunakan oleh unified-message-processor.service.ts
 */

/**
 * Common Indonesian typo corrections
 * Centralized so all channels use the same corrections
 */
const TYPO_CORRECTIONS: Record<string, string> = {
  // Document typos
  'srat': 'surat',
  'sktm': 'SKTM',
  'skd': 'SKD',
  'sku': 'SKU',
  'spktp': 'SPKTP',
  'spkk': 'SPKK',

  // Informal language → formal
  'gw': 'saya',
  'gue': 'saya',
  'gua': 'saya',
  'aku': 'saya',
  // 'w' removed: \b word boundary matches standalone 'w' in 'RW', addresses, and proper nouns

  // Time expressions
  'bsk': 'besok',
  'skrg': 'sekarang',
  'skrang': 'sekarang',
  'nanti2': 'nanti',

  // Location/address abbreviations
  'jln': 'jalan',
  'jl': 'jalan',
  'gg': 'gang',
  'rt': 'RT',
  'rw': 'RW',
  'no': 'nomor',
  'nmr': 'nomor',
  'alamt': 'alamat',
  'almt': 'alamat',
  'lok': 'lokasi',
  'dmn': 'dimana',
  'dmna': 'dimana',

  // Greetings
  'hlo': 'halo',
  'hai': 'halo',
  'hi': 'halo',
  'hello': 'halo',

  // Common words
  'pengen': 'ingin',
  'butuh': 'perlu',
  'bikin': 'buat',
  'gimana': 'bagaimana',
  'gmn': 'bagaimana',
  'gmana': 'bagaimana',
  'bgmn': 'bagaimana',
  'knp': 'kenapa',
  'knpa': 'kenapa',
  'krn': 'karena',
  'krna': 'karena',
  'dgn': 'dengan',
  'utk': 'untuk',
  'yg': 'yang',
  'tdk': 'tidak',
  'blm': 'belum',
  'sdh': 'sudah',
  'udh': 'sudah',
  'udah': 'sudah',
  'brp': 'berapa',
  'brpa': 'berapa',
  'bs': 'bisa',
  'bsa': 'bisa',
  'sy': 'saya',
  'syr': 'syarat',
  'prsyrtn': 'persyaratan',
  'trims': 'terima kasih',

  // Negation
  'ga': 'tidak',
  'gak': 'tidak',
  'nggak': 'tidak',
  'engga': 'tidak',
  'enggak': 'tidak',
  'ngga': 'tidak',

  // Common typos
  'ok': 'oke',
  'okay': 'oke',
  'okey': 'oke',
  'oks': 'oke',
  'makasih': 'terima kasih',
  'mksh': 'terima kasih',
  'mksih': 'terima kasih',
  'mkasih': 'terima kasih',
  'maksih': 'terima kasih',
  'thx': 'terima kasih',
  'tks': 'terima kasih',
  'tq': 'terima kasih',
  'tengkyu': 'terima kasih',
};

// Multi-token phrases that need to normalize together. Applied before the
// per-word pass so things like "jm bk" → "jam buka" resolve in one step
// and the downstream classifier sees intent clearly.
const PHRASE_CORRECTIONS: Array<[RegExp, string]> = [
  [/\bjm\s+bk\b/gi, 'jam buka'],
  [/\bjm\s+tutup\b/gi, 'jam tutup'],
  [/\bjam\s+br\b/gi, 'jam berapa'],
  [/\bbr\s+jam\b/gi, 'berapa jam'],
  [/\bno\s+tlp\b/gi, 'nomor telepon'],
  [/\bno\s+telp\b/gi, 'nomor telepon'],
  [/\bno\s+hp\b/gi, 'nomor hp'],
  [/\bsrt\s+pngtr\b/gi, 'surat pengantar'],
  [/\bcek\s+sts\b/gi, 'cek status'],
  [/\bmau\s+lpr\b/gi, 'mau lapor'],
];

/**
 * Apply typo corrections to message
 * Uses word boundaries to avoid partial matches
 * 
 * @param message - Raw user message
 * @returns Normalized message with typos corrected
 */
export function normalizeText(message: string): string {
  if (!message || typeof message !== 'string') {
    return message;
  }

  let corrected = message;

  // Multi-token phrase normalization first — resolves "jm bk" → "jam buka"
  // in one pass so the word-by-word loop below doesn't miss cross-token
  // abbreviations.
  for (const [pattern, replacement] of PHRASE_CORRECTIONS) {
    corrected = corrected.replace(pattern, replacement);
  }

  // Apply typo corrections (word boundaries to avoid partial matches)
  for (const [typo, correct] of Object.entries(TYPO_CORRECTIONS)) {
    const regex = new RegExp(`\\b${typo}\\b`, 'gi');
    corrected = corrected.replace(regex, correct);
  }

  return corrected;
}

/**
 * Check if message was normalized (had typos corrected)
 * Useful for logging/analytics
 */
export function wasNormalized(original: string, normalized: string): boolean {
  return original !== normalized;
}

/**
 * Get list of typo corrections applied
 * Useful for debugging
 */
export function getAppliedCorrections(original: string): string[] {
  const applied: string[] = [];
  
  for (const [typo, correct] of Object.entries(TYPO_CORRECTIONS)) {
    const regex = new RegExp(`\\b${typo}\\b`, 'gi');
    if (regex.test(original)) {
      applied.push(`${typo} → ${correct}`);
    }
  }
  
  return applied;
}

// Legacy export for backward compatibility
export const applyTypoCorrections = normalizeText;

export default {
  normalizeText,
  applyTypoCorrections,
  wasNormalized,
  getAppliedCorrections,
  TYPO_CORRECTIONS,
};
