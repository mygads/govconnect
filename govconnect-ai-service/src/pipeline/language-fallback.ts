/**
 * A3 — Regional-language fallback (Javanese/Sundanese/dialect).
 *
 * Heuristic word-marker detection. HONEST LIMITS (documented, not hidden):
 * - This is a heuristic, NOT an accurate classifier for all dialects.
 * - Mixed Indonesian/regional sentences may score low → fail-open (the
 *   message flows through normally; we never block on a weak signal).
 * - When regional language IS detected with reasonable confidence, the
 *   pipeline does NOT guess the intent and does NOT execute anything:
 *   it replies with a friendly request to continue in Indonesian.
 *
 * Runs AFTER glossary normalization (A2) so known terms are already
 * translated; this catches the untranslatable remainder.
 */

export type DetectedLanguage = 'id' | 'jv' | 'su' | 'unknown';

export interface LanguageDetection {
  language: DetectedLanguage;
  confidence: number; // 0..1
  markers: string[];
}

const JV_MARKERS = [
  'kula', 'panjenengan', 'sampean', 'piye', 'kepiye', 'pripun', 'ora',
  'sing', 'lan', 'karo', 'soko', 'neng', 'ono', 'arep', 'wis', 'durung',
  'suwun', 'matur', 'monggo', 'bade', 'ngadamel', 'dalane', 'sinten',
  'pundi', 'kados', 'menopo', 'sampun', 'dereng', 'niki', 'niku',
];

const SU_MARKERS = [
  'abdi', 'anjeun', 'hidep', 'kumaha', 'hatur', 'nuhun', 'teh', 'mah',
  'atuh', 'pisan', 'hoyong', 'tos', 'acan', 'naha', 'iraha', 'kumargi',
  'mung', 'oge', 'sanes', 'teu',
];

const ID_MARKERS = [
  'saya', 'anda', 'bagaimana', 'terima kasih', 'adalah', 'dengan',
  'untuk', 'tidak', 'bisa', 'akan', 'sudah', 'yang', 'dan',
];

const MIN_MARKER_HITS = 2;
const MIN_CONFIDENCE = 0.15;

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1);
}

function countHits(tokens: string[], markers: string[]): string[] {
  const set = new Set(tokens);
  return markers.filter((m) => set.has(m));
}

/** Pure heuristic detection. */
export function detectLanguage(text: string): LanguageDetection {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { language: 'unknown', confidence: 0, markers: [] };
  const jv = countHits(tokens, JV_MARKERS);
  const su = countHits(tokens, SU_MARKERS);
  const id = countHits(tokens, ID_MARKERS);
  const regional = jv.length + su.length;
  if (regional < MIN_MARKER_HITS || regional <= id.length) {
    return { language: 'unknown', confidence: 0, markers: [] };
  }
  const language: DetectedLanguage = jv.length >= su.length ? 'jv' : 'su';
  const markers = jv.length >= su.length ? jv : su;
  const confidence = Math.min(1, regional / tokens.length + 0.1);
  return { language, confidence, markers };
}

/** Should the pipeline use the regional-language fallback? */
export function shouldUseRegionalFallback(det: LanguageDetection): boolean {
  return (det.language === 'jv' || det.language === 'su') && det.confidence >= MIN_CONFIDENCE;
}

export const REGIONAL_FALLBACK_COPY =
  'Sepertinya Bapak/Ibu menulis dalam bahasa daerah. ' +
  'Saya paling lancar berbahasa Indonesia — boleh dilanjutkan dalam Bahasa Indonesia? 🙏 ' +
  'Tulis saja dengan kata-kata sederhana, nanti saya bantu.';

/** Language name for audit/logging (Bahasa Indonesia, staff-friendly). */
export function languageLabel(lang: DetectedLanguage): string {
  switch (lang) {
    case 'jv': return 'Jawa';
    case 'su': return 'Sunda';
    case 'id': return 'Indonesia';
    default: return 'tidak dikenali';
  }
}
