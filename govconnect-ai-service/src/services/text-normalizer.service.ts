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
  'mau': 'ingin',
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

  // Regional/dialect phrases → standard Indonesian
  // Javanese: "badhe damel X" / "ngurus X" → "ingin membuat X"
  [/\bbadhe\s+damel\b/gi, 'ingin membuat'],
  [/\bdamel\b/gi, 'membuat'],
  [/\bbadhe\b/gi, 'ingin'],
  [/\bngurus\b/gi, 'mengurus'],
  [/\bngadamel\b/gi, 'membuat'],
  [/\bnggawe\b/gi, 'membuat'],
  [/\bnggih\b/gi, 'iya'],
  [/\bniki\b/gi, 'ini'],
  [/\bniku\b/gi, 'itu'],
  [/\bpiye\b/gi, 'bagaimana'],
  [/\bpiye\s+carane\b/gi, 'bagaimana caranya'],
  [/\bcarane\b/gi, 'caranya'],
  [/\bsopo\b/gi, 'siapa'],
  [/\bopo\b/gi, 'apa'],
  [/\bkapan\b/gi, 'kapan'],

  // Sundanese: "kumaha cara ngurus X" / "ngadamel surat" → "bagaimana cara mengurus X"
  [/\bkumaha\s+cara\b/gi, 'bagaimana cara'],
  [/\bkumaha\b/gi, 'bagaimana'],
  [/\bnaon\b/gi, 'apa'],
  [/\bteu\b/gi, 'tidak'],
  [/\bhenteu\b/gi, 'tidak'],
  [/\benteu\b/gi, 'tidak'],

  // Bugis: "engka X" = "ada X", "tabe" = "permisi", "mappake" = "menggunakan"
  [/\bengka\b/gi, 'ada'],
  [/\btabe\b/gi, 'permisi'],
  [/\bmappake\b/gi, 'menggunakan'],
  [/\bcarana\b/gi, 'caranya'],
  [/\bnappe\b/gi, 'apa'],
  [/\baji\b/gi, 'hanya'],
  [/\bise\b/gi, 'ini'],
  [/\biya\b/gi, 'iya'],

  // Madura: "sapaen" = "bagaimana", "aken" = "akan", "nyaman" = "enak", "bhuntheng" = "apa"
  [/\bsapaen\b/gi, 'bagaimana'],
  [/\baken\b/gi, 'akan'],
  [/\bbhuntheng\b/gi, 'apa'],
  [/\bcarek\b/gi, 'anak'],
  [/\bmon\b/gi, 'kalau'],
  [/\bbangkalan\b/gi, 'bangkalan'],

  // Minang: "indak/tidak" = "tidak", "kan" = "ini", "nan" = "yang", "ko" = "ini"
  [/\bindak\b/gi, 'tidak'],
  [/\bnan\b/gi, 'yang'],
  [/\bko\b/gi, 'ini'],
  [/\bkan\b/gi, 'ini'],
  [/\bbaralek\b/gi, 'nikah'],
  [/\bbajalan\b/gi, 'jalan'],
  [/\bbalun\b/gi, 'belum'],
  [/\bsudah\s+do\b/gi, 'sudah'],
  [/\bdo\b/gi, ''],

  // Batak: "songon" = "seperti", "dang" = "tidak", "ma" = "sudah", "ro" = "datang"
  [/\bsongon\b/gi, 'seperti'],
  [/\bdang\b/gi, 'tidak'],
  [/\bholan\b/gi, 'hanya'],
  [/\bma\b/gi, 'sudah'],
  [/\bro\b/gi, 'datang'],
  [/\bhamu\b/gi, 'kamu'],
  [/\bhu\b/gi, 'saya'],
  [/\baho\b/gi, 'siapa'],

  // Colloquial service request phrases
  [/\bbuat\s+(surat|ktp|kk|akta|surat pindah|surat domisili|surat kematian|surat lahir|surat nikah|surat cerai|surat usaha|surat pengantar|surat tidak mampu|surat miskin)\b/gi, 'membuat $1'],
  [/\bngurus\s+(surat|ktp|kk|akta)\b/gi, 'mengurus $1'],
  [/\burus\s+(surat|ktp|kk|akta)\b/gi, 'mengurus $1'],
  [/\bmau\s+(bikin|buat)\b/gi, 'ingin membuat'],
  [/\bpengen\s+(bikin|buat)\b/gi, 'ingin membuat'],
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

  // Pass 1: Apply typo corrections first (word boundaries to avoid partial matches)
  // This converts "bikin" → "buat", "gue" → "saya", etc.
  for (const [typo, correct] of Object.entries(TYPO_CORRECTIONS)) {
    const regex = new RegExp(`\\b${typo}\\b`, 'gi');
    corrected = corrected.replace(regex, correct);
  }

  // Pass 2: Apply phrase corrections (now that words are normalized)
  // This converts "buat KTP" → "membuat KTP", "saya mau" → "saya ingin", etc.
  for (const [pattern, replacement] of PHRASE_CORRECTIONS) {
    corrected = corrected.replace(pattern, replacement);
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
