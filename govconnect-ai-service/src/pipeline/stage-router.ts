/**
 * Stage Router — deterministic entry routing for every incoming message.
 *
 * Design (arsitektur-final §4):
 * - Greeting/smalltalk, emergency keywords, and explicit fast-lane patterns
 *   are decided by CODE — no LLM call wasted.
 * - Anything ambiguous is returned as a TRIAGE decision with a flag asking
 *   the assessor to judge the fuzzy transition.
 * - This module is intentionally SMALL. It must not grow into another
 *   500-line regex router: if a pattern can't be enumerated, it belongs
 *   to the assessor, not here.
 */

import type { StageDecision } from './stage-types';

/** Greeting / smalltalk — answered deterministically, no LLM. */
const GREETING_PATTERNS: RegExp[] = [
  /^(halo|hallo|hai|hi|pagi|siang|sore|malam|assalamu'alaikum|assalamualaikum|permisi|tes|test|ping)\b/i,
];

/** Emergency — bypass everything, deterministic. */
const EMERGENCY_PATTERNS: RegExp[] = [
  /\b(kebakaran|banjir|longsor|gempa|kecelakaan|darurat|emergency|tolong.{0,20}(segera|cepat)|ambulans|ambulance|pemadam)\b/i,
];

/** Explicit fast-lane: information questions (jam/syarat/biaya/kontak). */
const INFORMATION_PATTERNS: RegExp[] = [
  /\b(jam (buka|operasional|pelayanan)|syarat|biaya|tarif|berapa lama|dokumen apa|kontak|nomor (telepon|hp|wa)|alamat kantor|lokasi kantor)\b/i,
];

/** Explicit fast-lane: status check. */
const STATUS_PATTERNS: RegExp[] = [
  /\b(cek|status|cek status|lacak|tracking|bagaimana|gimana).{0,30}(laporan|pengaduan|surat|permohonan|tiket)\b/i,
  /\b(sudah sampai mana|progress|perkembangan).{0,30}(laporan|pengaduan|surat|tiket)\b/i,
];

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface RouterInput {
  message: string;
  /** Previous stage of this conversation, if known (for affinity). */
  previousStage?: string;
}

export function routeMessage(input: RouterInput): StageDecision {
  const text = normalize(input.message);

  if (!text) {
    return {
      stage: 'TRIAGE',
      source: 'deterministic',
      confidence: 1,
      reasons: ['empty_message'],
    };
  }

  // 1. Emergency bypass — highest priority, deterministic.
  if (EMERGENCY_PATTERNS.some((re) => re.test(text))) {
    return {
      stage: 'EMERGENCY',
      source: 'deterministic',
      confidence: 1,
      reasons: ['emergency_keyword'],
      hints: { emergency: true },
    };
  }

  // 2. Greeting — deterministic short-circuit, no LLM.
  if (text.length <= 40 && GREETING_PATTERNS.some((re) => re.test(text))) {
    return {
      stage: 'INFORMATION',
      source: 'deterministic',
      confidence: 1,
      reasons: ['greeting'],
      hints: { greeting: true },
    };
  }

  // 3. Explicit fast lanes.
  if (STATUS_PATTERNS.some((re) => re.test(text))) {
    return {
      stage: 'STATUS_CHECK',
      source: 'deterministic',
      confidence: 0.95,
      reasons: ['explicit_status_pattern'],
    };
  }
  if (INFORMATION_PATTERNS.some((re) => re.test(text)) && text.length <= 120) {
    return {
      stage: 'INFORMATION',
      source: 'deterministic',
      confidence: 0.9,
      reasons: ['explicit_information_pattern'],
    };
  }

  // 4. Everything else → TRIAGE; the assessor judges the fuzzy transition.
  return {
    stage: 'TRIAGE',
    source: 'deterministic',
    confidence: 1,
    reasons: ['needs_assessor'],
    hints: { needsAssessor: true },
  };
}
