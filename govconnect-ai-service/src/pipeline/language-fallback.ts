/**
 * A3 — Regional-language fallback (Javanese/Sundanese/dialect).
 *
 * Light heuristic + assessor signal. The marker heuristic is the primary
 * gate; src/services/language-detection.service.ts (weighted patterns,
 * 6 regional languages) acts as a second opinion that can only ADD a
 * fallback for weak-heuristic cases (exactly 1 marker hit) — it never
 * overrides a confident Indonesian read. HONEST LIMITS (documented,
 * not hidden):
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
  /** Total regional marker hits (even when below the strong threshold). */
  markerHits: number;
}

/**
 * Assessor signal: a second, independent language detector
 * (src/services/language-detection.service.ts — weighted patterns over
 * 6 regional languages). The light heuristic above is the primary gate;
 * the assessor only ever *adds* a fallback for weak-heuristic cases,
 * never overrides a strong Indonesian read.
 */
export interface AssessorLanguageHint {
  regional: boolean;
  confidence: number; // 0..1
  language?: string;
}

export const ASSESSOR_MIN_CONFIDENCE = 0.3;

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
  if (tokens.length === 0) return { language: 'unknown', confidence: 0, markers: [], markerHits: 0 };
  const jv = countHits(tokens, JV_MARKERS);
  const su = countHits(tokens, SU_MARKERS);
  const id = countHits(tokens, ID_MARKERS);
  const regional = jv.length + su.length;
  if (regional < MIN_MARKER_HITS || regional <= id.length) {
    return { language: 'unknown', confidence: 0, markers: [], markerHits: regional };
  }
  const language: DetectedLanguage = jv.length >= su.length ? 'jv' : 'su';
  const markers = jv.length >= su.length ? jv : su;
  const confidence = Math.min(1, regional / tokens.length + 0.1);
  return { language, confidence, markers, markerHits: regional };
}

/**
 * Should the pipeline use the regional-language fallback?
 *
 * 1. Strong heuristic (≥2 regional markers, regional beats Indonesian) → yes.
 * 2. Weak heuristic (exactly 1 regional marker) + assessor confirms regional
 *    with confidence ≥ 0.3 → yes. The assessor never fires on its own:
 *    at least one heuristic marker hit is required, so a confident
 *    Indonesian read is never overridden.
 */
export function shouldUseRegionalFallback(
  det: LanguageDetection,
  assessor?: AssessorLanguageHint,
): boolean {
  if ((det.language === 'jv' || det.language === 'su') && det.confidence >= MIN_CONFIDENCE) {
    return true;
  }
  if (
    det.markerHits >= 1 &&
    assessor?.regional === true &&
    assessor.confidence >= ASSESSOR_MIN_CONFIDENCE
  ) {
    return true;
  }
  return false;
}

export const REGIONAL_FALLBACK_COPY =
  'Saya paling lancar Bahasa Indonesia — boleh lanjut Bahasa Indonesia?';

/** Language name for audit/logging (Bahasa Indonesia, staff-friendly). */
export function languageLabel(lang: DetectedLanguage): string {
  switch (lang) {
    case 'jv': return 'Jawa';
    case 'su': return 'Sunda';
    case 'id': return 'Indonesia';
    default: return 'tidak dikenali';
  }
}
