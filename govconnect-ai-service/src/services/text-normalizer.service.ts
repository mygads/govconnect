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
  'w': 'saya',
  
  // Time expressions
  'bsk': 'besok',
  
  // Location/address abbreviations
  'jln': 'jalan',
  'jl': 'jalan',
  'gg': 'gang',
  'rt': 'RT',
  'rw': 'RW',
  'no': 'nomor',
  
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
  'knp': 'kenapa',
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
  'makasih': 'terima kasih',
  'mksh': 'terima kasih',
  'thx': 'terima kasih',
  'tks': 'terima kasih',
};

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
